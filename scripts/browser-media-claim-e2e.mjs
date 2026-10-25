#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const BUCKET = 'drop-media';
const BUILD_TIMEOUT_MS = 180_000;
const APP_TIMEOUT_MS = 60_000;
const BROWSER_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const active = new AbortController();
const allowedOrigins = new Set([APP_ORIGIN]);

let localValues = {};
let supabaseUrl;
let admin;
let app;
let temporaryRoot;
let temporaryProject;
let sender;
let recipient;
let outsider;
let currentStep = 'initializing';
let cleanupFailed = false;
let cleanupCompleted = false;
const createdUserIds = [];
const fixtures = [];
const disposableDrops = [];
const storagePaths = new Set();
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
      const timer = setTimeout(() => reject(new Error('Timed out connecting to the isolated browser.')), 5_000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('Interrupted while connecting to the isolated browser.'));
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
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
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
        reject(new Error(`Timed out waiting for browser DevTools command ${method}.`));
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
    this.failedLocalRequests = [];
    this.consoleErrors = 0;
    this.runtimeExceptions = 0;
    this.appNavigationPaths = [];
  }

  async launch() {
    if (typeof WebSocket !== 'function') throw new Error('This smoke requires Node built-in WebSocket support.');
    const executable = findBrowserExecutable();
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
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
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
    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    this.pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
    this.observeNetwork();
    await Promise.all([
      this.pageCdp.send('Page.enable'),
      this.pageCdp.send('Runtime.enable'),
      this.pageCdp.send('Network.enable'),
      this.pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
      this.pageCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }),
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
      } catch { /* The browser has not published DevTools yet. */ }
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
      if (errorText !== 'net::ERR_ABORTED') this.failedLocalRequests.push({ requestId, errorText });
    });
    cdp.on('Runtime.exceptionThrown', () => { this.runtimeExceptions += 1; });
    cdp.on('Runtime.consoleAPICalled', ({ type }) => { if (type === 'error') this.consoleErrors += 1; });
    cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
      let origin = '';
      try { origin = new URL(request.url).origin; } catch { /* Non-HTTP requests remain blocked. */ }
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
    assert.ok(allowedOrigins.has(target.origin), 'The smoke only navigates to the isolated app or loopback Supabase.');
    if (target.origin === APP_ORIGIN) this.appNavigationPaths.push(target.pathname);
    await this.pageCdp.send('Page.navigate', { url }, STEP_TIMEOUT_MS);
  }

  async waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
      try {
        const value = await predicate();
        if (value) return value;
      } catch { /* React route transitions can briefly make the selector unavailable. */ }
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
    if (!match) continue;
    const [, name, rawValue] = match;
    if (name !== expectedName) continue;
    const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
    return quoted ? (quoted[1] ?? quoted[2]) : rawValue.replace(/\s+#.*$/, '').trim();
  }
  return '';
}

