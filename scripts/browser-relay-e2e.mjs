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
import { assertTrustedLocalSupabaseListener } from './localSupabaseListener.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const BUILD_TIMEOUT_MS = 180_000;
const APP_TIMEOUT_MS = 60_000;
const BROWSER_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const BROWSER_HOST_RESOLVER_RULES = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1';
const active = new AbortController();
const allowedOrigins = new Set([APP_ORIGIN]);
const createdUserIds = [];
const disposableDrops = [];
const sessions = [];

let localValues = {};
let supabaseUrl;
let localSupabaseFetch;
let admin;
let app;
let temporaryRoot;
let cleanupFailed = false;
let currentStep = 'initializing';
let sender;
let recipient;
let carrier;

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
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || 'DevTools command failed'}`));
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
      const timer = setTimeout(() => reject(new Error('Timed out connecting to isolated browser DevTools.')), 5_000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('Interrupted while connecting to isolated browser DevTools.'));
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
        reject(new Error('Could not connect to isolated browser DevTools.'));
      }, { once: true });
    });
    return new CdpConnection(socket, signal);
  }

  on(method, listener) {
    const listenersForMethod = this.listeners.get(method) || new Set();
    listenersForMethod.add(listener);
    this.listeners.set(method, listenersForMethod);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`DevTools closed before ${method}.`));
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
        reject(new Error(`Timed out waiting for DevTools command ${method}.`));
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
    this.profile = join(temporaryRoot, `browser-${name}`);
    this.browser = null;
    this.browserCdp = null;
    this.pageCdp = null;
    this.spawnError = null;
    this.externalOrigins = new Set();
    this.failedRequests = [];
    this.consoleErrors = 0;
    this.runtimeExceptions = 0;
  }

  async launch() {
    if (typeof WebSocket !== 'function') throw new Error('This smoke needs Node built-in WebSocket support.');
    this.browser = spawn(findBrowserExecutable(), [
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
      `--host-resolver-rules=${BROWSER_HOST_RESOLVER_RULES}`,
      'about:blank',
    ], {
      env: browserEnvironment(),
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.browser.on('error', (error) => { this.spawnError = error; });
    const devTools = await this.waitForDevTools();
    this.browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
    await this.browserCdp.send('Browser.setPermission', {
      origin: APP_ORIGIN,
      permission: { name: 'geolocation' },
      setting: 'denied',
    });
    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    this.pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
    this.observeNetwork();
    await Promise.all([
      this.pageCdp.send('Page.enable'),
      this.pageCdp.send('Runtime.enable'),
      this.pageCdp.send('Network.enable'),
      this.pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
      this.pageCdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          Object.defineProperty(window, '__dropGeoCalls', { configurable: true, writable: true, value: 0 });
          const geolocation = navigator.geolocation;
          for (const method of ['getCurrentPosition', 'watchPosition']) {
            const original = geolocation[method].bind(geolocation);
            Object.defineProperty(geolocation, method, {
              configurable: true,
              writable: true,
              value: (...args) => { window.__dropGeoCalls += 1; return original(...args); },
            });
          }
        })();`,
      }),
      this.pageCdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      }),
      this.pageCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }),
    ]);
  }

  async waitForDevTools() {
    const file = join(this.profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < BROWSER_TIMEOUT_MS / 100; attempt += 1) {
      if (this.spawnError) throw new Error('An isolated browser process could not start.');
      if (this.browser.exitCode !== null) throw new Error('An isolated browser process exited before DevTools was ready.');
      try {
        const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
        const port = Number(lines[0]);
        if (Number.isInteger(port) && port > 0) return { port, path: lines[1] };
      } catch { /* DevTools has not published its port yet. */ }
      await sleep(100, active.signal);
    }
    throw new Error('Isolated browser DevTools did not start in time.');
  }

  observeNetwork() {
    const cdp = this.pageCdp;
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      let parsed;
      try { parsed = new URL(request.url); } catch { return; }
      if (/^https?:$/.test(parsed.protocol) && !allowedOrigins.has(parsed.origin)) this.externalOrigins.add(parsed.origin);
    });
    cdp.on('Network.webSocketCreated', ({ url }) => {
      try {
        const parsed = new URL(url);
        const origin = `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
        if (!['ws:', 'wss:'].includes(parsed.protocol) || !allowedOrigins.has(origin)) this.externalOrigins.add(origin);
      } catch { this.externalOrigins.add('invalid-websocket-origin'); }
    });
    cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
      if (errorText !== 'net::ERR_ABORTED') this.failedRequests.push({ requestId, errorText });
    });
    cdp.on('Runtime.exceptionThrown', () => { this.runtimeExceptions += 1; });
    cdp.on('Runtime.consoleAPICalled', ({ type }) => { if (type === 'error') this.consoleErrors += 1; });
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
    if (result.exceptionDetails) throw new Error('A browser-side assertion failed.');
    return result.result?.value;
  }

  async navigate(url) {
    const target = new URL(url);
    assert.ok(allowedOrigins.has(target.origin), 'The smoke navigates only to the isolated app and local Supabase.');
    await this.pageCdp.send('Page.navigate', { url }, STEP_TIMEOUT_MS);
  }

  async waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
      try {
        const value = await predicate();
        if (value) return value;
      } catch { /* React may briefly unmount route content during navigation. */ }
      await sleep(200, active.signal);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }
}

function parseEnvValue(source, expectedName) {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] !== expectedName) continue;
    const rawValue = match[2];
    const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
    return quoted ? (quoted[1] ?? quoted[2]) : rawValue.replace(/\s+#.*$/, '').trim();
  }
  return '';
}

function requireLocalSupabaseUrl(rawValue) {
  let url;
  try { url = new URL(rawValue); } catch { throw new Error('.env.local has an invalid Supabase URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(hostname), 'Supabase must use a loopback host.');
  assert.equal(url.protocol, 'http:', 'Local Supabase must use HTTP.');
  assert.equal(url.port || '80', '54321', 'Local Supabase must use port 54321.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Supabase URL must be a plain loopback origin.');
  return url;
}

function readLocalSupabaseConfig(source) {
  const urlValue = parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_URL');
  const parsedUrl = requireLocalSupabaseUrl(urlValue);
  const anonKey = parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = parseEnvValue(source, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.ok(anonKey && serviceRoleKey, '.env.local is missing required local Supabase values.');
  return {
    supabaseUrl: parsedUrl,
    values: {
      NEXT_PUBLIC_SUPABASE_URL: urlValue,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
  };
}

function createLocalSupabaseFetch(expectedUrl) {
  return (input, init = {}) => {
    const rawUrl = input && typeof input === 'object' && 'url' in input ? input.url : String(input);
    let target;
    try { target = new URL(rawUrl); }
    catch { throw new Error('A Supabase smoke request used an invalid URL.'); }
    const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(hostname) || target.origin !== expectedUrl.origin) {
      throw new Error('A Supabase smoke request left its validated loopback origin.');
    }
    return fetch(input, { ...init, redirect: 'error' });
  };
}

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolveListen));
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new Error(`Port ${port} is already owned; the smoke left its process untouched.`);
    throw error;
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

function browserEnvironment() {
  const environment = { PATH: process.env.PATH || '', HOME: process.env.HOME || tmpdir(), TMPDIR: temporaryRoot || tmpdir() };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}

function baseAppEnvironment() {
  return {
    PATH: process.env.PATH || '',
    HOME: temporaryRoot || tmpdir(),
    TMPDIR: temporaryRoot || tmpdir(),
    NEXT_PUBLIC_SUPABASE_URL: localValues.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
}

function guardSelfTest() {
  assert.equal(requireLocalSupabaseUrl('http://127.0.0.1:54321').origin, 'http://127.0.0.1:54321');
  assert.equal(requireLocalSupabaseUrl('http://localhost:54321/').hostname, 'localhost');
  assert.equal(requireLocalSupabaseUrl('http://[::1]:54321').origin, 'http://[::1]:54321');
  for (const value of [
    'https://127.0.0.1:54321', 'http://example.test:54321', 'http://0.0.0.0:54321',
    'http://127.0.0.1:54322', 'http://user:pass@127.0.0.1:54321', 'http://127.0.0.1:54321/path',
  ]) assert.throws(() => requireLocalSupabaseUrl(value));
  assert.throws(() => readLocalSupabaseConfig('NEXT_PUBLIC_SUPABASE_URL=https://example.test\nNEXT_PUBLIC_SUPABASE_ANON_KEY=not-read\nSUPABASE_SERVICE_ROLE_KEY=not-read'));
  const localFetch = createLocalSupabaseFetch(new URL('http://127.0.0.1:54321'));
  assert.throws(() => localFetch('https://example.test/auth/v1/health'));
  assert.equal(APP_PORT, 6004, 'Use the project mapped browser QA port.');
  assert.equal(browserEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(baseAppEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined);
  console.log('[browser-relay-e2e] PASS loopback URL and browser/server secret-boundary guard checks.');
}

function findBrowserExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
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
      } catch { /* Try the next installed browser. */ }
    } else {
      try {
        return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      } catch { /* Try the next installed browser. */ }
    }
  }
  throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Isolated browser DevTools returned HTTP ${response.status}.`);
  return response.json();
}

async function makeIsolatedProject() {
  const temporaryProject = join(temporaryRoot, 'app');
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
  const buildEnvironment = baseAppEnvironment();
  console.log('[browser-relay-e2e] Building isolated production app.');
  app = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: projectRoot,
    env: buildEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let buildOutput = '';
  const retainBuildOutput = (chunk) => { buildOutput = `${buildOutput}${chunk}`.slice(-6_000); };
  app.stdout?.on('data', retainBuildOutput);
  app.stderr?.on('data', retainBuildOutput);
  let spawnError = null;
  app.on('error', (error) => { spawnError = error; });
  const buildProcess = app;
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline && !spawnError && buildProcess.exitCode === null) await sleep(250, active.signal);
  if (spawnError || buildProcess.exitCode !== 0) {
    const reason = spawnError ? 'could not start' : buildProcess.exitCode === null ? 'timed out' : `exited with code ${buildProcess.exitCode}`;
    const safeOutput = redact(buildOutput).trim();
    if (buildProcess.pid) await stopOwnedProcess(buildProcess, 'isolated production build');
    app = null;
    throw new Error(`The isolated local production build ${reason}.${safeOutput ? ` Build output: ${safeOutput}` : ''}`);
  }
  await stopOwnedProcess(buildProcess, 'isolated production build');
  const runtimeEnvironment = { ...buildEnvironment, SUPABASE_SERVICE_ROLE_KEY: localValues.SUPABASE_SERVICE_ROLE_KEY };
  app = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(APP_PORT)], {
    cwd: projectRoot,
    env: runtimeEnvironment,
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: process.platform !== 'win32',
  });
  let serverSpawnError = null;
  app.on('error', (error) => { serverSpawnError = error; });
  for (let attempt = 0; attempt < APP_TIMEOUT_MS / 500; attempt += 1) {
    if (serverSpawnError || app.exitCode !== null) throw new Error('The isolated local app failed to start.');
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* The isolated server is still starting. */ }
    await sleep(500, active.signal);
  }
  throw new Error('The isolated local app did not become ready on port 6004.');
}

