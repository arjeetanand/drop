#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const HOST_RESOLVER_RULES = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE [::1]';
const STEP_TIMEOUT_MS = 30_000;
const active = new AbortController();

let temporaryRoot;
let temporaryProject;
let app;
let browser;
let browserCdp;
let pageCdp;
let admin;
let anonymous;
let localSupabaseUrl;
let localAnonKey;
let disposableUser;
let disposableEmail = '';
let dropSubject = '';
let dropContent = '';
let dropId = '';
let appError = '';
let lastAppStatus = null;
let lastAppFetchError = '';
let appSpawnError;
let browserSpawnError;
let cleanupFailed = false;
let dropCleanupVerified = false;
let dropCleanupDeleted = 0;
let profileCleanupVerified = false;
let userCleanupVerified = false;
let temporaryCleanupVerified = false;
let ownedProcessGroupsExited = true;
let temporaryCleanupErrorCode = '';
let externalOrigins = new Set();
let localResponseStatuses = [];
let localRequestPaths = [];
let localRequestIds = new Map();
let fetchPausedPaths = [];
let fetchActionResults = [];
let localNetworkFailures = [];
let redirectResponses = [];
let frameNavigationRoutes = [];
let frameLoadEvents = [];
let browserTargetRoutes = [];
let navigationFailureKind = '';
let pageTargetCrashed = false;
let firewallFailure = false;
let consoleErrorCount = 0;
let runtimeExceptionCount = 0;
let currentStep = 'initializing';
let navigationCommandErrors = 0;
const createdProcesses = new Set();
const allowedOrigins = new Set([APP_ORIGIN]);

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
        if (message.error) {
          const invalidInterception = /Invalid InterceptionId/i.test(String(message.error.message || ''));
          pending.reject(new Error(`${pending.method} failed in isolated browser${invalidInterception ? ' (invalid interception id).' : ' (CDP error).'}`));
        }
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Browser DevTools closed during ${pending.method}.`));
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
        reject(signal.reason || new Error('Interrupted while connecting to browser DevTools.'));
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
      return Promise.reject(new Error(`Browser DevTools is closed before ${method}.`));
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
        reject(new Error(`Timed out waiting for browser DevTools ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer, onAbort, method });
      this.signal.addEventListener('abort', onAbort, { once: true });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.signal.removeEventListener('abort', onAbort);
        reject(new Error(`Could not send browser DevTools ${method}.`));
      }
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
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