function requireLocalSupabaseUrl(rawValue) {
  let url;
  try { url = new URL(rawValue); } catch { throw new Error('.env.local has an invalid Supabase URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(hostname), 'Supabase must use localhost, 127.0.0.1, or ::1.');
  assert.equal(url.protocol, 'http:', 'Local Supabase must use HTTP.');
  assert.equal(url.port || '80', '54321', 'Local Supabase must use port 54321.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Supabase URL must be a plain loopback origin.');
  return url;
}

function readLocalSupabaseConfig(source) {
  // Do not parse either key until the URL is proven to be a plain loopback origin.
  const supabaseUrlValue = parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_URL');
  const parsedUrl = requireLocalSupabaseUrl(supabaseUrlValue);
  const anonKey = parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = parseEnvValue(source, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.ok(anonKey && serviceRoleKey, '.env.local is missing required local Supabase values.');
  return {
    supabaseUrl: parsedUrl,
    values: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrlValue,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
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
  const environment = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || tmpdir(),
    TMPDIR: temporaryRoot || tmpdir(),
  };
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
  for (const value of [
    'https://127.0.0.1:54321',
    'http://example.test:54321',
    'http://0.0.0.0:54321',
    'http://127.0.0.1:54322',
    'http://user:pass@127.0.0.1:54321',
    'http://127.0.0.1:54321/path',
  ]) assert.throws(() => requireLocalSupabaseUrl(value));
  assert.throws(() => readLocalSupabaseConfig(`NEXT_PUBLIC_SUPABASE_URL=https://example.test\nNEXT_PUBLIC_SUPABASE_ANON_KEY=not-read\nSUPABASE_SERVICE_ROLE_KEY=not-read`));
  assert.equal(APP_PORT, 6004, 'The test server must remain on the mapped browser QA port.');
  const sampleClaimUrl = new URL(claimUrl({ token: 'a'.repeat(64) }));
  assert.equal(sampleClaimUrl.hash, `#token=${'a'.repeat(64)}`, 'The claim capability must use the supported token fragment parameter.');
  assert.equal(sampleClaimUrl.search, '', 'The claim capability must never appear in query parameters.');
  assert.equal(browserEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined, 'Browser processes must not receive the service-role key.');
  assert.equal(baseAppEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined, 'The build receives no service-role key.');
  console.log('[browser-media-claim-e2e] PASS loopback-only URL and server/browser secret-boundary guard checks.');
}

function findBrowserExecutable() {
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
  const dependencyTree = resolve(PROJECT_ROOT, 'node_modules');
  await symlink(dependencyTree, join(temporaryProject, 'node_modules'), 'dir');
  return temporaryProject;
}

async function startTemporaryApp() {
  const projectRoot = await makeIsolatedProject();
  const nextCli = resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next');
  const buildEnvironment = baseAppEnvironment();
  console.log('[browser-media-claim-e2e] Building the isolated production app.');
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
    const safeOutput = buildOutput
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_URL, '[loopback Supabase URL]')
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, '[redacted anon key]')
      .replaceAll(localValues.SUPABASE_SERVICE_ROLE_KEY, '[redacted service-role key]')
      .trim();
    if (buildProcess.pid) await stopOwnedProcess(buildProcess, 'isolated production build');
    app = null;
    throw new Error(`The isolated local production build ${reason}.${safeOutput ? ` Build output: ${safeOutput}` : ''}`);
  }
  await stopOwnedProcess(buildProcess, 'isolated production build');

  // The service-role key is added only to the isolated server runtime. It is not
  // present during build, in the browser environment, or in NEXT_PUBLIC values.
  app = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(APP_PORT)], {
    cwd: projectRoot,
    env: { ...buildEnvironment, SUPABASE_SERVICE_ROLE_KEY: localValues.SUPABASE_SERVICE_ROLE_KEY },
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
    } catch { /* The isolated Next server is still starting. */ }
    await sleep(500, active.signal);
  }
  throw new Error('The isolated local app did not become ready on port 6004.');
}

function client() {
  return createClient(supabaseUrl.origin, localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createAccount(label, { createProfile = false } = {}) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `drop-media-claim-${label}-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`Could not create disposable local ${label} account.`);
  createdUserIds.push(data.user.id);
  const account = client();
  const { data: session, error: signInError } = await account.auth.signInWithPassword({ email, password });
  if (signInError || session.user?.id !== data.user.id || !session.session?.access_token) {
    throw new Error(`Could not authenticate the disposable local ${label} account.`);
  }
  const result = {
    id: data.user.id,
    email,
    password,
    client: account,
    accessToken: session.session.access_token,
    username: `mc_${label.slice(0, 1)}_${suffix.slice(0, 8)}`,
    displayName: label === 'sender' ? 'Pilot Sender' : label === 'outsider' ? 'Pilot Outsider' : 'Pilot Recipient',
  };
  if (createProfile) await createProfileForAccount(result);
  return result;
}

async function createProfileForAccount(account) {
  const { error } = await account.client.from('profiles').insert({
    id: account.id,
    username: account.username,
    display_name: account.displayName,
    bio: '',
  });
  if (error) throw new Error(`Could not create the disposable local ${account.displayName} profile.`);
  const { data: profile, error: verifyError } = await account.client.from('profiles')
    .select('id, username, display_name')
    .eq('id', account.id)
    .maybeSingle();
  assert.ifError(verifyError);
  assert.deepEqual(profile, { id: account.id, username: account.username, display_name: account.displayName });
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
  assert.ok(LOOPBACK_HOSTS.has(actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'The sign-in link must use loopback.');
  await session.navigate(data.properties.action_link);
  await session.waitFor(() => session.evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && ${browserTextIncludes(`Connected as ${account.email}.`)}`), 'local magic-link sign-in');
}