function redact(value) {
  return String(value)
    .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_URL || '\u0000', '[local Supabase URL]')
    .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY || '\u0000', '[redacted anon key]')
    .replaceAll(localValues.SUPABASE_SERVICE_ROLE_KEY || '\u0000', '[redacted service key]');
}

function client() {
  return createClient(supabaseUrl.origin, localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: localSupabaseFetch },
  });
}

async function createAccount(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `drop-relay-e2e-${label}-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const displayName = `Pilot ${label[0].toUpperCase()}${label.slice(1)} ${suffix.slice(0, 4)}`;
  const username = `relay_${label.slice(0, 1)}_${suffix.slice(0, 8)}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`Could not create a disposable local ${label} account.`);
  createdUserIds.push(data.user.id);
  const account = {
    id: data.user.id,
    email,
    password,
    client: client(),
    username,
    displayName,
  };
  const { error: profileError } = await admin.from('profiles').insert({
    id: account.id,
    username: account.username,
    display_name: account.displayName,
    bio: '',
  });
  if (profileError) throw new Error(`Could not create the disposable local ${label} profile.`);
  return account;
}

async function signInWithMagicLink(session, account) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (error || !data.properties?.action_link) throw new Error('Local Supabase could not create a disposable sign-in link.');
  const actionLink = new URL(data.properties.action_link);
  assert.equal(actionLink.protocol, 'http:');
  assert.equal(actionLink.port, '54321');
  assert.ok(LOOPBACK_HOSTS.has(actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'Sign-in link must use loopback.');
  await session.navigate(data.properties.action_link);
  await session.waitFor(() => session.evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.body.innerText.includes(${JSON.stringify(`Connected as ${account.email}.`)})`), 'local magic-link sign-in');
}

async function createRelayDropThroughCompose(session) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const subject = `Relay pilot subject ${suffix}`;
  const content = `RELAY_PRIVATE_SENTINEL_${suffix}`;
  await session.navigate(`${APP_ORIGIN}/compose?new=1&mode=relay`);
  await session.waitFor(() => session.evaluate(`location.pathname === '/compose'
    && Boolean(document.querySelector('#drop-recipient'))
    && Boolean(document.querySelector('#drop-subject'))
    && Boolean(document.querySelector('#drop-content'))`), 'rendered Relay Compose form');
  await session.waitFor(() => pageIncludes(session, 'Your account is ready.'), 'connected sender account in Relay Compose');
  await assertNoHorizontalOverflow(session, 'Sender Relay Compose page');
  const relaySelected = await session.evaluate(`Array.from(document.querySelectorAll('button'))
    .some((button) => button.innerText.replace(/\\s+/g, ' ').includes('Make a journey')
      && button.getAttribute('aria-pressed') === 'true')`);
  assert.equal(relaySelected, true, 'Compose did not start with Relay mode selected.');

  await fillByKeyboard(session, '#drop-recipient', recipient.username);
  let recipientControls;
  try {
    recipientControls = await session.waitFor(async () => {
      const state = await recipientCheckState(session, recipient.username);
      return state.inputMatches && state.checkButtonFound && !state.checkButtonDisabled
        && !state.buttonLabel.startsWith('checking') ? state : null;
    }, 'enabled recipient handle confirmation control');
  } catch (error) {
    const state = await recipientCheckState(session, recipient.username);
    throw new Error(`${error.message}; recipient controls=${JSON.stringify(state)}`);
  }
  assert.equal(recipientControls.inputMatches, true);
  assert.equal(recipientControls.checkButtonDisabled, false);
  assert.equal(await clickRecipientCheck(session), true, 'Could not check the recipient handle in Compose.');
  await session.waitFor(() => pageIncludes(session, `Recipient confirmed: ${recipient.displayName} (@${recipient.username})`), 'confirmed Relay recipient handle');
  await fillByKeyboard(session, '#drop-subject', subject);
  await fillByKeyboard(session, '#drop-content', content);
  const letterId = await session.evaluate(`(() => {
    const prefix = 'dear-exe:active-letter:v1:account:';
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    if (keys.length !== 1) return null;
    try { return JSON.parse(localStorage.getItem(keys[0]) || 'null')?.id || null; }
    catch { return null; }
  })()`);
  assert.match(letterId || '', /^draft-[a-f0-9-]{36}$/i, 'The rendered Relay Compose draft did not have a cleanable ID.');
  disposableDrops.push({ letterId, senderId: sender.id });
  await clickButton(session, 'Send drop');
  await session.waitFor(() => session.evaluate(`location.pathname === '/sent'
    && new URL(location.href).searchParams.get('letter') === ${JSON.stringify(letterId)}`), 'sender Relay success receipt from Compose');

  const { data, error } = await admin.from('letters')
    .select('id,sender_id,recipient_id,status,subject,content,payload_kind,delivery_mode')
    .eq('id', letterId)
    .eq('sender_id', sender.id);
  assert.equal(error, null, 'Admin read of the disposable local Relay send failed.');
  assert.equal(data?.length, 1, 'Expected exactly one local row for the UI-submitted Relay drop.');
  assert.equal(data[0].recipient_id, recipient.id);
  assert.equal(data[0].status, 'dispatched');
  assert.equal(data[0].subject, subject);
  assert.equal(data[0].content, content);
  assert.equal(data[0].payload_kind, 'text');
  assert.equal(data[0].delivery_mode, 'relay');
  console.log('[browser-relay-e2e] PASS sender created a text Relay drop through the rendered mobile Compose flow.');
  return { letterId, subject, content };
}

async function createBrowserSession(name, account) {
  const session = new BrowserSession(name);
  sessions.push(session);
  await session.launch();
  await signInWithMagicLink(session, account);
  return session;
}

async function clickButton(session, label) {
  const clicked = await session.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === ${JSON.stringify(label.toLocaleLowerCase())});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not activate the visible “${label}” button.`);
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

async function recipientCheckState(session, username) {
  return session.evaluate(`(() => {
    const input = document.querySelector('#drop-recipient');
    const buttons = Array.from(document.querySelectorAll('button'));
    const getLabel = (element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const button = buttons.find((element) => /^(check(?:\\s|$)|checking|try again)/.test(getLabel(element)));
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
    };
  })()`);
}

async function clickRecipientCheck(session) {
  return session.evaluate(`(() => {
    const label = (element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const button = Array.from(document.querySelectorAll('button'))
      .find((element) => /^(check(?:\\s|$)|try again)/.test(label(element)));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function clickLink(session, label) {
  const clicked = await session.evaluate(`(() => {
    const link = [...document.querySelectorAll('a[href]')].find((node) => node.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === ${JSON.stringify(label.toLocaleLowerCase())});
    if (!link) return false;
    link.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not activate the visible “${label}” link.`);
}

function textIncludes(text, phrase) {
  return text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase());
}

async function pageIncludes(session, phrase) {
  return session.evaluate(`document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(phrase.toLocaleLowerCase())})`);
}

async function fillControl(session, selector, value) {
  const filled = await session.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field) return false;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    descriptor?.set?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field.value === ${JSON.stringify(value)};
  })()`);
  assert.equal(filled, true, `Could not fill the visible ${selector} control.`);
}

async function bodyText(session) {
  return session.evaluate('document.body.innerText');
}

async function assertNoHorizontalOverflow(session, name) {
  const dimensions = await session.evaluate('({width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})');
  assert.ok(dimensions?.scroll <= dimensions?.width + 1, `${name} has horizontal overflow at the 390px mobile viewport.`);
}

async function extractInviteUrl(session) {
  return session.waitFor(async () => session.evaluate(`(() => {
    const text = [...document.querySelectorAll('p')].map((node) => node.innerText.trim())
      .find((value) => value.startsWith(${JSON.stringify(APP_ORIGIN + '/relay/scan?')}) && value.includes('#token='));
    return text || '';
  })()`), 'the secure carrier invite link rendered by the sender UI');
}

async function assertBrowserBoundaries() {
  for (const session of sessions) {
    assert.deepEqual([...session.externalOrigins], [], `${session.name} attempted a cross-origin request.`);
    assert.deepEqual(session.failedRequests, [], `${session.name} had a failed browser request.`);
    assert.equal(session.consoleErrors, 0, `${session.name} recorded a browser console error.`);
    assert.equal(session.runtimeExceptions, 0, `${session.name} recorded a runtime exception.`);
  }
}

async function cleanup() {
  for (const session of sessions) {
    session.pageCdp?.close();
    session.browserCdp?.close();
  }
  let processesStopped = true;
  for (const [child, label] of [...sessions.map((session) => [session.browser, `isolated ${session.name} browser`]), [app, 'isolated Next app']]) {
    if (!child) continue;
    try { await stopOwnedProcess(child, label); }
    catch {
      cleanupFailed = true;
      processesStopped = false;
      console.error(`[browser-relay-e2e] CLEANUP FAILED: could not stop this smoke’s ${label}.`);
    }
  }

  if (admin) {
    for (const fixture of disposableDrops) {
      try {
        const { data: deleted, error } = await admin.from('letters').delete()
          .eq('id', fixture.letterId)
          .eq('sender_id', fixture.senderId)
          .select('id');
        const { data: remaining, error: verifyError } = await admin.from('letters').select('id')
          .eq('id', fixture.letterId)
          .eq('sender_id', fixture.senderId)
          .maybeSingle();
        if (error || verifyError || (deleted?.length || 0) > 1 || remaining) {
          cleanupFailed = true;
          console.error('[browser-relay-e2e] CLEANUP FAILED: an exact disposable drop row remains or could not be verified absent.');
        }
      } catch {
        cleanupFailed = true;
        console.error('[browser-relay-e2e] CLEANUP FAILED: could not remove an exact disposable drop row.');
      }
    }
    for (const userId of createdUserIds) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        const { data, error: verifyError } = await admin.auth.admin.getUserById(userId);
        if (data.user || (verifyError && verifyError.status !== 404)) throw new Error('Disposable account remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-relay-e2e] CLEANUP FAILED: a disposable local account remains or could not be verified absent.');
      }
    }
    if (createdUserIds.length > 0) {
      try {
        const { data, error } = await admin.from('profiles').select('id').in('id', createdUserIds);
        if (error || data?.length) throw new Error('A disposable profile remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-relay-e2e] CLEANUP FAILED: a disposable profile remains or could not be verified absent.');
      }
    }
  }

  if (temporaryRoot && processesStopped) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-relay-e2e] CLEANUP FAILED: could not remove temporary app/browser profiles.');
    }
  } else if (temporaryRoot) {
    cleanupFailed = true;
    console.error('[browser-relay-e2e] CLEANUP FAILED: retained temporary profiles while an owned process may still use them.');
  }
}

