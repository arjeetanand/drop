#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const SUBJECT = `A little check-in ${randomUUID().slice(0, 8)}`;
const MESSAGE = `I saw this and thought of you. ${randomUUID()}`;
const APP_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 180_000;
const BROWSER_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 30_000;
// The live inbox reconciles read state every 60 seconds; allow one full cycle plus request margin.
const CROSS_SESSION_READ_TIMEOUT_MS = 75_000;
const OBSERVER_HOME_STABILITY_MS = 8_000;
const OBSERVER_HOME_STABILITY_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
  { name: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
];
const active = new AbortController();
const allowedOrigins = new Set([
  APP_ORIGIN,
  'http://127.0.0.1:54321',
  'http://localhost:54321',
  'http://[::1]:54321',
]);

let admin;
let app;
let temporaryRoot;
let temporaryProject;
let temporaryHome;
let localValues = {};
let sender;
let recipient;
let letterId;
let createdUserIds = [];
let cleanupFailed = false;
let currentStep = 'initializing';
const sessions = [];

class CdpConnection {
  constructor(socket, signal) {
    this.socket = socket;
    this.signal = signal;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        this.signal.removeEventListener('abort', pending.onAbort);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || 'CDP command failed'}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`DevTools connection closed during ${pending.method}.`));
        this.pending.delete(id);
      }
    });
    socket.addEventListener('error', () => {});
  }

  static async connect(url, signal) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to isolated Chrome.')), 5_000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('Interrupted while connecting to Chrome.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolveOpen();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Could not connect to isolated Chrome DevTools.'));
      }, { once: true });
    });
    return new CdpConnection(socket, signal);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`DevTools connection closed before ${method}.`));
    }
    const id = ++this.nextId;
    return new Promise((resolveResult, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(this.signal.reason || new Error(`Interrupted during ${method}.`));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.signal.removeEventListener('abort', onAbort);
        reject(new Error(`Timed out waiting for Chrome DevTools command ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer, onAbort, method });
      this.signal.addEventListener('abort', onAbort, { once: true });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}

class BrowserSession {
  constructor(name) {
    this.name = name;
    this.profile = join(temporaryRoot, `chrome-${name}`);
    this.browser = null;
    this.browserCdp = null;
    this.pageCdp = null;
    this.spawnError = null;
    this.pendingRequests = new Map();
    this.mainDocumentRequests = [];
    this.failedLocalRequests = [];
    this.blockedExternalOrigins = new Set();
    this.consoleErrorCount = 0;
    this.exceptionCount = 0;
    this.readMarkerStatuses = [];
    this.recipientReadStateResponses = [];
    this.reactionChannelObserved = false;
  }

  async launch() {
    if (typeof WebSocket !== 'function') throw new Error('This smoke requires Node’s built-in WebSocket API.');
    const executable = findChromeExecutable();
    const resolverRule = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
    this.browser = spawn(executable, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-features=MediaRouter',
      '--no-proxy-server',
      `--host-resolver-rules=${resolverRule}`,
      'about:blank',
    ], {
      env: browserEnvironment(),
      // Edge starts its updater outside the browser process group and it can
      // inherit a piped stderr descriptor, keeping this Node process alive.
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.browser.on('error', (error) => { this.spawnError = error; });
    const devTools = await this.waitForDevTools();
    this.browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    this.pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
    this.observeNetwork();
    await Promise.all([
      this.pageCdp.send('Page.enable'),
      this.pageCdp.send('Runtime.enable'),
      this.pageCdp.send('Network.enable'),
      this.pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
    ]);
  }

  async waitForDevTools() {
    const file = join(this.profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < BROWSER_TIMEOUT_MS / 100; attempt += 1) {
      if (this.spawnError) throw new Error('An isolated Chrome process could not start.');
      if (this.browser.exitCode !== null) throw new Error('An isolated Chrome process exited before DevTools was ready.');
      try {
        const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
        const port = Number(lines[0]);
        if (Number.isInteger(port) && port > 0) return { port, path: lines[1] };
      } catch { /* Chrome has not created its DevTools port file yet. */ }
      await sleep(100, active.signal);
    }
    throw new Error('Isolated Chrome DevTools did not start in time.');
  }

  observeNetwork() {
    const cdp = this.pageCdp;
    cdp.on('Network.requestWillBeSent', ({ requestId, request, type, initiator }) => {
      let parsed;
      try { parsed = new URL(request.url); } catch { return; }
      if (type === 'Document' && parsed.origin === APP_ORIGIN) {
        this.mainDocumentRequests.push({
          path: parsed.pathname,
          startedAt: performance.now(),
          initiatorType: initiator?.type || null,
          initiatorFrames: (initiator?.stack?.callFrames || []).slice(0, 3).map((frame) => {
            let path = '';
            try { path = new URL(frame.url).pathname; } catch { /* Keep only local source paths in diagnostics. */ }
            return { path, functionName: frame.functionName || '', lineNumber: frame.lineNumber };
          }),
        });
      }
      const entry = { origin: parsed.origin, path: parsed.pathname, letterId: null, startedAt: performance.now() };
      if (parsed.pathname === '/rest/v1/rpc/mark_recipient_drop_read') {
        try {
          const body = JSON.parse(request.postData || '');
          entry.letterId = typeof body.p_letter_id === 'string' ? body.p_letter_id : null;
        } catch { /* The smoke will fail unless the exact read RPC can be correlated. */ }
      }
      if (parsed.pathname === '/rest/v1/rpc/get_recipient_drop_read_states') {
        try {
          const body = JSON.parse(request.postData || '');
          entry.letterIds = Array.isArray(body.p_letter_ids)
            ? body.p_letter_ids.filter((id) => typeof id === 'string')
            : [];
        } catch { entry.letterIds = []; }
      }
      this.pendingRequests.set(requestId, entry);
      if (/^https?:$/.test(parsed.protocol) && !allowedOrigins.has(parsed.origin)) this.blockedExternalOrigins.add(parsed.origin);
    });
    cdp.on('Network.webSocketCreated', ({ url }) => {
      try {
        const parsed = new URL(url);
        if (!['ws:', 'wss:'].includes(parsed.protocol)
          || !allowedOrigins.has(`${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`)) {
          this.blockedExternalOrigins.add(parsed.origin);
        }
        if (parsed.pathname.includes('/realtime/v1/websocket')) this.reactionChannelObserved = true;
      } catch { this.blockedExternalOrigins.add('invalid-websocket-origin'); }
    });
    cdp.on('Network.responseReceived', ({ requestId, response }) => {
      const request = this.pendingRequests.get(requestId);
      if (request?.path === '/rest/v1/rpc/mark_recipient_drop_read') {
        this.readMarkerStatuses.push({ letterId: request.letterId, status: response.status, responseAt: performance.now() });
      }
      if (request?.path === '/rest/v1/rpc/get_recipient_drop_read_states') {
        request.status = response.status;
      }
    });
    cdp.on('Network.loadingFinished', ({ requestId }) => {
      const request = this.pendingRequests.get(requestId);
      if (request?.path !== '/rest/v1/rpc/get_recipient_drop_read_states'
        || request.status === undefined) return;
      void cdp.send('Network.getResponseBody', { requestId }).then(({ body, base64Encoded }) => {
        let includesReadMarker = false;
        try {
          const payload = JSON.parse(Buffer.from(body, base64Encoded ? 'base64' : 'utf8').toString('utf8'));
          includesReadMarker = Array.isArray(payload) && payload.some((row) => row.letter_id === letterId
            && typeof row.read_at === 'string'
            && Number.isFinite(Date.parse(row.read_at)));
        } catch { /* The exact marker assertion below will fail if the response is not valid JSON. */ }
        this.recipientReadStateResponses.push({
          includesTestLetter: request.letterIds?.includes(letterId) === true,
          status: request.status,
          requestStartedAt: request.startedAt,
          includesReadMarker,
        });
      }).catch(() => {
        this.recipientReadStateResponses.push({
          includesTestLetter: request.letterIds?.includes(letterId) === true,
          status: request.status,
          requestStartedAt: request.startedAt,
          includesReadMarker: false,
        });
      });
    });
    cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
      const request = this.pendingRequests.get(requestId);
      if (request && allowedOrigins.has(request.origin) && errorText !== 'net::ERR_ABORTED') {
        this.failedLocalRequests.push({ path: request.path, errorText });
      }
    });
    cdp.on('Runtime.exceptionThrown', () => { this.exceptionCount += 1; });
    cdp.on('Runtime.consoleAPICalled', ({ type }) => { if (type === 'error') this.consoleErrorCount += 1; });
    cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
      let origin = '';
      try { origin = new URL(request.url).origin; } catch { /* Non-HTTP requests stay blocked. */ }
      const decision = allowedOrigins.has(origin)
        ? cdp.send('Fetch.continueRequest', { requestId })
        : cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      void decision.catch((error) => active.abort(error));
    });
  }

  async evaluate(expression) {
    const result = await this.pageCdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, STEP_TIMEOUT_MS);
    if (result.exceptionDetails) throw new Error('A browser-side UI assertion could not be evaluated.');
    return result.result?.value;
  }

  async navigate(url) { await this.pageCdp.send('Page.navigate', { url }, STEP_TIMEOUT_MS); }

  async waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
      try {
        const value = await predicate();
        if (value) return value;
      } catch { /* Route transitions and initial hydration can briefly make a selector unavailable. */ }
      await sleep(200, active.signal);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
    values[name] = quoted ? (quoted[1] ?? quoted[2]) : rawValue.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

function requireLocalSupabaseUrl(rawValue) {
  let url;
  try { url = new URL(rawValue); } catch { throw new Error('.env.local has an invalid Supabase URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(hostname), 'Supabase must use localhost, 127.0.0.1, or ::1.');
  assert.equal(url.protocol, 'http:', 'The local Supabase URL must use HTTP.');
  assert.equal(url.port || '80', '54321', 'The local Supabase URL must use port 54321.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'The Supabase URL must be a plain loopback origin.');
  return url;
}

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new Error(`Port ${port} is already owned; the smoke left its process untouched.`);
    throw error;
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function guardSelfTest() {
  assert.equal(requireLocalSupabaseUrl('http://127.0.0.1:54321').origin, 'http://127.0.0.1:54321');
  assert.equal(requireLocalSupabaseUrl('http://localhost:54321/').hostname, 'localhost');
  const browserEnv = browserEnvironment();
  assert.equal(browserEnv.HOME, process.env.HOME || tmpdir(), 'The isolated browser needs the host HOME for loopback networking.');
  assert.equal(browserEnv.TMPDIR, temporaryRoot || tmpdir(), 'The isolated browser profile still uses a temporary directory.');
  assert.equal(browserEnv.SUPABASE_SERVICE_ROLE_KEY, undefined, 'The browser environment must not receive Supabase secrets.');
  for (const value of [
    'https://127.0.0.1:54321',
    'http://example.test:54321',
    'http://0.0.0.0:54321',
    'http://127.0.0.1:54322',
    'http://user:pass@127.0.0.1:54321',
    'http://127.0.0.1:54321/path',
  ]) assert.throws(() => requireLocalSupabaseUrl(value), undefined, `Rejected unsafe Supabase URL: ${value}`);

  const occupied = createServer();
  await new Promise((resolveListen, reject) => occupied.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  try {
    await assert.rejects(assertPortAvailable(address.port), /already owned/);
  } finally {
    await new Promise((resolveClose, reject) => occupied.close((error) => error ? reject(error) : resolveClose()));
  }
  console.log('[browser-send-react-smoke] PASS loopback URL, occupied-port, and isolated browser-environment guard checks.');
}

function minimalEnvironment(home = temporaryHome) {
  const environment = {
    PATH: process.env.PATH || '',
    HOME: home || tmpdir(),
    TMPDIR: temporaryRoot || tmpdir(),
  };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}

function browserEnvironment() {
  const environment = minimalEnvironment(temporaryHome);
  // Edge on macOS needs the normal HOME for its network service; the user-data-dir stays temporary.
  environment.HOME = process.env.HOME || tmpdir();
  return environment;
}

function findChromeExecutable() {
  const candidates = process.platform === 'darwin'
    ? [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    : process.platform === 'win32'
      ? [
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
      ]
      : ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      try {
        execFileSync(process.platform === 'win32' ? 'where.exe' : 'test', process.platform === 'win32' ? [candidate] : ['-x', candidate], { stdio: 'ignore' });
        return candidate;
      } catch { /* Try the next browser executable. */ }
    } else {
      try {
        return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      } catch { /* Try the next browser executable. */ }
    }
  }
  throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}.`);
  return response.json();
}

async function makeIsolatedProject() {
  temporaryProject = join(temporaryRoot, 'app');
  await cp(PROJECT_ROOT, temporaryProject, {
    recursive: true,
    filter(source) {
      const path = relative(PROJECT_ROOT, source);
      if (!path) return true;
      const parts = path.split(sep);
      const name = parts.at(-1);
      return !parts.some((part) => ['.git', '.next', '.vercel', 'node_modules'].includes(part))
        && !(parts[0] === 'supabase' && parts[1] === '.temp')
        && !(name.startsWith('.env') && name !== '.env.example');
    },
  });
  await symlink(resolve(PROJECT_ROOT, 'node_modules'), join(temporaryProject, 'node_modules'), 'dir');
  return temporaryProject;
}

async function startTemporaryApp() {
  const projectRoot = await makeIsolatedProject();
  const nextCli = resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next');
  const appEnvironment = {
    ...minimalEnvironment(),
    NEXT_PUBLIC_SUPABASE_URL: localValues.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
  console.log('[browser-send-react-smoke] Building the isolated production app for browser verification.');
  app = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: projectRoot,
    env: appEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let buildOutput = '';
  const retainBuildOutput = (chunk) => { buildOutput = `${buildOutput}${chunk}`.slice(-8_000); };
  app.stdout?.on('data', retainBuildOutput);
  app.stderr?.on('data', retainBuildOutput);
  let buildSpawnError = null;
  app.on('error', (error) => { buildSpawnError = error; });
  const buildProcess = app;
  const buildDeadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < buildDeadline && !buildSpawnError && buildProcess.exitCode === null) {
    await sleep(250, active.signal);
  }
  if (buildSpawnError || buildProcess.exitCode !== 0) {
    const reason = buildSpawnError
      ? 'could not start'
      : buildProcess.exitCode === null ? 'timed out' : `exited with code ${buildProcess.exitCode}`;
    const safeBuildOutput = buildOutput
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_URL, '[loopback Supabase URL]')
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, '[redacted anon key]')
      .trim();
    if (buildProcess.pid) await stopOwnedProcess(buildProcess, 'isolated local production build');
    app = null;
    throw new Error(`The isolated local production build ${reason}.${safeBuildOutput ? ` Build output: ${safeBuildOutput}` : ''}`);
  }
  await stopOwnedProcess(buildProcess, 'isolated local production build');
  app = spawn(process.execPath, [
    nextCli,
    'start', '--hostname', '127.0.0.1', '--port', String(TEST_PORT),
  ], {
    cwd: projectRoot,
    env: appEnvironment,
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: process.platform !== 'win32',
  });
  let spawnError = null;
  app.on('error', (error) => { spawnError = error; });
  for (let attempt = 0; attempt < APP_TIMEOUT_MS / 500; attempt += 1) {
    if (spawnError || app.exitCode !== null) throw new Error('The isolated local app failed to start.');
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* Next is compiling or binding. */ }
    await sleep(500, active.signal);
  }
  throw new Error('The isolated local app did not become ready on port 6004.');
}