async function issueMediaInvite(account, payloadKind, bytes) {
  const letterId = `pilot-media-${payloadKind}-${randomUUID()}`;
  disposableDrops.push({ letterId, senderId: account.id });
  const uploadId = randomUUID();
  const stagedPath = `${account.id}/pending/${letterId}/${uploadId}`;
  const mediaPath = `${account.id}/${letterId}/${uploadId}`;
  const mediaMimeType = payloadKind === 'gif' ? 'image/gif' : 'image/png';
  const subject = `Pilot ${payloadKind === 'gif' ? 'GIF' : 'photo'} ${randomUUID().slice(0, 8)}`;
  const content = `A private ${payloadKind === 'gif' ? 'GIF' : 'photo'} caption ${randomUUID()}.`;
  const token = randomBytes(32).toString('hex');
  storagePaths.add(stagedPath);
  storagePaths.add(mediaPath);

  const { error: uploadError } = await account.client.storage.from(BUCKET).upload(
    stagedPath,
    new Blob([bytes], { type: mediaMimeType }),
    { contentType: mediaMimeType, upsert: false },
  );
  if (uploadError) throw new Error(`Could not upload the disposable local ${payloadKind} fixture.`);

  const finalizeResponse = await fetch(`${APP_ORIGIN}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind }),
    signal: AbortSignal.timeout(20_000),
  });
  if (finalizeResponse.status !== 200) throw new Error(`The isolated media-finalize route rejected the local ${payloadKind} fixture (HTTP ${finalizeResponse.status}).`);
  const media = await finalizeResponse.json();
  assert.equal(media.mediaPath, mediaPath, 'Finalization must bind media to this disposable drop.');
  assert.equal(media.mediaMimeType, mediaMimeType);
  assert.ok(Number.isInteger(media.mediaSizeBytes) && media.mediaSizeBytes > 0 && media.mediaSizeBytes <= 8 * 1024 * 1024);

  const { data: issuedId, error: issueError } = await account.client.rpc('issue_drop_media_claim_invite', {
    p_letter_id: letterId,
    p_subject: subject,
    p_content: content,
    p_payload_kind: payloadKind,
    p_media_path: media.mediaPath,
    p_media_mime_type: media.mediaMimeType,
    p_media_size_bytes: media.mediaSizeBytes,
    p_token: token,
  });
  if (issueError || issuedId !== letterId) {
    throw new Error(`The local ${payloadKind} invite could not be issued. Confirm local media cleanup scheduling and applied migrations.`);
  }
  const fixture = {
    letterId,
    token,
    payloadKind,
    subject,
    content,
    mediaPath: media.mediaPath,
    mediaSizeBytes: media.mediaSizeBytes,
    mediaMimeType: media.mediaMimeType,
    senderId: account.id,
  };
  fixtures.push(fixture);
  return fixture;
}

async function assertUnavailable(account, fixture, phase) {
  const { data: row, error: rowError } = await account.client.from('letters')
    .select('id, content, media_path')
    .eq('id', fixture.letterId)
    .maybeSingle();
  assert.ifError(rowError);
  assert.equal(row, null, `${phase}: ${fixture.payloadKind} drop content must remain unavailable.`);
  const { data: object, error: objectError } = await account.client.storage.from(BUCKET).download(fixture.mediaPath);
  assert.ok(objectError && !object, `${phase}: ${fixture.payloadKind} media must not download.`);
  const { data: signed, error: signedError } = await account.client.storage.from(BUCKET).createSignedUrl(fixture.mediaPath, 60);
  assert.ok(signedError && !signed, `${phase}: ${fixture.payloadKind} media must not produce a signed URL.`);
}

async function assertPendingForSender(fixture) {
  const { data, error } = await sender.client.from('letters')
    .select('id, sender_id, recipient_id, status, payload_kind, content, media_path')
    .eq('id', fixture.letterId)
    .eq('sender_id', sender.id)
    .maybeSingle();
  assert.ifError(error);
  assert.deepEqual(data, {
    id: fixture.letterId,
    sender_id: sender.id,
    recipient_id: null,
    status: 'claim_pending',
    payload_kind: fixture.payloadKind,
    content: fixture.content,
    media_path: fixture.mediaPath,
  });
}

async function assertClaimedForRecipient(fixture) {
  const { data, error } = await recipient.client.from('letters')
    .select('id, sender_id, recipient_id, status, payload_kind, content, media_path')
    .eq('id', fixture.letterId)
    .maybeSingle();
  assert.ifError(error);
  assert.deepEqual(data, {
    id: fixture.letterId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    status: 'delivered',
    payload_kind: fixture.payloadKind,
    content: fixture.content,
    media_path: fixture.mediaPath,
  });
  const { data: object, error: downloadError } = await recipient.client.storage.from(BUCKET).download(fixture.mediaPath);
  assert.ifError(downloadError);
  assert.equal(object?.size, fixture.mediaSizeBytes);
}

async function clickButton(session, label) {
  return session.evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const expected = ${JSON.stringify(label.toLocaleLowerCase())};
    const button = Array.from(document.querySelectorAll('button')).find((item) => normalize(item.innerText) === expected);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function clickLink(session, label) {
  return session.evaluate(`(() => {
    const expected = ${JSON.stringify(label.toLocaleLowerCase())};
    const link = Array.from(document.querySelectorAll('a')).find((item) => item.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === expected);
    if (!link) return false;
    link.click();
    return true;
  })()`);
}

function browserTextIncludes(expected, expression = 'document.body.innerText') {
  return `String(${expression} || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase().includes(${JSON.stringify(expected.toLocaleLowerCase())})`;
}

function browserHasButton(label) {
  return `Array.from(document.querySelectorAll('button')).some((item) => item.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === ${JSON.stringify(label.toLocaleLowerCase())})`;
}

async function fillByKeyboard(session, selector, value) {
  const focused = await session.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field || field.disabled || field.readOnly || typeof field.select !== 'function') return false;
    field.focus();
    field.select();
    return document.activeElement === field
      && field.selectionStart === 0
      && field.selectionEnd === field.value.length;
  })()`);
  assert.equal(focused, true, `Could not select the rendered field ${selector}.`);
  await session.pageCdp.send('Input.insertText', { text: value });
  await session.waitFor(() => session.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`), `value in ${selector}`);
}

function claimUrl(fixture) {
  const url = new URL('/claim', APP_ORIGIN);
  url.hash = new URLSearchParams({ token: fixture.token }).toString();
  return url.toString();
}

async function assertClaimPageSealed(session, fixture, phase) {
  const state = await session.evaluate(`(() => ({
    path: location.pathname,
    body: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase(),
    imageCount: document.querySelectorAll('img').length,
    openedBody: Boolean(document.querySelector('#letter-body')),
    claimButton: ${browserHasButton('Claim this drop')},
  }))()`);
  assert.equal(state.path, '/claim', `${phase}: the recipient should remain on the private claim page.`);
  assert.equal(state.body.includes(fixture.subject.toLocaleLowerCase()), false, `${phase}: the subject must remain sealed.`);
  assert.equal(state.body.includes(fixture.content.toLocaleLowerCase()), false, `${phase}: the caption must remain sealed.`);
  assert.equal(state.imageCount, 0, `${phase}: the attachment must not render before the claim action.`);
  assert.equal(state.openedBody, false, `${phase}: the opened drop must not exist before claim.`);
  assert.equal(state.claimButton, !phase.includes('Before profile setup'), `${phase}: only a profiled recipient may see the explicit claim action.`);
  return state;
}

async function setUpRecipientProfile(session) {
  assert.equal(await clickLink(session, 'Choose a Drop handle'), true, 'The unprofiled recipient needs the profile-setup route.');
  await session.waitFor(() => session.evaluate(`location.pathname === '/profile'
    && new URLSearchParams(location.search).get('invite') === '1'
    && ${browserTextIncludes('Set your handle, then claim.')}`), 'first-use claim profile setup');
  await fillByKeyboard(session, '#display-name', recipient.displayName);
  await fillByKeyboard(session, '#username', recipient.username);
  assert.equal(await clickButton(session, 'Save & sync handle'), true, 'Could not save the first-use recipient profile.');
  await session.waitFor(() => session.evaluate(`location.pathname === '/claim'
    && ${browserHasButton('Claim this drop')}`), 'return from profile setup to the explicit claim action');
  const { data: profile, error } = await recipient.client.from('profiles')
    .select('id, username, display_name')
    .eq('id', recipient.id)
    .maybeSingle();
  assert.ifError(error);
  assert.deepEqual(profile, { id: recipient.id, username: recipient.username, display_name: recipient.displayName });
  for (const fixture of fixtures) {
    await assertUnavailable(recipient, fixture, 'After profile setup but before explicit claim');
    await assertPendingForSender(fixture);
  }
}

async function claimAndRenderMedia(session, fixture, { navigateToInvite = true } = {}) {
  if (navigateToInvite) await session.navigate(claimUrl(fixture));
  await session.waitFor(() => session.evaluate(`location.pathname === '/claim'
    && ${browserTextIncludes('Private claim invite')}
    && ${browserHasButton('Claim this drop')}`), `${fixture.payloadKind} explicit claim page`);
  await assertClaimPageSealed(session, fixture, 'Before explicit claim');
  await assertUnavailable(recipient, fixture, 'Before explicit claim');
  assert.equal(await clickButton(session, 'Claim this drop'), true, `Could not explicitly claim the ${fixture.payloadKind} in the browser.`);
  await session.waitFor(() => session.evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.letterId}`)}
    && ${browserTextIncludes(fixture.subject)}`), `${fixture.payloadKind} claim result route`);
  assert.equal(await clickButton(session, 'Reveal fragments'), true, `Could not reveal the ${fixture.payloadKind} drop.`);
  await session.waitFor(() => session.evaluate(`${browserHasButton('Open received drop')}`), `${fixture.payloadKind} open action`);
  assert.equal(await clickButton(session, 'Open received drop'), true, `Could not open the claimed ${fixture.payloadKind} drop.`);
  await session.waitFor(() => session.evaluate(`${browserTextIncludes(fixture.content, "document.querySelector('#letter-body')?.innerText")}`), `${fixture.payloadKind} caption`);
  const rendered = await session.waitFor(async () => {
    const result = await session.evaluate(`(() => {
      const image = document.querySelector('#letter-body img');
      return image ? {
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        sourceOrigin: new URL(image.currentSrc || image.src, location.href).origin,
        badge: ${browserTextIncludes(fixture.payloadKind === 'gif' ? 'GIF' : 'Photo', "document.querySelector('#letter-body')?.innerText")},
      } : null;
    })()`);
    return result?.complete && result.naturalWidth > 0 ? result : null;
  }, `${fixture.payloadKind} attachment pixels`, 20_000);
  assert.ok(allowedOrigins.has(rendered.sourceOrigin), `${fixture.payloadKind} media should render from loopback Supabase storage.`);
  assert.equal(rendered.badge, true);
  await assertClaimedForRecipient(fixture);

  const { data: senderClaimIds, error: senderClaimIdsError } = await sender.client.rpc('get_sender_claimed_drop_ids');
  assert.ifError(senderClaimIdsError);
  assert.ok(senderClaimIds?.some((row) => row.letter_id === fixture.letterId), `The sender claim-status RPC should include the ${fixture.payloadKind}.`);
  await assertUnavailable(outsider, fixture, 'After the recipient explicitly claims');
  const { data: replay, error: replayError } = await outsider.client.rpc('claim_drop_invite', { p_token: fixture.token });
  assert.equal(replayError?.code, '42501', `An outsider must not replay the claimed ${fixture.payloadKind} invite.`);
  assert.equal(replay, null);
}

async function denyOutsiderInBrowser(session, fixture) {
  await session.navigate(claimUrl(fixture));
  await session.waitFor(() => session.evaluate(`location.pathname === '/claim'
    && ${browserTextIncludes('Private claim invite')}
    && ${browserHasButton('Claim this drop')}`), `outsider ${fixture.payloadKind} invite replay page`);
  assert.equal(await clickButton(session, 'Claim this drop'), true, 'The signed-in outsider should attempt the consumed bearer link.');
  await session.waitFor(() => session.evaluate(`location.pathname === '/claim' && Boolean(document.querySelector('[role="alert"]'))`), `outsider ${fixture.payloadKind} denial`);
  const state = await session.evaluate(`({ path: location.pathname, hasCaption: ${browserTextIncludes(fixture.content)}, images: document.querySelectorAll('img').length, alert: document.querySelector('[role="alert"]')?.innerText || '' })`);
  assert.equal(state.path, '/claim');
  assert.equal(state.hasCaption, false);
  assert.equal(state.images, 0);
  assert.ok(state.alert.length > 0);
}

async function waitForRecipientProfilePrompt(session) {
  try {
    await session.waitFor(() => session.evaluate(`location.pathname === '/claim'
      && ${browserTextIncludes('Choose a Drop handle')}`), 'recipient first-use profile prompt');
  } catch (error) {
    let state = 'unavailable';
    try {
      state = await session.evaluate(`(() => {
        const text = String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
        const has = (expected) => text.includes(expected.toLocaleLowerCase());
        const hasStorage = (storage) => { try { storage.setItem('drop:e2e:probe', '1'); storage.removeItem('drop:e2e:probe'); return true; } catch { return false; } };
        return {
          path: location.pathname,
          privateInvite: has('Private claim invite'),
          profilePrompt: has('Choose a Drop handle'),
          storageWarning: has('blocking the storage'),
          missingInvite: has('does not have the invite code'),
          inviteCheckPending: has('Checking this invite'),
          accountCheckPending: has('Checking your Drop account'),
          signedInMarker: has('Connected as'),
          sessionStorageAvailable: hasStorage(window.sessionStorage),
          localStorageAvailable: hasStorage(window.localStorage),
          storedClaimToken: (() => { try { return Boolean(window.sessionStorage.getItem('drop:claim-token:v1')); } catch { return false; } })(),
          claimButton: ${browserHasButton('Claim this drop')},
          profileLink: Array.from(document.querySelectorAll('a')).some((item) => item.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'choose a drop handle'),
        };
      })()`);
    } catch { /* Keep failure output free of raw page content and token data. */ }
    throw new Error(`${error.message} Safe page state: ${JSON.stringify(state)}; local request failures: ${session.failedLocalRequests.length}; console errors: ${session.consoleErrors}; runtime exceptions: ${session.runtimeExceptions}.`);
  }
}

async function assertSenderClaimedAfterReload(session, fixture) {
  await session.navigate(`${APP_ORIGIN}/letter/${encodeURIComponent(fixture.letterId)}?view=sender`);
  await session.waitFor(() => session.evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.letterId}`)}
    && ${browserTextIncludes(`Claimed by ${recipient.displayName}`)}`), `sender restored ${fixture.payloadKind} claim status after reload`);
  await session.pageCdp.send('Page.reload');
  await session.waitFor(() => session.evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.letterId}`)}
    && ${browserTextIncludes(`Claimed by ${recipient.displayName}`)}`), `sender persisted ${fixture.payloadKind} claim status after browser reload`);
}

async function createBrowserSession(name, account) {
  const session = new BrowserSession(name);
  sessions.push(session);
  await session.launch();
  await signInWithMagicLink(session, account);
  return session;
}

async function checkBrowserBoundaries() {
  for (const session of sessions) {
    assert.deepEqual([...session.externalOrigins], [], `${session.name} attempted a cross-origin network request.`);
    assert.deepEqual(session.failedLocalRequests, [], `${session.name} had a failed local request.`);
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
      console.error(`[browser-media-claim-e2e] CLEANUP FAILED: could not stop this smoke's ${label}.`);
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
          console.error('[browser-media-claim-e2e] CLEANUP FAILED: an exact disposable drop row remains or could not be verified absent.');
        }
      } catch {
        cleanupFailed = true;
        console.error('[browser-media-claim-e2e] CLEANUP FAILED: could not remove an exact disposable drop row.');
      }
    }
    if (storagePaths.size > 0) {
      try {
        const paths = [...storagePaths];
        const { error } = await admin.storage.from(BUCKET).remove(paths);
        if (error && !/not found|does not exist/i.test(error.message)) throw error;
        for (const path of paths) {
          const { data, error: verifyError } = await admin.storage.from(BUCKET).download(path);
          if (data || !verifyError) throw new Error('A disposable object remains.');
        }
      } catch {
        cleanupFailed = true;
        console.error('[browser-media-claim-e2e] CLEANUP FAILED: disposable media objects remain or could not be verified absent.');
      }
    }
    for (const userId of createdUserIds) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        const { data, error: verifyError } = await admin.auth.admin.getUserById(userId);
        if (data.user || (verifyError && verifyError.status !== 404)) throw new Error('A disposable account remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-media-claim-e2e] CLEANUP FAILED: a disposable local account remains or could not be verified absent.');
      }
    }
    if (createdUserIds.length > 0) {
      try {
        const { data, error } = await admin.from('profiles').select('id').in('id', createdUserIds);
        if (error || data?.length) throw new Error('A disposable profile remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-media-claim-e2e] CLEANUP FAILED: a disposable profile remains or could not be verified absent.');
      }
    }
  }

  if (temporaryRoot && processesStopped) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-media-claim-e2e] CLEANUP FAILED: could not remove temporary app/browser profiles.');
    }
  } else if (temporaryRoot) {
    cleanupFailed = true;
    console.error('[browser-media-claim-e2e] CLEANUP FAILED: temporary profiles were retained because an owned process may still be using them.');
  }
  cleanupCompleted = !cleanupFailed;
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
  if (!await waitForOwnedProcessExit(child, 5_000)) throw new Error(`This smoke's ${label} did not exit.`);
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

  // Do not read credentials or change state until the one allowed app port is free.
  await assertPortAvailable(APP_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local with local loopback Supabase URL, anon key, and service-role key first.');
  });
  const localConfig = readLocalSupabaseConfig(envText);
  localValues = localConfig.values;
  supabaseUrl = localConfig.supabaseUrl;
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Use the installed project dependency tree before running this smoke.');
  for (const alias of ['localhost', '127.0.0.1', '[::1]']) allowedOrigins.add(`http://${alias}:54321`);
  allowedOrigins.add(supabaseUrl.origin);

  const health = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, `Local Supabase Auth health returned HTTP ${health.status}.`);
  admin = createClient(supabaseUrl.origin, localValues.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-media-claim-e2e-'));
  await mkdir(join(temporaryRoot, 'home'), { recursive: true });
  try {
    currentStep = 'starting the isolated production app';
    await startTemporaryApp();

    currentStep = 'creating three disposable local accounts';
    sender = await createAccount('sender', { createProfile: true });
    recipient = await createAccount('recipient');
    const { data: initialRecipientProfile, error: initialRecipientProfileError } = await recipient.client.from('profiles')
      .select('id')
      .eq('id', recipient.id)
      .maybeSingle();
    assert.ifError(initialRecipientProfileError);
    assert.equal(initialRecipientProfile, null, 'The new recipient should complete first-use profile setup in the browser.');
    outsider = await createAccount('outsider', { createProfile: true });

    currentStep = 'issuing local photo and GIF claim fixtures';
    const photo = await issueMediaInvite(sender, 'image', await readFile(resolve(PROJECT_ROOT, 'public/demo-cat.png')));
    const gif = await issueMediaInvite(sender, 'gif', await readFile(resolve(PROJECT_ROOT, 'public/demo-cat.gif')));
    for (const fixture of fixtures) {
      await assertPendingForSender(fixture);
      await assertUnavailable(recipient, fixture, 'Before profile setup');
      await assertUnavailable(outsider, fixture, 'Before claim');
    }
    console.log('[browser-media-claim-e2e] PASS local fixtures are sender-owned and hidden from recipient and outsider accounts.');

    currentStep = 'starting isolated sender and recipient browsers';
    const senderSession = await createBrowserSession('sender', sender);
    const recipientSession = await createBrowserSession('recipient', recipient);
    const outsiderSession = await createBrowserSession('outsider', outsider);

    currentStep = 'checking the sender waiting state';
    await senderSession.navigate(`${APP_ORIGIN}/letter/${encodeURIComponent(photo.letterId)}?view=sender`);
    await senderSession.waitFor(() => senderSession.evaluate(`location.pathname === ${JSON.stringify(`/letter/${photo.letterId}`)}
      && ${browserTextIncludes('Waiting for them to claim.')}`), 'sender waiting state for the photo');

    currentStep = 'claiming from an unprofiled recipient browser';
    await recipientSession.navigate(claimUrl(photo));
    await waitForRecipientProfilePrompt(recipientSession);
    const originalPhotoHandoffId = await recipientSession.evaluate(`new URLSearchParams(location.search).get('handoff')`);
    assert.match(originalPhotoHandoffId || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'The original invite should have a valid opaque profile-return handoff.');
    const photoClaimNavigations = recipientSession.appNavigationPaths.filter((path) => path === '/claim').length;
    await assertClaimPageSealed(recipientSession, photo, 'Before profile setup');
    await setUpRecipientProfile(recipientSession);
    const resumedPhotoHandoffId = await recipientSession.evaluate(`new URLSearchParams(location.search).get('handoff')`);
    assert.equal(resumedPhotoHandoffId, originalPhotoHandoffId, 'First-use profile setup must return to the original photo invite handoff.');
    assert.equal(recipientSession.appNavigationPaths.filter((path) => path === '/claim').length, photoClaimNavigations, 'Profile setup must not open a newly constructed photo token URL.');
    await claimAndRenderMedia(recipientSession, photo, { navigateToInvite: false });
    assert.equal(recipientSession.appNavigationPaths.filter((path) => path === '/claim').length, photoClaimNavigations, 'The photo must be claimed from the returned original invite page.');
    console.log('[browser-media-claim-e2e] PASS recipient setup returned to the original photo invite and explicitly claimed it there; caption and image decoded.');

    currentStep = 'checking sender photo status after reload';
    await assertSenderClaimedAfterReload(senderSession, photo);

    currentStep = 'claiming GIF with the profiled recipient';
    await claimAndRenderMedia(recipientSession, gif);
    console.log('[browser-media-claim-e2e] PASS the same recipient explicitly claimed the GIF and opened its caption plus decoded GIF image (frame progression is not measured).');

    currentStep = 'checking the outsider denial in the browser';
    await denyOutsiderInBrowser(outsiderSession, photo);
    await denyOutsiderInBrowser(outsiderSession, gif);

    currentStep = 'checking sender GIF status after reload';
    await assertSenderClaimedAfterReload(senderSession, gif);
    await checkBrowserBoundaries();
    console.log('[browser-media-claim-e2e] PASS outsider replay denied; no browser attempted cross-origin requests or recorded console/runtime errors.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The smoke completed with local cleanup failures; see the cleanup messages above.');
}

const onSignal = (signal) => active.abort(new Error(`Received ${signal}; cleaning up this local smoke.`));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  console.log('[browser-media-claim-e2e] PASS exact disposable rows, accounts, media, app and browser-profile cleanup completed; 4004 and hosted Supabase were untouched.');
}).catch((error) => {
  active.abort(error);
  const cleanup = cleanupCompleted ? ' Exact disposable cleanup was verified.' : ' Exact disposable cleanup is not confirmed.';
  console.error(`[browser-media-claim-e2e] FAIL during ${currentStep}: ${error?.message || 'unexpected failure'}${cleanup}`);
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