function requireLoopbackSupabaseUrl(rawValue) {
  let url;
  try { url = new URL(rawValue); } catch { throw new Error('.env.local has an invalid NEXT_PUBLIC_SUPABASE_URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(hostname), 'This smoke permits Supabase calls only to a loopback host.');
  assert.equal(url.protocol, 'http:', 'Local Supabase must use HTTP.');
  assert.equal(url.port || '80', '54321', 'Local Supabase must use API port 54321.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'The Supabase URL must be a plain local origin.');
  return url;
}

function loadLocalConfig(source) {
  // Validate the public URL before even reading the privileged service-role value.
  const parsedUrl = requireLoopbackSupabaseUrl(parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_URL'));
  const anonKey = parseEnvValue(source, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = parseEnvValue(source, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.ok(anonKey && serviceRoleKey, '.env.local is missing local Supabase keys.');
  return { url: parsedUrl, anonKey, serviceRoleKey };
}

function localSupabaseFetch(input, init = {}) {
  const rawUrl = input && typeof input === 'object' && 'url' in input ? input.url : String(input);
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error('A Supabase smoke request used an invalid URL.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname) || parsed.origin !== localSupabaseUrl.origin) {
    throw new Error('A Supabase smoke request left its validated loopback origin.');
  }
  return fetch(input, { ...init, redirect: 'error' });
}

function guardSelfTest() {
  assert.equal(requireLoopbackSupabaseUrl('http://127.0.0.1:54321').origin, 'http://127.0.0.1:54321');
  assert.equal(requireLoopbackSupabaseUrl('http://localhost:54321').hostname, 'localhost');
  assert.equal(requireLoopbackSupabaseUrl('http://[::1]:54321').hostname, '[::1]');
  for (const invalid of [
    'https://127.0.0.1:54321',
    'http://example.test:54321',
    'http://0.0.0.0:54321',
    'http://127.0.0.1:54322',
    'http://user:pass@127.0.0.1:54321',
    'http://127.0.0.1:54321/path',
  ]) assert.throws(() => requireLoopbackSupabaseUrl(invalid));
  assert.throws(() => loadLocalConfig('NEXT_PUBLIC_SUPABASE_URL=https://example.test\nNEXT_PUBLIC_SUPABASE_ANON_KEY=not-read\nSUPABASE_SERVICE_ROLE_KEY=not-read'));
  assert.equal(APP_PORT, 6004);
  assert.equal(HOST_RESOLVER_RULES.includes('~NOTFOUND'), true);
  assert.equal(HOST_RESOLVER_RULES.includes('EXCLUDE [::1]'), true);
  console.log('[browser-qr-smoke] PASS loopback Supabase boundary checks.');
}

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolveListen));
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new Error(`Port ${port} is already owned; the smoke left that process untouched.`);
    throw error;
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

function sleep(milliseconds, signal = active.signal) {
  return new Promise((resolveSleep, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveSleep();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Interrupted.'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
    try {
      const result = await predicate();
      if (result) return result;
    } catch { /* Retry while the local page or route is transitioning. */ }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function childEnvironment({ includeAnonKey = false } = {}) {
  const environment = {
    PATH: process.env.PATH || '',
    HOME: temporaryRoot || tmpdir(),
    TMPDIR: temporaryRoot || tmpdir(),
    NEXT_TELEMETRY_DISABLED: '1',
  };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) if (process.env[name]) environment[name] = process.env[name];
  if (includeAnonKey) {
    environment.NEXT_PUBLIC_SUPABASE_URL = localSupabaseUrl.origin;
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY = localAnonKey;
    if (temporaryRoot) environment.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = join(temporaryRoot, 'mock-google-fonts.cjs');
    environment.NODE_ENV = 'development';
  }
  return environment;
}

async function makeIsolatedProject() {
  temporaryProject = join(temporaryRoot, 'app');
  await mkdir(temporaryProject, { recursive: true });
  let trackedFiles;
  try {
    trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    throw new Error('The browser smoke must run from the Drop Git checkout.');
  }

  const excludedDirectories = new Set(['.git', '.next', '.vercel', '.aws', '.codex', '.agents', '.supabase', '.ssh', '.config', '.kube', '.gcloud', '.credentials', '.secrets', 'credentials', 'secrets', 'node_modules']);
  const excludedFiles = new Set(['.npmrc', '.netrc', '.pypirc']);
  for (const entry of trackedFiles) {
    const parts = entry.split('/');
    const name = parts.at(-1);
    if (parts.some((part) => excludedDirectories.has(part))
      || excludedFiles.has(name)
      || (name.startsWith('.env') && name !== '.env.example')
      || /\.(?:pem|key|p12|pfx)$/i.test(name)) continue;

    const source = resolve(PROJECT_ROOT, entry);
    const sourceRelative = relative(PROJECT_ROOT, source);
    if (sourceRelative === '..' || sourceRelative.startsWith('..' + sep)) {
      throw new Error('A tracked path escaped the Drop checkout.');
    }
    const sourceStat = await lstat(source).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!sourceStat?.isFile()) continue;

    const destination = resolve(temporaryProject, entry);
    const destinationRelative = relative(temporaryProject, destination);
    if (destinationRelative === '..' || destinationRelative.startsWith('..' + sep)) {
      throw new Error('A tracked path escaped the isolated app copy.');
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  await symlink(resolve(PROJECT_ROOT, 'node_modules'), join(temporaryProject, 'node_modules'), 'dir');
  return temporaryProject;
}

function safeAppErrorDiagnostics() {
  const tags = {
    fontMockMissing: /Missing mocked response for URL/i.test(appError),
    fontFetchFailure: /Failed to (?:fetch|download).*font/i.test(appError),
    moduleResolution: /Module not found|Cannot find module/i.test(appError),
    syntaxError: /SyntaxError/i.test(appError),
    typeError: /TypeError/i.test(appError),
    invalidPathArgument: /path.*argument must be of type string/i.test(appError),
    compileFailure: /Failed to compile/i.test(appError),
  };
  const lines = appError.split(/\r?\n/).filter((line) => /error|failed|cannot|unable|invalid|not found|compile|font/i.test(line)).slice(-5);
  const safeLines = lines.map((line) => line
    .replace(/https?:\/\/[^\s'\"<>]+/gi, '[url]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\b/g, '[redacted-token]')
    .replace(/(token|secret|service.role|api.key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\/(?:Users|private|var|tmp)\/[^\s:'\"]+/g, '[path]')
    .slice(0, 180));
  return {
    tags: Object.entries(tags).filter(([, present]) => present).map(([tag]) => tag),
    safeLines,
    stderrBytes: Buffer.byteLength(appError),
    processExitCode: app?.exitCode ?? null,
    spawnErrorCode: appSpawnError?.code ?? null,
    fontMockFilePresent: Boolean(temporaryRoot && existsSync(join(temporaryRoot, 'mock-google-fonts.cjs'))),
    lastHttpStatus: lastAppStatus,
    lastFetchError: lastAppFetchError,
  };
}

async function startTemporaryApp() {
  await writeFile(join(temporaryRoot, 'mock-google-fonts.cjs'), "module.exports = {};\n", { flag: 'wx' });
  const root = await makeIsolatedProject();
  const nextCli = resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next');
  app = spawn(process.execPath, [nextCli, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(APP_PORT)], {
    cwd: root,
    env: childEnvironment({ includeAnonKey: true }),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  createdProcesses.add(app);
  app.on('error', (error) => { appSpawnError = error; });
  app.stderr.on('data', (chunk) => { appError = `${appError}${chunk.toString('utf8')}`.slice(-6_000); });
  await waitFor(async () => {
    if (appSpawnError || app.exitCode !== null) throw new Error('The isolated local Next.js app failed to start.');
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      lastAppStatus = response.status;
      return response.status < 500;
    } catch (error) { lastAppFetchError = error?.name || 'fetch-error'; return false; }
  }, 'the isolated Drop app on port 6004', 30_000).catch((error) => {
    if (appError) throw new Error('The isolated Next.js app did not start; safe diagnostics=' + JSON.stringify(safeAppErrorDiagnostics()) + '.');
    throw error;
  });
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
    try {
      if (candidate.includes('/') || candidate.includes('\\')) {
        execFileSync(process.platform === 'win32' ? 'where.exe' : 'test', process.platform === 'win32' ? [candidate] : ['-x', candidate], { stdio: 'ignore' });
        return candidate;
      }
      return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    } catch { /* Try the next installed browser. */ }
  }
  throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
}

async function requestLocalJson(url, options = {}) {
  const parsed = new URL(url);
  assert.ok(LOOPBACK_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'DevTools must remain on loopback.');
  const response = await fetch(parsed, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Loopback DevTools returned HTTP ${response.status}.`);
  return response.json();
}

function browserEnvironment() {
  const environment = { ...childEnvironment() };
  environment.HOME = process.env.HOME || tmpdir();
  environment.TMPDIR = temporaryRoot || tmpdir();
  delete environment.NEXT_TELEMETRY_DISABLED;
  return environment;
}

async function startBrowser() {
  if (typeof WebSocket !== 'function') throw new Error('This smoke needs Node with its built-in WebSocket API.');
  const executable = findBrowserExecutable();
  const profile = join(temporaryRoot, 'isolated-chrome-profile');
  browser = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-features=MediaRouter',
    '--no-proxy-server',
    `--host-resolver-rules=${HOST_RESOLVER_RULES}`,
    'about:blank',
  ], {
    env: browserEnvironment(),
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  createdProcesses.add(browser);
  browser.on('error', (error) => { browserSpawnError = error; });
  const activePortFile = join(profile, 'DevToolsActivePort');
  const devTools = await waitFor(async () => {
    if (browserSpawnError || browser.exitCode !== null) throw new Error('The isolated browser could not start.');
    try {
      const lines = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return { port, path: lines[1] };
    } catch { /* Browser startup is still in progress. */ }
    return false;
  }, 'isolated browser DevTools', 45_000);
  browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
  const target = await requestLocalJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
  const targetSocket = new URL(target.webSocketDebuggerUrl);
  assert.equal(targetSocket.protocol, 'ws:');
  assert.equal(Number(targetSocket.port), devTools.port);
  assert.ok(LOOPBACK_HOSTS.has(targetSocket.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'Browser DevTools must use loopback.');
  pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
  observeBrowserNetwork();
  await Promise.all([
    pageCdp.send('Page.enable'),
    pageCdp.send('Runtime.enable'),
    pageCdp.send('Network.enable'),
    pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
  ]);
}

async function verifyBrowserSupabaseHealth() {
  currentStep = 'verify browser loopback access to Supabase';
  await navigate(`${localSupabaseUrl.origin}/auth/v1/health`);
  await waitFor(() => localResponseStatuses.includes('54321/auth/v1/health:200'), 'the browser Supabase health response', 5_000);
}

function safeBrowserRoute(rawUrl) {
  if (rawUrl === 'about:blank') return 'about:blank';
  try {
    const parsed = new URL(rawUrl);
    return allowedOrigins.has(parsed.origin) ? String(parsed.port || 'default') + parsed.pathname : '[non-local-origin]';
  } catch { return '[invalid-url]'; }
}

function observeBrowserNetwork() {
  pageCdp.on('Network.requestWillBeSent', ({ requestId, request, redirectResponse }) => {
    try {
      const parsed = new URL(request.url);
      if (/^https?:$/.test(parsed.protocol) && !allowedOrigins.has(parsed.origin)) externalOrigins.add(parsed.origin);
      else if (allowedOrigins.has(parsed.origin)) {
        const route = String(parsed.port) + parsed.pathname;
        localRequestIds.set(requestId, route);
        localRequestPaths.push(route);
        if (localRequestPaths.length > 30) localRequestPaths.shift();
      }
    } catch { /* Non-HTTP resource. */ }
    if (redirectResponse) {
      redirectResponses.push(`${safeBrowserRoute(redirectResponse.url)}:${redirectResponse.status}`);
      if (redirectResponses.length > 30) redirectResponses.shift();
    }
  });
  pageCdp.on('Network.responseReceived', ({ requestId, response }) => {
    try {
      const parsed = new URL(response.url);
      if (allowedOrigins.has(parsed.origin)) {
        localResponseStatuses.push(String(parsed.port) + parsed.pathname + ':' + response.status);
        if (localResponseStatuses.length > 30) localResponseStatuses.shift();
      }
    } catch { /* Record only safe origin/path/status diagnostics. */ }
    localRequestIds.delete(requestId);
  });
  pageCdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const route = localRequestIds.get(requestId);
    if (!route) return;
    localNetworkFailures.push(`${route}:${String(errorText || 'unknown').slice(0, 80)}`);
    if (localNetworkFailures.length > 30) localNetworkFailures.shift();
    localRequestIds.delete(requestId);
  });
  pageCdp.on('Page.frameNavigated', ({ frame }) => {
    frameNavigationRoutes.push(safeBrowserRoute(frame.url));
    if (frameNavigationRoutes.length > 30) frameNavigationRoutes.shift();
  });
  pageCdp.on('Page.frameStartedLoading', () => {
    frameLoadEvents.push('started');
    if (frameLoadEvents.length > 30) frameLoadEvents.shift();
  });
  pageCdp.on('Page.frameStoppedLoading', () => {
    frameLoadEvents.push('stopped');
    if (frameLoadEvents.length > 30) frameLoadEvents.shift();
  });
  pageCdp.on('Inspector.targetCrashed', () => { pageTargetCrashed = true; });
  pageCdp.on('Network.webSocketCreated', ({ url }) => {
    try {
      const parsed = new URL(url);
      const origin = `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
      if (!allowedOrigins.has(origin)) externalOrigins.add(origin);
    } catch { externalOrigins.add('invalid-websocket-origin'); }
  });
  pageCdp.on('Runtime.exceptionThrown', () => { runtimeExceptionCount += 1; });
  pageCdp.on('Runtime.consoleAPICalled', ({ type }) => { if (type === 'error') consoleErrorCount += 1; });
  pageCdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    let origin = '';
    let route = '[invalid-url]';
    try {
      const parsed = new URL(request.url);
      origin = parsed.origin;
      route = String(parsed.port) + parsed.pathname;
    } catch { /* Requests without an origin remain blocked. */ }
    const allowed = allowedOrigins.has(origin);
    if (allowed) {
      fetchPausedPaths.push(route);
      if (fetchPausedPaths.length > 30) fetchPausedPaths.shift();
    }
    const action = allowed
      ? pageCdp.send('Fetch.continueRequest', { requestId })
      : pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    void action.then(() => {
      if (allowed) fetchActionResults.push(`${route}:continued`);
      if (fetchActionResults.length > 30) fetchActionResults.shift();
    }).catch((error) => {
      if (/invalid interception id/i.test(error.message || '')) return;
      firewallFailure = true;
      if (allowed) fetchActionResults.push(`${route}:continue-failed`);
      if (fetchActionResults.length > 30) fetchActionResults.shift();
    });
  });
}

async function evaluate(expression) {
  const response = await pageCdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, STEP_TIMEOUT_MS);
  if (response.exceptionDetails) throw new Error('A browser-side smoke assertion failed.');
  return response.result?.value;
}

async function navigate(url) {
  const parsed = new URL(url);
  assert.ok(allowedOrigins.has(parsed.origin), 'Browser navigation must use the isolated app or loopback Supabase.');
  currentStep = `browser navigation to ${parsed.pathname}`;
  try { await pageCdp.send('Page.navigate', { url: parsed.href }); }
  catch (error) {
    navigationCommandErrors += 1;
    navigationFailureKind = /timed out waiting/i.test(error?.message || '') ? 'timeout'
      : /closed/i.test(error?.message || '') ? 'connection-closed'
        : /CDP error/i.test(error?.message || '') ? 'protocol-error' : 'other';
    try {
      const { targetInfos = [] } = await browserCdp.send('Target.getTargets', {}, 2_000);
      browserTargetRoutes = targetInfos.slice(0, 12).map(({ type, url: targetUrl }) => `${type}:${safeBrowserRoute(targetUrl)}`);
    } catch { browserTargetRoutes = ['unavailable']; }
    throw new Error(`A local browser navigation did not complete (${navigationFailureKind}).`);
  }
}

async function clickButton(label, initialInviteButton = false) {
  const result = await evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const candidates = Array.from(document.querySelectorAll('button')).filter((button) => normalize(button.innerText) === ${JSON.stringify(label.toLocaleLowerCase())});
    const button = candidates.find((candidate) => ${initialInviteButton ? '!candidate.hasAttribute("aria-controls")' : 'true'});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(result, true, `The ${label} action was not available in the expected UI state.`);
}

async function fillInput(selector, value) {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    element.focus();
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(result, true, `The ${selector} composer field was not available.`);
}

function browserTextIncludes(expected) {
  return `String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase().includes(${JSON.stringify(expected.toLocaleLowerCase())})`;
}

async function createDisposableSender() {
  currentStep = 'create exact local disposable sender and profile';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const email = `drop-qr-smoke-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const userName = `qr_${suffix.slice(0, 10)}`;
  disposableEmail = email;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (data?.user?.id) disposableUser = { id: data.user.id, email, userName };
  if (error || !disposableUser?.id) throw new Error('Could not create the exact disposable local QR test user.');
  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id,
    username: userName,
    display_name: 'QR smoke sender',
    bio: '',
  });
  if (profileError) throw new Error('Could not create the exact disposable local QR test profile.');
  const { data: profile, error: verifyError } = await admin.from('profiles').select('id, username').eq('id', data.user.id).maybeSingle();
  assert.ifError(verifyError);
  assert.deepEqual(profile, { id: data.user.id, username: userName });
  const localClient = createClient(localSupabaseUrl.origin, localAnonKey, {
    global: { fetch: localSupabaseFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signedIn, error: signInError } = await localClient.auth.signInWithPassword({ email, password });
  if (signInError || signedIn.user?.id !== data.user.id || !signedIn.session?.access_token) {
    throw new Error('Could not authenticate the exact disposable local QR test user.');
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (linkError || !link.properties?.action_link) throw new Error('Could not generate the local disposable sign-in link.');
  const actionLink = new URL(link.properties.action_link);
  assert.equal(actionLink.protocol, 'http:');
  assert.equal(actionLink.port, '54321');
  assert.equal(actionLink.pathname, '/auth/v1/verify');
  assert.ok(LOOPBACK_HOSTS.has(actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'The sign-in link must remain on loopback Supabase.');
  assert.ok(allowedOrigins.has(actionLink.origin), 'The sign-in link origin must match the configured local Supabase origin.');
  const callback = new URL(actionLink.searchParams.get('redirect_to') || '');
  assert.equal(callback.origin, APP_ORIGIN, 'The local magic link must return to the isolated QR app.');
  assert.equal(callback.pathname, '/auth/callback', 'The local magic link must use the app auth callback.');
  return { email, password, href: actionLink.href };
}

async function signInAndCompose(account) {
  await navigate(account.href);
  currentStep = 'wait for the local magic-link callback';
  try {
    await waitFor(async () => evaluate("location.origin === " + JSON.stringify(APP_ORIGIN) + " && location.pathname !== '/auth/callback'"), 'the local sign-in callback');
  } catch {
    let callbackState = { rendererAvailable: false };
    try {
      callbackState = await evaluate("(() => { const body = String(document.body.innerText || '').toLocaleLowerCase(); return { origin: location.origin, pathname: location.pathname, accountReady: body.includes('your account is ready.'), accountChecking: body.includes('checking your account'), expiredMessage: body.includes('expired'), genericError: body.includes('something went wrong') || body.includes('could not complete') }; })()");
    } catch { /* The renderer may be busy with a navigation; report only safe request-stage diagnostics. */ }
    throw new Error('The local magic-link callback did not finish; safe page state='
      + JSON.stringify(callbackState)
      + '; local request paths=' + JSON.stringify(localRequestPaths)
      + '; local response statuses=' + JSON.stringify(localResponseStatuses)
      + '; browser fetch paused=' + JSON.stringify(fetchPausedPaths)
      + '; browser fetch actions=' + JSON.stringify(fetchActionResults)
      + '; local network failures=' + JSON.stringify(localNetworkFailures)
      + '; redirect responses=' + JSON.stringify(redirectResponses)
      + '; committed frame routes=' + JSON.stringify(frameNavigationRoutes)
      + '; frame load events=' + JSON.stringify(frameLoadEvents)
      + '; pageTargetCrashed=' + pageTargetCrashed
      + '; externalBrowserOrigins=' + externalOrigins.size
      + '; firewallFailure=' + firewallFailure
      + '; pageExceptions=' + runtimeExceptionCount
      + '; consoleErrors=' + consoleErrorCount
      + '; navigationCommandErrors=' + navigationCommandErrors + '.');
  }
  currentStep = 'open a fresh authenticated composer';
  await navigate(`${APP_ORIGIN}/compose?new=1`);
  currentStep = 'wait for the authenticated fresh composer';
  await waitFor(async () => evaluate(`location.pathname === '/compose'
    && document.querySelector('#drop-subject') !== null
    && document.querySelector('#drop-content') !== null
    && ${browserTextIncludes('Your account is ready.')}`), 'the authenticated fresh composer');
  await pageCdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

async function waitForExactDrop() {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('letters')
      .select('id, sender_id, recipient_id, recipient_username, recipient_name, subject, content, status, delivery_mode, payload_kind')
      .eq('sender_id', disposableUser.id)
      .eq('subject', dropSubject)
      .eq('content', dropContent)
      .limit(2);
    if (error) throw new Error('Could not verify the local QR test drop.');
    assert.ok((data || []).length <= 1, 'The unique QR test draft must create at most one pending drop.');
    if (data?.[0]) {
      const row = data[0];
      dropId = row.id;
      assert.equal(row.sender_id, disposableUser.id);
      assert.equal(row.recipient_id, null);
      assert.equal(row.recipient_username, null);
      assert.equal(row.recipient_name, null);
      assert.equal(row.subject, dropSubject);
      assert.equal(row.content, dropContent);
      assert.equal(row.status, 'claim_pending');
      assert.equal(row.delivery_mode, 'instant');
      assert.equal(row.payload_kind, 'text');
      return;
    }
    await sleep(200);
  }
  throw new Error('The QR action did not create its exact pending text drop.');
}

async function readQrState() {
  return evaluate(`(async () => {
    const code = document.querySelector('code[aria-label="Select and copy this private claim link"]');
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.getAttribute('aria-controls') === 'private-claim-qr');
    const region = document.querySelector('#private-claim-qr');
    const svg = region?.querySelector('svg');
    const image = region?.querySelector('[role="img"]');
    const link = code?.textContent?.trim() || '';
    let validLinkShape = false;
    try {
      const parsed = new URL(link);
      validLinkShape = parsed.origin === ${JSON.stringify(APP_ORIGIN)}
        && parsed.pathname === '/claim'
        && parsed.search === ''
        && /^#token=[a-f0-9]{64}$/i.test(parsed.hash);
    } catch { /* An absent or malformed link fails the boolean assertion. */ }
    const digest = async (value) => {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
    };
    let decodedMatch = null;
    if (svg && typeof BarcodeDetector === 'function') {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const source = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
        const bitmap = await createImageBitmap(source);
        const decoded = await detector.detect(bitmap);
        bitmap.close();
        if (decoded.length) decodedMatch = decoded.some((item) => item.rawValue === link);
      } catch { /* Browser image decoding support varies; accessible reuse remains verified below. */ }
    }
    return {
      visible: Boolean(region && !region.hidden && svg),
      expanded: button?.getAttribute('aria-expanded') === 'true',
      regionRole: region?.getAttribute('role') === 'region',
      regionLabel: region?.getAttribute('aria-label') === 'Private claim scan code',
      imageRole: image?.getAttribute('role') === 'img',
      imageLabel: image?.getAttribute('aria-label') === 'QR code for the private claim link',
      focused: document.activeElement === region,
      validLinkShape,
      linkFingerprint: link ? await digest(link) : '',
      svgFingerprint: svg ? await digest(svg.outerHTML) : '',
      decodedMatch,
    };
  })()`);
}

async function assertPendingDropIsPrivate() {
  const { data, error } = await anonymous.from('letters').select('id').eq('id', dropId).maybeSingle();
  assert.ifError(error);
  assert.equal(data, null, 'An anonymous client must not read the unclaimed private drop.');
}

async function runQrJourney() {
  const account = await createDisposableSender();
  await signInAndCompose(account);
  const viewport = await evaluate('({ width: window.innerWidth, height: window.innerHeight, noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth })');
  assert.deepEqual(viewport, { width: 390, height: 844, noHorizontalOverflow: true }, 'The QR browser smoke must run in a 390×844 mobile viewport without horizontal overflow.');

  currentStep = 'enter unique text in the composer';
  dropSubject = `QR smoke ${randomUUID().slice(0, 12)}`;
  dropContent = `Private QR browser smoke ${randomUUID()}`;
  await fillInput('#drop-subject', dropSubject);
  await fillInput('#drop-content', dropContent);
  currentStep = 'choose the handleless claim flow';
  await clickButton('Share without a handle');
  currentStep = 'wait for the private claim QR action';
  try {
    await waitFor(async () => evaluate(`(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      return document.querySelector('#unaddressed-claim-title') !== null
        && [...document.querySelectorAll('button')].some((button) => normalize(button.innerText) === 'show scan code' && !button.hasAttribute('aria-controls') && !button.disabled);
    })()`), 'the private claim QR action');
  } catch {
    const safeState = await evaluate(`(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const body = normalize(document.body.innerText).toLocaleLowerCase();
      return {
        composerReady: Boolean(document.querySelector('#drop-content')),
        subjectFilled: Boolean(document.querySelector('#drop-subject')?.value),
        contentFilled: Boolean(document.querySelector('#drop-content')?.value),
        accountReady: body.includes('your account is ready.'),
        accountChecking: body.includes('checking your account'),
        unaddressedPanel: Boolean(document.querySelector('#unaddressed-claim-title')),
        qrActionAvailable: [...document.querySelectorAll('button')].some((button) => normalize(button.innerText).toLocaleLowerCase() === 'show scan code' && !button.hasAttribute('aria-controls') && !button.disabled),
        buttonLabels: [...document.querySelectorAll('button')].map((button) => normalize(button.innerText)).filter(Boolean).slice(0, 18),
      };
    })()`);
    throw new Error(`The private claim QR action did not become available; safe composer state: ${JSON.stringify(safeState)}.`);
  }
  currentStep = 'issue private claim QR through the composer';
  await clickButton('Show scan code', true);
  currentStep = 'verify the exact pending text drop';
  await waitForExactDrop();
  currentStep = 'verify accessible QR and private link';
  const issued = await waitFor(async () => {
    const state = await readQrState();
    return state?.visible && state?.expanded && state?.regionRole && state?.regionLabel
      && state?.imageRole && state?.imageLabel && state?.focused && state?.validLinkShape ? state : false;
  }, 'a focused, accessible private claim QR and local link');
  assert.ok(issued.linkFingerprint, 'The accessible private claim link must be present.');
  assert.ok(issued.svgFingerprint, 'The scan code must render as SVG.');
  if (issued.decodedMatch !== null) assert.equal(issued.decodedMatch, true, 'The QR must encode the displayed private claim link.');
  console.log('[browser-qr-smoke] PASS 390x844 composer issued one pending private text drop and focused its labeled QR region/image.');

  await assertPendingDropIsPrivate();
  currentStep = 'hide QR and verify the accessible link remains';
  const hideButton = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.getAttribute('aria-controls') === 'private-claim-qr');
    if (!button || button.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() !== 'hide scan code') return false;
    button.click();
    return true;
  })()`);
  assert.equal(hideButton, true, 'The visible QR must have its accessible hide control.');
  const hidden = await waitFor(async () => evaluate(`(() => {
    const button = document.querySelector('button[aria-controls="private-claim-qr"]');
    const region = document.querySelector('#private-claim-qr');
    const code = document.querySelector('code[aria-label="Select and copy this private claim link"]');
    return button?.getAttribute('aria-expanded') === 'false' && region?.hidden === true && Boolean(code?.textContent?.trim());
  })()`), 'the QR hide state with its link preserved');
  assert.equal(hidden, true);
  const hiddenLinkFingerprint = await evaluate(`(async () => {
    const link = document.querySelector('code[aria-label="Select and copy this private claim link"]')?.textContent?.trim() || '';
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(link))), (item) => item.toString(16).padStart(2, '0')).join('');
  })()`);
  assert.equal(hiddenLinkFingerprint, issued.linkFingerprint, 'Hiding the scan code must preserve the same accessible invite link.');
  await clickButton('Show scan code');
  currentStep = 'show QR again and compare its invite';
  const shownAgain = await waitFor(async () => {
    const state = await readQrState();
    return state?.visible && state?.expanded ? state : false;
  }, 'the QR show state after hide');
  assert.equal(shownAgain.linkFingerprint, issued.linkFingerprint, 'Showing the code again must reuse the same private invite.');
  assert.equal(shownAgain.svgFingerprint, issued.svgFingerprint, 'Showing the code again must render the same QR payload.');
  assert.equal(shownAgain.decodedMatch, issued.decodedMatch, 'QR decode behavior must stay stable across hide/show.');
  console.log('[browser-qr-smoke] PASS hide/show preserves the same accessible private invite and QR.');

  await assertPendingDropIsPrivate();
  currentStep = 'start a new draft and verify stale QR state clears';
  await navigate(`${APP_ORIGIN}/compose?new=1`);
  currentStep = 'verify the new draft is authenticated';
  await waitFor(async () => evaluate(`location.pathname === '/compose'
    && document.querySelector('#drop-content') !== null
    && ${browserTextIncludes('Your account is ready.')}`), 'a new authenticated draft');
  const reset = await evaluate(`(() => ({
    staleLink: Boolean(document.querySelector('code[aria-label="Select and copy this private claim link"]')),
    staleQr: Boolean(document.querySelector('#private-claim-qr svg')),
    pendingReceipt: Boolean(document.querySelector('#claim-pending-title')),
    qrVisibleButton: [...document.querySelectorAll('button')].some((button) => button.getAttribute('aria-expanded') === 'true'),
  }))()`);
  assert.deepEqual(reset, { staleLink: false, staleQr: false, pendingReceipt: false, qrVisibleButton: false }, 'Starting a new draft must clear old claim QR state.');
  await assertPendingDropIsPrivate();
  assert.equal(externalOrigins.size, 0, 'Browser-page requests must not contact non-loopback origins.');
  assert.equal(firewallFailure, false, 'The browser request firewall must remain active.');
  assert.equal(consoleErrorCount, 0, 'The QR browser journey must not log console errors.');
  assert.equal(runtimeExceptionCount, 0, 'The QR browser journey must not throw page exceptions.');
  console.log('[browser-qr-smoke] PASS starting a new draft clears the previous private QR state.');
  console.log('[browser-qr-smoke] NOTE page-request firewall covered the browser target; the separate Next.js dev-server process was not OS-sandboxed.');
  if (issued.decodedMatch === null) {
    console.log('[browser-qr-smoke] NOTE QR decode was unavailable in this browser; accessible link and same-link reuse were verified by link and SVG fingerprints.');
  }
}

function processGroupExists(pid) {
  if (process.platform === 'win32') return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return !processGroupExists(pid);
}

async function stopOwnedProcess(child) {
  if (!child) return;
  if (!Number.isInteger(child.pid)) {
    if (child.exitCode !== null) return;
    throw new Error('An isolated test process has no owned PID.');
  }
  if (process.platform === 'win32') {
    if (child.exitCode === null) child.kill('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    if (child.exitCode === null) child.kill('SIGKILL');
    if (child.exitCode === null) throw new Error('An isolated test process did not stop.');
    return;
  }

  const groupId = child.pid;
  if (processGroupExists(groupId)) {
    try { process.kill(-groupId, 'SIGTERM'); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }
    if (!await waitForProcessGroupExit(groupId, 5_000)) {
      try { process.kill(-groupId, 'SIGKILL'); }
      catch (error) { if (error?.code !== 'ESRCH') throw error; }
      if (!await waitForProcessGroupExit(groupId, 5_000)) throw new Error('An isolated test process group did not stop.');
    }
  }
  if (child.exitCode === null) {
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (child.exitCode === null || processGroupExists(groupId)) throw new Error('An isolated test process group did not stop.');
}

async function findExactDisposableUserByEmail() {
  if (!admin || !disposableEmail) return null;
  const expectedEmail = disposableEmail.toLocaleLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('Could not resolve the exact disposable local Auth user by email.');
    const users = data?.users || [];
    const matches = users.filter((user) => (user.email || '').toLocaleLowerCase() === expectedEmail);
    if (matches.length > 1) throw new Error('More than one local Auth user matched the disposable email.');
    if (matches.length === 1) return matches[0];
    if (users.length < perPage || (data.lastPage > 0 && page >= data.lastPage)) return null;
  }
  throw new Error('Could not finish resolving the exact disposable local Auth user.');
}

async function cleanupDatabase() {
  if (!admin) return;
  if (!disposableUser && disposableEmail) {
    const found = await findExactDisposableUserByEmail();
    if (found) disposableUser = { id: found.id, email: disposableEmail, userName: '' };
    else {
      profileCleanupVerified = true;
      userCleanupVerified = true;
    }
  }
  if (disposableUser && dropSubject && dropContent) {
    const { data: matches, error: lookupError } = await admin.from('letters')
      .select('id, sender_id')
      .eq('sender_id', disposableUser.id)
      .eq('subject', dropSubject)
      .eq('content', dropContent)
      .limit(2);
    if (lookupError || (matches || []).length > 1) throw new Error('Could not resolve the exact disposable drop for cleanup.');
    const match = matches?.[0];
    if (match) {
      const { error: deleteError } = await admin.from('letters').delete().eq('id', match.id).eq('sender_id', disposableUser.id);
      if (deleteError) throw new Error('Could not delete the exact disposable QR drop.');
      dropCleanupDeleted += 1;
      const { data: remaining, error: verifyError } = await admin.from('letters').select('id').eq('id', match.id).eq('sender_id', disposableUser.id).maybeSingle();
      if (verifyError || remaining) throw new Error('The exact disposable QR drop still exists after cleanup.');
    }
    dropCleanupVerified = true;
  }
  if (disposableUser) {
    const { error: deleteProfileError } = await admin.from('profiles').delete().eq('id', disposableUser.id);
    if (deleteProfileError) throw new Error('Could not delete the exact disposable QR profile.');
    const { data: remainingProfile, error: profileLookupError } = await admin.from('profiles').select('id').eq('id', disposableUser.id).maybeSingle();
    if (profileLookupError || remainingProfile) throw new Error('The exact disposable profile still exists after cleanup.');
    profileCleanupVerified = true;

    const { data: existing, error: userLookupError } = await admin.auth.admin.getUserById(disposableUser.id);
    if (userLookupError && !/not found/i.test(userLookupError.message || '')) throw new Error('Could not resolve the exact disposable local Auth user for cleanup.');
    if (existing?.user) {
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(disposableUser.id);
      if (deleteUserError) throw new Error('Could not delete the exact disposable local Auth user.');
    }
    const { data: afterDelete, error: verifyUserError } = await admin.auth.admin.getUserById(disposableUser.id);
    if (afterDelete?.user || (verifyUserError && !/not found/i.test(verifyUserError.message || ''))) throw new Error('The exact disposable Auth user still exists after cleanup.');
    const remainingByEmail = await findExactDisposableUserByEmail();
    if (remainingByEmail) throw new Error('The exact disposable Auth email still exists after cleanup.');
    userCleanupVerified = true;
  }
}

async function cleanup() {
  pageCdp?.close();
  browserCdp?.close();
  for (const child of createdProcesses) {
    try { await stopOwnedProcess(child); }
    catch {
      cleanupFailed = true;
      ownedProcessGroupsExited = false;
      console.error('[browser-qr-smoke] CLEANUP FAILED: an isolated app or browser process did not stop.');
    }
  }
  try { await cleanupDatabase(); }
  catch {
    cleanupFailed = true;
    console.error('[browser-qr-smoke] CLEANUP FAILED: exact local disposable drop, profile, or Auth user cleanup could not be verified.');
  }
  if (temporaryRoot && ownedProcessGroupsExited) {
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
      temporaryCleanupVerified = true;
    } catch (error) {
      cleanupFailed = true;
      temporaryCleanupErrorCode = typeof error?.code === 'string' ? error.code : 'unknown';
      console.error(`[browser-qr-smoke] CLEANUP FAILED: isolated temp removal error code=${temporaryCleanupErrorCode}.`);
    }
  } else if (temporaryRoot) {
    cleanupFailed = true;
    temporaryCleanupErrorCode = 'owned-process-still-running';
    console.error('[browser-qr-smoke] CLEANUP FAILED: isolated temp removal skipped until owned processes exit.');
  }
}

async function main() {
  currentStep = 'validate local URL guard';
  guardSelfTest();
  currentStep = 'check isolated app port';
  await assertPortAvailable(APP_PORT);
  currentStep = 'read local environment file';
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local from the local Supabase CLI output before running this smoke.');
  });
  currentStep = 'validate local Supabase configuration';
  const config = loadLocalConfig(envText);
  localSupabaseUrl = config.url;
  localAnonKey = config.anonKey;
  allowedOrigins.add(localSupabaseUrl.origin);
  assert.ok(existsSync(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next')), 'Install the project dependencies before running this smoke.');
  assert.equal(childEnvironment({ includeAnonKey: true }).SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(browserEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined);

  currentStep = 'check loopback Supabase Auth health';
  const health = await localSupabaseFetch(new URL('/auth/v1/health', localSupabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, `Local Supabase Auth health returned HTTP ${health.status}.`);
  admin = createClient(localSupabaseUrl.origin, config.serviceRoleKey, {
    global: { fetch: localSupabaseFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anonymous = createClient(localSupabaseUrl.origin, localAnonKey, {
    global: { fetch: localSupabaseFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  currentStep = 'create isolated temporary root';
  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-qr-smoke-'));
  try {
    currentStep = 'start isolated app';
    await startTemporaryApp();
    currentStep = 'start isolated browser';
    await startBrowser();
    await verifyBrowserSupabaseHealth();
    await runQrJourney();
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The QR smoke finished with cleanup failures.');
}

const onSignal = (signal) => active.abort(new Error(`Received ${signal}; cleaning up the local QR smoke.`));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  const processesExited = [...createdProcesses].every((child) => child.exitCode !== null && !processGroupExists(child.pid));
  console.log(`[browser-qr-smoke] CLEANUP VERIFIED dropRowsDeleted=${dropCleanupDeleted} dropAbsent=${dropCleanupVerified} profileAbsent=${profileCleanupVerified} authUserAbsent=${userCleanupVerified} ownedProcessGroupsExited=${processesExited} isolatedProfileRemoved=${temporaryCleanupVerified}. No mailbox fixtures were created; port 4004 and hosted Supabase were untouched.`);
}).catch((error) => {
  active.abort(error);
  const safeMessage = error?.message || 'unexpected failure';
  const errorCode = typeof error?.code === 'string' ? error.code : 'none';
  const dropState = dropSubject ? `deleted=${dropCleanupDeleted},absent=${dropCleanupVerified}` : 'not-created';
  const profileState = disposableUser ? String(profileCleanupVerified) : 'not-created';
  const userState = disposableUser ? String(userCleanupVerified) : 'not-created';
  const tempState = temporaryRoot ? `${temporaryCleanupVerified}(${temporaryCleanupErrorCode || 'no-error'})` : 'not-created';
  const processesState = [...createdProcesses].every((child) => child.exitCode !== null && !processGroupExists(child.pid));
  const navigationDiagnostics = navigationCommandErrors ? '; safeBrowserDiagnostics=' + JSON.stringify({
    failureKind: navigationFailureKind,
    requests: localRequestPaths.slice(-12),
    responses: localResponseStatuses.slice(-12),
    fetchPaused: fetchPausedPaths.slice(-12),
    fetchActions: fetchActionResults.slice(-12),
    networkFailures: localNetworkFailures.slice(-12),
    redirects: redirectResponses.slice(-12),
    frames: frameNavigationRoutes.slice(-12),
    frameLoads: frameLoadEvents.slice(-12),
    targets: browserTargetRoutes,
    targetCrashed: pageTargetCrashed,
    pageConnectionClosed: pageCdp?.closed ?? null,
    externalOriginCount: externalOrigins.size,
  }) : '';
  console.error('[browser-qr-smoke] FAIL during ' + currentStep + ': ' + safeMessage + ' (code=' + errorCode + ')' + navigationDiagnostics + '.');
  console.error(`[browser-qr-smoke] CLEANUP drop=${dropState} profileAbsent=${profileState} authUserAbsent=${userState} ownedProcessGroupsExited=${processesState} isolatedProfileRemoved=${tempState} failed=${cleanupFailed}. No mailbox fixtures were created.`);
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