async function createAccount(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `drop-send-react-${label}-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`Could not create disposable local ${label} account.`);
  const userId = data.user.id;
  createdUserIds.push(userId);
  const username = `sm_${label === 'sender' ? 's' : 'r'}_${suffix.slice(0, 8)}`;
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    username,
    display_name: label === 'sender' ? 'Smoke Sender' : 'Smoke Recipient',
    bio: '',
  });
  if (profileError) throw new Error(`Could not create disposable local ${label} profile.`);
  return { id: userId, email, username, displayName: label === 'sender' ? 'Smoke Sender' : 'Smoke Recipient' };
}

async function signInWithMagicLink(session, account) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (error || !data.properties?.action_link) throw new Error('Local Supabase could not create a disposable sign-in link.');
  const actionLink = new URL(data.properties.action_link);
  const host = actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(host), 'The generated sign-in link did not use loopback.');
  assert.equal(actionLink.protocol, 'http:');
  assert.equal(actionLink.port, '54321');
  await session.navigate(data.properties.action_link);
  await session.waitFor(() => session.evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.body.innerText.includes(${JSON.stringify(`Connected as ${account.email}.`)})`), 'local magic-link sign-in');
}

async function clickButton(session, accessibleLabel) {
  return session.evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const expected = ${JSON.stringify(accessibleLabel.toLocaleLowerCase())};
    const button = Array.from(document.querySelectorAll('button')).find((element) =>
      normalize(element.getAttribute('aria-label')) === expected
      || normalize(element.innerText) === expected);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function recipientCheckState(session, username) {
  return session.evaluate(`(() => {
    const input = document.querySelector('#drop-recipient');
    const buttons = Array.from(document.querySelectorAll('button'));
    const getLabel = (element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const isRecipientCheckLabel = (label) => /^(check(?:\\s|$)|checking|try again)/.test(label);
    const button = buttons.find((element) => isRecipientCheckLabel(getLabel(element)));
    const rawButtonLabel = button ? getLabel(button) : '';
    const safeButtonLabels = buttons.map(getLabel).filter(Boolean).map((label) => label.startsWith('check @') ? 'check @<recipient>' : label);
    return {
      inputFound: Boolean(input),
      inputLength: input?.value.length || 0,
      inputMatches: input?.value === ${JSON.stringify(username)},
      checkButtonFound: Boolean(button),
      checkButtonDisabled: button?.disabled ?? true,
      buttonLabel: rawButtonLabel.startsWith('check @') ? 'check @recipient' : rawButtonLabel,
      renderedButtonLabels: safeButtonLabels,
      accountReady: document.body.innerText.includes('Your account is ready.'),
    };
  })()`);
}

async function clickRecipientCheck(session) {
  return session.evaluate(`(() => {
    const label = (element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const button = Array.from(document.querySelectorAll('button')).find((element) => /^(check(?:\\s|$)|try again)/.test(label(element)));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function fillByKeyboard(session, selector, value) {
  const focused = await session.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field || field.disabled || field.readOnly) return false;
    field.focus();
    return document.activeElement === field;
  })()`);
  assert.equal(focused, true, `Could not focus rendered field ${selector}.`);
  await session.pageCdp.send('Input.insertText', { text: value });
}

async function setViewport(session, viewport) {
  await session.pageCdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
}

async function readDraftId(session) {
  return session.evaluate(`(() => {
    const prefix = 'dear-exe:active-letter:v1:account:';
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    if (keys.length !== 1) return null;
    try { return JSON.parse(localStorage.getItem(keys[0]) || 'null')?.id || null; }
    catch { return null; }
  })()`);
}

async function verifySentRow() {
  const { data, error } = await admin.from('letters')
    .select('id,sender_id,recipient_id,status,subject,content')
    .eq('id', letterId)
    .eq('sender_id', sender.id);
  assert.equal(error, null, 'Admin read of the disposable local send failed.');
  assert.equal(data?.length, 1, 'Expected exactly one local row for the UI-submitted drop.');
  assert.equal(data[0].recipient_id, recipient.id);
  assert.equal(data[0].status, 'delivered');
  assert.ok(data[0].subject === SUBJECT, 'The UI-submitted subject did not match the disposable drop.');
  assert.ok(data[0].content === MESSAGE, 'The UI-submitted content did not match the disposable drop.');
}

async function verifyReactionRow() {
  const { data, error } = await admin.from('letter_reactions')
    .select('letter_id,recipient_id,emoji')
    .eq('letter_id', letterId);
  assert.equal(error, null, 'Admin read of the disposable local reaction failed.');
  assert.equal(data?.length, 1, 'Expected exactly one persisted reaction row.');
  assert.equal(data[0].recipient_id, recipient.id);
  assert.equal(data[0].emoji, '🫶');
}

async function assertUnreadHomeAtBothSizes(session) {
  for (const viewport of VIEWPORTS) {
    await setViewport(session, viewport);
    const state = await session.waitFor(async () => {
      const result = await session.evaluate(`(() => {
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const card = Array.from(document.querySelectorAll('a[aria-label^="Open new drop from "]'))
          .find((element) => visible(element) && element.innerText.includes(${JSON.stringify(SUBJECT)}));
        const newLabel = Array.from(card?.querySelectorAll('span') || []).some((element) => visible(element) && element.innerText.trim().toLowerCase() === 'new');
        return { path: location.pathname, cardVisible: Boolean(card), newLabel };
      })()`);
      return result?.cardVisible && result.newLabel ? result : null;
    }, `the Home New featured card at ${viewport.name}`);
    assert.equal(state.path, '/');
    console.log(`[browser-send-react-smoke] PASS ${viewport.name}: Home shows the unread drop with New.`);
  }
}

async function waitForStableUnreadObserverHome(session) {
  const deadline = Date.now() + OBSERVER_HOME_STABILITY_TIMEOUT_MS;
  let stableSince = Date.now();
  let documentTimeOrigin = null;

  while (Date.now() < deadline) {
    const state = await session.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('a[aria-label^="Open new drop from "]'))
        .find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
      const pill = Array.from(card?.querySelectorAll('span') || [])
        .map((element) => element.innerText.trim().toLowerCase())
        .find((text) => ['new', 'in your inbox'].includes(text)) || null;
      return {
        path: location.pathname,
        visibility: document.visibilityState,
        pill,
        inboxNewMarkers: document.querySelectorAll('[aria-label="New unread drop"]').length,
        timeOrigin: performance.timeOrigin,
      };
    })()`);

    if (state?.path === '/' && state.visibility === 'visible' && state.pill === 'new' && state.inboxNewMarkers > 0) {
      if (documentTimeOrigin === null) {
        documentTimeOrigin = state.timeOrigin;
        stableSince = Date.now();
      } else if (state.timeOrigin !== documentTimeOrigin) {
        documentTimeOrigin = state.timeOrigin;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= OBSERVER_HOME_STABILITY_MS) {
        return documentTimeOrigin;
      }
    } else {
      documentTimeOrigin = null;
      stableSince = Date.now();
    }
    await sleep(200, active.signal);
  }

  throw new Error('The observer Home document did not stabilize after recipient sign-in.');
}

async function assertReadStateSyncInOpenHome(session, priorReadStateResponseCount, priorDocumentRequestCount, documentTimeOrigin, readMarkerResponseAt) {
  const getHomeState = () => session.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('a')).find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
      if (!card) return null;
      const pill = Array.from(card.querySelectorAll('span'))
        .map((element) => element.innerText.trim().toLowerCase())
        .find((text) => ['new', 'in your inbox'].includes(text)) || null;
      return {
        path: location.pathname,
        visibility: document.visibilityState,
        pill,
        inboxNewMarkers: document.querySelectorAll('[aria-label="New unread drop"]').length,
        timeOrigin: performance.timeOrigin,
      };
    })()`);
  const findReadStateResponse = () => session.recipientReadStateResponses
    .slice(priorReadStateResponseCount)
    .find((response) => response.status === 200
      && response.requestStartedAt > readMarkerResponseAt
      && response.includesTestLetter
      && response.includesReadMarker);
  let result;
  try {
    result = await session.waitFor(async () => {
      const state = await getHomeState();
      if (state?.path === '/' && state.timeOrigin !== documentTimeOrigin) {
        return { documentReplaced: true, state };
      }
      const refreshedReadState = findReadStateResponse();
      return state?.path === '/'
        && state.pill === 'in your inbox'
        && state.inboxNewMarkers === 0
        && state.timeOrigin === documentTimeOrigin
        && refreshedReadState
        ? { state, refreshedReadState }
        : null;
    }, 'the open second recipient session to clear New from the server refresh without reload', CROSS_SESSION_READ_TIMEOUT_MS);
  } catch (error) {
    const state = await getHomeState().catch(() => null);
    const readStateResponses = session.recipientReadStateResponses
      .slice(priorReadStateResponseCount)
      .map((response) => ({
        status: response.status,
        includesTestLetter: response.includesTestLetter,
        includesReadMarker: response.includesReadMarker,
        startedAfterRead: response.requestStartedAt > readMarkerResponseAt,
      }));
    const mainDocumentRequests = session.mainDocumentRequests.slice(priorDocumentRequestCount);
    throw new Error(`${error.message}; observer diagnostics=${JSON.stringify({
      state,
      expectedTimeOrigin: documentTimeOrigin,
      sameDocument: state?.timeOrigin === documentTimeOrigin,
      mainDocumentRequests,
      readStateResponseCount: readStateResponses.length,
      readStateResponses,
    })}`);
  }
  if (result.documentReplaced) {
    const mainDocumentRequests = session.mainDocumentRequests.slice(priorDocumentRequestCount);
    throw new Error(`The observer Home document was replaced during the sync window; observer diagnostics=${JSON.stringify({
      state: result.state,
      expectedTimeOrigin: documentTimeOrigin,
      mainDocumentRequests,
      readStateResponseCount: session.recipientReadStateResponses.slice(priorReadStateResponseCount).length,
    })}`);
  }

  assert.equal(result.state.path, '/', 'The observer session should stay on Home while its unread state synchronizes.');
  assert.equal(result.state.pill, 'in your inbox', 'The observer Home card should reflect the server read marker.');
  assert.equal(result.state.inboxNewMarkers, 0, 'The observer Home inbox should no longer mark the drop New.');
  assert.equal(result.state.timeOrigin, documentTimeOrigin, 'The observer page should synchronize without a reload.');
  console.log('[browser-send-react-smoke] PASS second recipient session cleared New from Home through its loopback read-state refresh without reload.');
}