async function stopOwnedProcess(child, label) {
  if (!child || await waitForOwnedProcessExit(child, 0)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not stop ${label}.`); }
  if (await waitForOwnedProcessExit(child, 10_000)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not force-stop ${label}.`); }
  if (!await waitForOwnedProcessExit(child, 5_000)) throw new Error(`This smoke’s ${label} did not exit.`);
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
  if (process.argv.includes('--guard-self-test')) {
    assert.deepEqual(process.argv.slice(2), ['--guard-self-test']);
    guardSelfTest();
    return;
  }
  assert.deepEqual(process.argv.slice(2), [], 'This smoke accepts only --guard-self-test.');

  await assertPortAvailable(APP_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local with local loopback Supabase URL, anon key, and service-role key first.');
  });
  const localConfig = readLocalSupabaseConfig(envText);
  localValues = localConfig.values;
  supabaseUrl = localConfig.supabaseUrl;
  localSupabaseFetch = createLocalSupabaseFetch(supabaseUrl);
  assertTrustedLocalSupabaseListener(54321);
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Use the installed project dependency tree before this smoke.');
  for (const alias of ['localhost', '127.0.0.1', '[::1]']) allowedOrigins.add(`http://${alias}:54321`);
  allowedOrigins.add(supabaseUrl.origin);
  const health = await localSupabaseFetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, `Local Supabase Auth health returned HTTP ${health.status}.`);
  admin = createClient(supabaseUrl.origin, localValues.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: localSupabaseFetch },
  });
  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-relay-e2e-'));
  await mkdir(join(temporaryRoot, 'home'), { recursive: true });

  try {
    currentStep = 'starting isolated production app';
    await startTemporaryApp();

    currentStep = 'creating disposable sender, carrier, and recipient accounts';
    sender = await createAccount('sender');
    carrier = await createAccount('carrier');
    recipient = await createAccount('recipient');

    currentStep = 'starting isolated mobile browser sessions';
    const senderSession = await createBrowserSession('sender', sender);
    const carrierSession = await createBrowserSession('carrier', carrier);
    const recipientSession = await createBrowserSession('recipient', recipient);

    currentStep = 'sending a text Relay drop through the sender Compose UI';
    const fixture = await createRelayDropThroughCompose(senderSession);

    currentStep = 'creating the secure carrier invite through the sender UI';
    await senderSession.navigate(`${APP_ORIGIN}/relay?letter=${encodeURIComponent(fixture.letterId)}`);
    await senderSession.waitFor(() => pageIncludes(senderSession, 'Invite a carrier'), 'sender Relay page');
    await assertNoHorizontalOverflow(senderSession, 'Sender Relay page');
    await clickButton(senderSession, 'Invite a carrier');
    await senderSession.waitFor(() => senderSession.evaluate("document.body.innerText.includes('Carrier invite ready. It expires in 10 minutes.')"), 'secure invite confirmation');
    const inviteUrl = await extractInviteUrl(senderSession);
    const invite = new URL(inviteUrl);
    assert.equal(invite.origin, APP_ORIGIN);
    assert.equal(invite.pathname, '/relay/scan');
    assert.equal(invite.searchParams.get('letter'), fixture.letterId);
    assert.equal(invite.searchParams.has('token'), false, 'The bearer capability must stay out of the query string.');
    assert.match(invite.hash, /^#token=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'The secure carrier capability must be a UUIDv4 in the URL fragment.');
    console.log('[browser-relay-e2e] PASS sender created a short-lived carrier invite through the rendered UI; token is in the fragment.');

    currentStep = 'accepting the secure invite from the mobile carrier browser';
    await carrierSession.navigate(inviteUrl);
    await carrierSession.waitFor(() => pageIncludes(carrierSession, 'Accept sealed drop'), 'secure carrier acceptance form');
    await assertNoHorizontalOverflow(carrierSession, 'Carrier invite page');
    await fillControl(carrierSession, '#relay-carrier-name', carrier.displayName);
    await fillControl(carrierSession, '#relay-carrier-neighborhood', 'Pilot Neighborhood');
    await fillControl(carrierSession, '#relay-carrier-note', 'Handing this sealed drop forward.');
    await clickButton(carrierSession, 'Accept sealed drop');
    await carrierSession.waitFor(() => pageIncludes(carrierSession, 'A sealed drop is in your care.'), 'accepted carrier confirmation');
    const geolocationCalls = await carrierSession.evaluate('window.__dropGeoCalls');
    assert.equal(geolocationCalls, 0, 'The secure carrier flow must not request device geolocation.');
    assert.ok(!textIncludes(await bodyText(carrierSession), fixture.subject), 'Carrier must not see the private subject.');
    assert.ok(!textIncludes(await bodyText(carrierSession), fixture.content), 'Carrier must not see the private body.');
    await clickLink(carrierSession, 'Open carrier view');
    await carrierSession.waitFor(() => carrierSession.evaluate("location.pathname === '/relay/carry' && document.body.innerText.toLocaleLowerCase().includes('pass it on')"), 'carrier view');
    assert.ok(!textIncludes(await bodyText(carrierSession), fixture.subject), 'Carrier view must not expose the private subject.');
    assert.ok(!textIncludes(await bodyText(carrierSession), fixture.content), 'Carrier view must not expose the private body.');
    console.log('[browser-relay-e2e] PASS carrier accepted manually at neighborhood level, location stayed unused, and private content stayed sealed.');

    currentStep = 'rejecting a fresh replay of the used carrier invite';
    await carrierSession.navigate(inviteUrl);
    await carrierSession.waitFor(() => pageIncludes(carrierSession, 'Accept sealed drop'), 'replay acceptance form');
    await fillControl(carrierSession, '#relay-carrier-name', `${carrier.displayName} Replay`);
    await fillControl(carrierSession, '#relay-carrier-neighborhood', 'Replay Neighborhood');
    await fillControl(carrierSession, '#relay-carrier-note', 'This fresh request must not create another handoff.');
    await clickButton(carrierSession, 'Accept sealed drop');
    await carrierSession.waitFor(() => carrierSession.evaluate("Boolean(document.querySelector('[role=alert]')?.innerText.trim())"), 'one-time invite replay denial');
    // Authenticated clients cannot select handoff rows; the local service client
    // inspects only this disposable fixture to verify the one-time invite count.
    const { data: handoffs, error: handoffError } = await admin.from('relay_handoffs')
      .select('id, carrier_name, neighborhood, note, handoff_lat, handoff_lng, accepted_lat, accepted_lng')
      .eq('letter_id', fixture.letterId);
    assert.ifError(handoffError);
    assert.equal(handoffs?.length, 1, 'A fresh request against the used invite must not create another handoff.');
    assert.equal(handoffs[0].carrier_name, carrier.displayName);
    assert.equal(handoffs[0].neighborhood, 'Pilot Neighborhood');
    assert.equal(handoffs[0].handoff_lat, null);
    assert.equal(handoffs[0].handoff_lng, null);
    assert.equal(handoffs[0].accepted_lat, null);
    assert.equal(handoffs[0].accepted_lng, null);
    console.log('[browser-relay-e2e] PASS replay with fresh carrier details was denied; exactly one handoff exists and coordinate fields are empty.');

    currentStep = 'refreshing the sender Journey route';
    await senderSession.navigate(`${APP_ORIGIN}/journey?letter=${encodeURIComponent(fixture.letterId)}`);
    await senderSession.waitFor(() => pageIncludes(senderSession, 'Refresh route'), 'sender Journey page');
    await clickButton(senderSession, 'Refresh route');
    await senderSession.waitFor(async () => {
      const text = await bodyText(senderSession);
      return textIncludes(text, carrier.displayName) && textIncludes(text, 'Pilot Neighborhood');
    }, 'sender Journey to show the new carrier and neighborhood');
    await assertNoHorizontalOverflow(senderSession, 'Sender Journey page');
    console.log('[browser-relay-e2e] PASS sender Journey refreshed and showed the new carrier stop.');

    currentStep = 'collecting the sealed drop as its recipient';
    await recipientSession.navigate(`${APP_ORIGIN}/mailbox`);
    await recipientSession.waitFor(() => pageIncludes(recipientSession, 'I got this drop'), 'recipient sealed Relay card');
    const beforeCollect = await bodyText(recipientSession);
    assert.ok(textIncludes(beforeCollect, 'A sealed drop is traveling to you'), 'Recipient should see the sealed route card.');
    assert.ok(textIncludes(beforeCollect, carrier.displayName), 'Recipient should see safe carrier route details.');
    assert.ok(!textIncludes(beforeCollect, fixture.subject), 'Recipient must not see the subject before collection.');
    assert.ok(!textIncludes(beforeCollect, fixture.content), 'Recipient must not see the body before collection.');
    await assertNoHorizontalOverflow(recipientSession, 'Recipient mailbox before collection');
    await clickButton(recipientSession, 'I got this drop');
    await recipientSession.waitFor(async () => {
      const text = await bodyText(recipientSession);
      return textIncludes(text, fixture.subject) && textIncludes(text, fixture.content);
    }, 'recipient mailbox to reveal the collected drop');
    await assertNoHorizontalOverflow(recipientSession, 'Recipient mailbox after collection');
    console.log('[browser-relay-e2e] PASS recipient saw route-only details, explicitly collected, and then opened the private drop.');

    currentStep = 'checking the sender collection receipt';
    await senderSession.navigate(`${APP_ORIGIN}/journey?letter=${encodeURIComponent(fixture.letterId)}`);
    await senderSession.waitFor(() => pageIncludes(senderSession, 'Drop collected'), 'sender collection status after recipient action');
    await assertBrowserBoundaries();
    console.log('[browser-relay-e2e] PASS 390×844 browser journey had no horizontal overflow, console errors, runtime exceptions, or cross-origin requests.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The browser Relay journey completed with local cleanup failures.');
}

const onSignal = (signal) => active.abort(new Error(`Received ${signal}; cleaning up this local smoke.`));
process.once('SIGINT', () => onSignal('SIGINT'));
process.once('SIGTERM', () => onSignal('SIGTERM'));

main().catch((error) => {
  console.error(`[browser-relay-e2e] FAIL during ${currentStep}: ${redact(error?.message || 'Unexpected error')}`);
  process.exitCode = 1;
}).finally(() => {
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  if (!cleanupFailed && temporaryRoot) {
    // main() normally removes this in cleanup(); this is a guard for early setup failures.
    void rm(temporaryRoot, { recursive: true, force: true }).catch(() => {
      console.error('[browser-relay-e2e] CLEANUP FAILED: could not remove temporary profiles.');
      process.exitCode = 1;
    });
  }
});