async function openFromInbox(session) {
  await session.navigate(`${APP_ORIGIN}/mailbox`);
  await session.waitFor(() => session.evaluate(`location.pathname === '/mailbox'
    && document.body.innerText.includes('A mailbox for your people.')
    && document.body.innerText.includes(${JSON.stringify(SUBJECT)})`), 'recipient Inbox and delivered drop');
  const cardClicked = await session.evaluate(`(() => {
    const link = Array.from(document.querySelectorAll('a')).find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
    if (!link) return false;
    link.click();
    return true;
  })()`);
  assert.equal(cardClicked, true, 'Could not open the delivered drop from Inbox.');
  await session.waitFor(() => session.evaluate(`location.pathname.startsWith('/letter/')`), 'received drop details');
  await session.waitFor(() => session.evaluate(`document.body.innerText.toLocaleLowerCase().includes('reveal fragments')`), 'sealed received drop detail');
  assert.equal(await clickButton(session, 'Reveal fragments'), true, 'Could not activate Reveal fragments.');
  await session.waitFor(() => session.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => button.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'open received drop')`), 'Open received drop control');
  assert.equal(await clickButton(session, 'Open received drop'), true, 'Could not activate Open received drop.');
  await session.waitFor(() => session.evaluate(`document.querySelector('#letter-body')?.innerText.includes(${JSON.stringify(MESSAGE)})`), 'full recipient message');
  await session.waitFor(
    () => session.readMarkerStatuses.some((marker) => marker.letterId === letterId && marker.status === 200),
    'successful read marker for this exact drop',
  );
  console.log('[browser-send-react-smoke] PASS recipient opened the full drop through Inbox and its read marker succeeded.');
}

async function assertReadStateCleared(session) {
  await session.navigate(`${APP_ORIGIN}/`);
  const home = await session.waitFor(async () => {
    const state = await session.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('a')).find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
    if (!card) return null;
    const pill = Array.from(card.querySelectorAll('span')).map((element) => element.innerText.trim().toLowerCase()).find((text) => ['new', 'in your inbox'].includes(text)) || null;
    const inboxNewMarkers = document.querySelectorAll('[aria-label="New unread drop"]').length;
    return { path: location.pathname, pill, inboxNewMarkers };
    })()`);
    return state?.pill === 'in your inbox' && state.inboxNewMarkers === 0 ? state : null;
  }, 'read Home featured state');
  assert.equal(home.path, '/');
  assert.equal(home.pill, 'in your inbox', 'Home should stop labeling the opened drop New.');
  assert.equal(home.inboxNewMarkers, 0, 'The Home inbox list should have no New badge after opening.');

  await session.navigate(`${APP_ORIGIN}/mailbox`);
  const inbox = await session.waitFor(async () => {
    const state = await session.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('a')).find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
    if (!card || !document.body.innerText.includes('A mailbox for your people.')) return null;
    return { cardNew: Boolean(card.querySelector('[aria-label="New unread drop"]')), path: location.pathname };
    })()`);
    return state?.path === '/mailbox' && !state.cardNew ? state : null;
  }, 'read Inbox state');
  assert.equal(inbox.path, '/mailbox');
  assert.equal(inbox.cardNew, false, 'The Inbox New badge should clear after opening.');
  console.log('[browser-send-react-smoke] PASS New cleared from Home and Inbox after the recipient opened the drop.');
}

async function cleanup() {
  for (const session of sessions) {
    session.pageCdp?.close();
    session.browserCdp?.close();
  }
  const ownedChildren = sessions.map((session) => [session.browser, 'isolated Chrome']);
  ownedChildren.push([app, 'isolated Next app']);
  for (const [child, label] of ownedChildren) {
    if (!child) continue;
    try { await stopOwnedProcess(child, label); }
    catch { cleanupFailed = true; console.error(`[browser-send-react-smoke] CLEANUP FAILED: could not stop this smoke’s ${label}.`); }
  }

  if (admin) {
    if (letterId && sender?.id && /^draft-[a-f0-9-]{36}$/i.test(letterId)) {
      const { data: deletedRows, error } = await admin
        .from('letters')
        .delete()
        .eq('id', letterId)
        .eq('sender_id', sender.id)
        .select('id');
      const { data: remainingRow, error: verifyError } = await admin
        .from('letters')
        .select('id')
        .eq('id', letterId)
        .eq('sender_id', sender.id)
        .maybeSingle();
      if (error || (deletedRows?.length || 0) > 1 || verifyError || remainingRow) {
        cleanupFailed = true;
        console.error('[browser-send-react-smoke] CLEANUP FAILED: the exact sender-owned test drop was not removed and verified absent.');
      }
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
      const { data, error: verifyError } = await admin.auth.admin.getUserById(userId);
      if (data.user || (verifyError && verifyError.status !== 404)) {
        cleanupFailed = true;
        console.error('[browser-send-react-smoke] CLEANUP FAILED: a disposable local account remains or could not be verified absent.');
      }
    }
    if (createdUserIds.length > 0) {
      const { data: profiles, error } = await admin.from('profiles').select('id').in('id', createdUserIds);
      if (error || profiles?.length > 0) {
        cleanupFailed = true;
        console.error('[browser-send-react-smoke] CLEANUP FAILED: a disposable local profile remains or could not be verified absent.');
      }
    }
  }
  if (temporaryRoot) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-send-react-smoke] CLEANUP FAILED: could not remove temporary app/browser profiles.');
    }
  }
}

async function stopOwnedProcess(child, label) {
  if (!child) return;
  if (await waitForOwnedProcessExit(child, 0)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not stop ${label}.`); }
  if (await waitForOwnedProcessExit(child, 10_000)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not force-stop ${label}.`); }
  const stopped = await waitForOwnedProcessExit(child, 5_000);
  if (!stopped) throw new Error(`This smoke’s ${label} process did not exit.`);
}

async function waitForOwnedProcessExit(child, timeoutMs) {
  const hasStopped = () => process.platform === 'win32'
    ? child.exitCode !== null || child.signalCode !== null
    : !processGroupExists(child.pid);
  const deadline = Date.now() + timeoutMs;
  while (!hasStopped()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(100, remaining));
  }
  return true;
}

function processGroupExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function sleep(milliseconds, signal) {
  return new Promise((resolveSleep, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveSleep();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Interrupted.'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function main() {
  if (process.argv.includes('--guard-self-test')) return guardSelfTest();
  assert.deepEqual(process.argv.slice(2), [], 'This smoke has no options other than --guard-self-test.');

  // Check before reading credentials or touching Supabase. Never stop an existing port owner.
  await assertPortAvailable(TEST_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local with the local Supabase URL, anon key, and service-role key first.');
  });
  localValues = parseEnvFile(envText);
  const supabaseUrl = requireLocalSupabaseUrl(localValues.NEXT_PUBLIC_SUPABASE_URL || '');
  assert.ok(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY && localValues.SUPABASE_SERVICE_ROLE_KEY, '.env.local needs local anon and service-role keys.');
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Install project dependencies before running this smoke.');
  for (const alias of ['localhost', '127.0.0.1', '[::1]']) allowedOrigins.add(`http://${alias}:54321`);

  const health = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, `Loopback Supabase Auth health check returned HTTP ${health.status}.`);
  admin = createClient(supabaseUrl.origin, localValues.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-send-react-'));
  temporaryHome = join(temporaryRoot, 'home');
  await mkdir(temporaryHome, { recursive: true });
  try {
    currentStep = 'starting the isolated Next app';
    await startTemporaryApp();
    currentStep = 'creating disposable local accounts';
    sender = await createAccount('sender');
    recipient = await createAccount('recipient');
    console.log('[browser-send-react-smoke] Created two uniquely named disposable local accounts.');

    const senderSession = new BrowserSession('sender');
    const recipientSession = new BrowserSession('recipient');
    sessions.push(senderSession, recipientSession);
    currentStep = 'starting isolated browser sessions';
    await Promise.all([senderSession.launch(), recipientSession.launch()]);

    currentStep = 'opening sender sign-in screen';
    await senderSession.navigate(`${APP_ORIGIN}/profile`);
    await senderSession.waitFor(() => senderSession.evaluate(`location.pathname === '/profile' && Boolean(document.querySelector('#account-email'))`), 'sender sign-in screen');
    currentStep = 'signing in sender';
    await signInWithMagicLink(senderSession, sender);
    currentStep = 'opening sender Compose';
    await senderSession.navigate(`${APP_ORIGIN}/compose?new=1`);
    await senderSession.waitFor(() => senderSession.evaluate(`location.pathname === '/compose' && Boolean(document.querySelector('#drop-recipient')) && Boolean(document.querySelector('#drop-content'))`), 'rendered Compose form');
    await senderSession.waitFor(() => senderSession.evaluate(`document.body.innerText.includes('Your account is ready.')`), 'connected sender account in Compose');

    currentStep = 'submitting the sender Compose form';
    await fillByKeyboard(senderSession, '#drop-recipient', recipient.username);
    let recipientControls;
    try {
      recipientControls = await senderSession.waitFor(async () => {
        const state = await recipientCheckState(senderSession, recipient.username);
        return state.inputMatches && state.checkButtonFound && !state.checkButtonDisabled && !state.buttonLabel.startsWith('checking') ? state : null;
      }, 'enabled recipient handle confirmation control');
    } catch (error) {
      const state = await recipientCheckState(senderSession, recipient.username);
      throw new Error(`${error.message}; recipient controls=${JSON.stringify(state)}`);
    }
    assert.equal(recipientControls.inputMatches, true);
    assert.equal(recipientControls.checkButtonDisabled, false);
    assert.equal(await clickRecipientCheck(senderSession), true, 'Could not check the recipient handle in Compose.');
    await senderSession.waitFor(() => senderSession.evaluate(`document.body.innerText.includes(${JSON.stringify(`Recipient confirmed: Smoke Recipient (@${recipient.username})`)})`), 'confirmed recipient handle');
    await fillByKeyboard(senderSession, '#drop-subject', SUBJECT);
    await fillByKeyboard(senderSession, '#drop-content', MESSAGE);
    const draftId = await readDraftId(senderSession);
    assert.match(draftId || '', /^draft-[a-f0-9-]{36}$/i, 'The rendered sender draft did not have a cleanable ID.');
    letterId = draftId;
    assert.equal(await clickButton(senderSession, 'Send drop'), true, 'Could not submit Send drop from Compose.');
    await senderSession.waitFor(() => senderSession.evaluate(`location.pathname === '/sent' && new URL(location.href).searchParams.get('letter') === ${JSON.stringify(letterId)}`), 'sender success receipt from Compose');
    await verifySentRow();
    console.log('[browser-send-react-smoke] PASS sender sent the known-handle text drop through Compose; one delivered row is persisted.');

    currentStep = 'opening sender mailbox for the live reaction';
    await senderSession.navigate(`${APP_ORIGIN}/mailbox`);
    await senderSession.waitFor(() => senderSession.evaluate(`location.pathname === '/mailbox'
      && document.body.innerText.includes('A mailbox for your people.')
      && document.body.innerText.includes(${JSON.stringify(SUBJECT)})`), 'sender Sent mailbox and realtime subscription setup');
    await senderSession.waitFor(() => senderSession.reactionChannelObserved, 'sender realtime websocket');

    currentStep = 'signing in recipient';
    await recipientSession.navigate(`${APP_ORIGIN}/profile`);
    await recipientSession.waitFor(() => recipientSession.evaluate(`location.pathname === '/profile' && Boolean(document.querySelector('#account-email'))`), 'recipient sign-in screen');
    await signInWithMagicLink(recipientSession, recipient);
    currentStep = 'checking Home unread state';
    await recipientSession.navigate(`${APP_ORIGIN}/`);
    await assertUnreadHomeAtBothSizes(recipientSession);

    currentStep = 'signing in the same recipient from a second isolated browser';
    const recipientObserverSession = new BrowserSession('recipient-observer');
    sessions.push(recipientObserverSession);
    await recipientObserverSession.launch();
    await recipientObserverSession.navigate(`${APP_ORIGIN}/profile`);
    await recipientObserverSession.waitFor(() => recipientObserverSession.evaluate(`location.pathname === '/profile' && Boolean(document.querySelector('#account-email'))`), 'second recipient sign-in screen');
    await signInWithMagicLink(recipientObserverSession, recipient);
    await recipientObserverSession.navigate(`${APP_ORIGIN}/`);
    await assertUnreadHomeAtBothSizes(recipientObserverSession);
    await setViewport(recipientObserverSession, VIEWPORTS[0]);
    console.log('[browser-send-react-smoke] PASS both isolated sessions for the same recipient show the exact drop as New.');

    currentStep = 'stabilizing the second recipient session on unread Home';
    const stableObserverDocumentTimeOrigin = await waitForStableUnreadObserverHome(recipientObserverSession);
    const priorReadStateResponseCount = recipientObserverSession.recipientReadStateResponses.length;
    const priorDocumentRequestCount = recipientObserverSession.mainDocumentRequests.length;

    currentStep = 'opening the drop and reacting in recipient UI';
    await openFromInbox(recipientSession);
    assert.equal(await clickButton(recipientSession, 'React with heart hands'), true, 'Could not select the rendered heart-hands reaction.');
    await recipientSession.waitFor(() => recipientSession.evaluate(`document.body.innerText.includes('Reaction sent.')`), 'recipient UI reaction confirmation');
    await verifyReactionRow();
    currentStep = 'checking read-state clearing';
    await assertReadStateCleared(recipientSession);
    const readMarkerResponse = recipientSession.readMarkerStatuses.find((marker) => marker.letterId === letterId && marker.status === 200);
    assert.ok(readMarkerResponse, 'The primary recipient browser did not receive the successful read marker response.');
    await assertReadStateSyncInOpenHome(recipientObserverSession, priorReadStateResponseCount, priorDocumentRequestCount, stableObserverDocumentTimeOrigin, readMarkerResponse.responseAt);
    console.log('[browser-send-react-smoke] PASS recipient sent 🫶 from the opened drop UI; one reaction row is persisted.');

    currentStep = 'checking sender live reaction';
    const senderLiveReaction = await senderSession.waitFor(() => senderSession.evaluate(`(() => {
      const body = document.body.innerText.toLocaleLowerCase();
      return location.pathname === '/mailbox'
        && body.includes(${JSON.stringify(SUBJECT.toLocaleLowerCase())})
        && body.includes('a little love back')
        && body.includes('reacted 🫶 to')
        ? true : false;
    })()`), 'live reaction on the sender mailbox before reload');
    assert.equal(senderLiveReaction, true);
    console.log('[browser-send-react-smoke] PASS sender mailbox showed the live reaction before reload.');

    currentStep = 'checking sender reaction after reload';
    await senderSession.pageCdp.send('Page.reload');
    await senderSession.waitFor(() => senderSession.evaluate(`(() => {
      const body = document.body.innerText.toLocaleLowerCase();
      return location.pathname === '/mailbox'
        && body.includes('a mailbox for your people.')
        && body.includes(${JSON.stringify(SUBJECT.toLocaleLowerCase())})
        && body.includes('they reacted 🫶');
    })()`), 'persisted reaction after sender mailbox reload');
    console.log('[browser-send-react-smoke] PASS sender mailbox still shows 🫶 after reload.');

    for (const session of sessions) {
      assert.deepEqual(session.failedLocalRequests, [], `${session.name} browser had a failed local request.`);
      assert.equal(session.blockedExternalOrigins.size, 0, `${session.name} browser attempted a non-local network request.`);
      assert.equal(session.consoleErrorCount, 0, `${session.name} browser recorded a console error.`);
      assert.equal(session.exceptionCount, 0, `${session.name} browser recorded a runtime exception.`);
    }
    console.log('[browser-send-react-smoke] PASS all isolated browser sessions stayed on the app and loopback Supabase origins.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The smoke finished with cleanup failures; see the cleanup messages above.');
}

const onSignal = (signal) => active.abort(new Error(`Received ${signal}; cleaning up the local smoke.`));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  console.log('[browser-send-react-smoke] PASS exact local cleanup completed; main port 4004 and hosted Supabase were untouched.');
}).catch((error) => {
  active.abort(error);
  console.error(`[browser-send-react-smoke] FAIL during ${currentStep}: ${error?.message || 'unexpected failure'}`);
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
