#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertTrustedLocalSupabaseListener } from './localSupabaseListener.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const BUCKET = 'drop-media';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HOST_RESOLVER_RULES = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1';
const BUILD_TIMEOUT_MS = 180_000;
const APP_TIMEOUT_MS = 60_000;
const BROWSER_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 30_000;
const active = new AbortController();
const allowedOrigins = new Set([APP_ORIGIN]);
const sessions = [];
const createdUserIds = [];
const fixtures = [];
const storagePaths = new Set();

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
        pending.reject(new Error(`DevTools closed during ${pending.method}.`));
        this.pending.delete(id);
      }
    });
    socket.addEventListener('error', () => {});
  }

  static async connect(url, signal) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to isolated browser DevTools.')), 5_000);
      const onAbort = () => { clearTimeout(timer); reject(signal.reason || new Error('Interrupted connecting to DevTools.')); };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new Error('Could not connect to isolated browser DevTools.')); }, { once: true });
    });
    return new CdpConnection(socket, signal);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`DevTools closed before ${method}.`));
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
        reject(new Error(`Timed out waiting for DevTools ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer, onAbort, method });
      this.signal.addEventListener('abort', onAbort, { once: true });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); this.signal.removeEventListener('abort', onAbort); reject(error); }
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
    this.pageCdp = null;
    this.browserCdp = null;
    this.spawnError = null;
    this.externalOrigins = new Set();
    this.failedLocalRequests = [];
    this.storageWrites = [];
    this.storageReads = [];
    this.consoleErrors = 0;
    this.runtimeExceptions = 0;
    this.expectedStorageOwner = null;
  }

  async launch() {
    if (typeof WebSocket !== 'function') throw new Error('This smoke requires Node’s built-in WebSocket API.');
    const executable = findBrowserExecutable();
    this.browser = spawn(executable, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
      '--disable-features=MediaRouter', '--no-proxy-server', `--host-resolver-rules=${HOST_RESOLVER_RULES}`, 'about:blank',
    ], { env: browserEnvironment(), stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
    this.browser.on('error', (error) => { this.spawnError = error; });
    const devTools = await this.waitForDevTools();
    this.browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    this.pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
    this.observeNetwork();
    await Promise.all([
      this.pageCdp.send('Page.enable'), this.pageCdp.send('Runtime.enable'), this.pageCdp.send('Network.enable'),
      this.pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
      this.pageCdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }),
      this.pageCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }),
    ]);
  }

  async waitForDevTools() {
    const file = join(this.profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < BROWSER_TIMEOUT_MS / 100; attempt += 1) {
      if (this.spawnError) throw new Error('An isolated browser process could not start.');
      if (this.browser.exitCode !== null) throw new Error('An isolated browser exited before DevTools was ready.');
      try {
        const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
        const port = Number(lines[0]);
        if (Number.isInteger(port) && port > 0) return { port, path: lines[1] };
      } catch { /* Browser has not published the DevTools port yet. */ }
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
      if (parsed.pathname.includes('/storage/v1/object/')) {
        let pathname = parsed.pathname;
        try { pathname = decodeURIComponent(pathname); } catch { /* Keep encoded paths for the safe-path assertion. */ }
        const route = pathname.slice('/storage/v1/object/'.length).split('/');
        const bucketIndex = route[0] === BUCKET ? 0 : ['sign', 'authenticated', 'public'].includes(route[0]) && route[1] === BUCKET ? 1 : -1;
        if (bucketIndex >= 0) {
          const objectPath = route.slice(bucketIndex + 1).join('/');
          if (request.method === 'GET') this.storageReads.push({ origin: parsed.origin, objectPath });
          if (['POST', 'PUT'].includes(request.method)) {
            this.storageWrites.push({ origin: parsed.origin, objectPath });
            if (this.name === 'sender' && this.expectedStorageOwner) {
              if (parsed.origin !== supabaseUrl.origin || !isSafeOwnedStorageObjectPath(objectPath, this.expectedStorageOwner)) {
                this.uncleanableStorageWrite = true;
              } else storagePaths.add(objectPath);
            }
          }
        }
      }
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
    const result = await this.pageCdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, STEP_TIMEOUT_MS);
    if (result.exceptionDetails) throw new Error('A browser-side assertion could not be evaluated.');
    return result.result?.value;
  }

  async navigate(url) {
    const target = new URL(url);
    assert.ok(allowedOrigins.has(target.origin), 'Browser navigation must remain on the isolated app or local Supabase.');
    await this.pageCdp.send('Page.navigate', { url }, STEP_TIMEOUT_MS);
  }

  async waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
      try { const value = await predicate(); if (value) return value; } catch { /* Route transitions can briefly make selectors unavailable. */ }
      await sleep(200, active.signal);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[0].trim().startsWith('#')) continue;
    const [, name, raw] = match;
    const quoted = raw.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
    values[name] = quoted ? (quoted[1] ?? quoted[2]) : raw.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

function requireLocalSupabaseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('.env.local has an invalid Supabase URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(host), 'Supabase must use localhost, 127.0.0.1, or ::1.');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.port || '80', '54321');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
  return url;
}

function isSafeOwnedStorageObjectPath(path, ownerId) {
  const segments = typeof path === 'string' ? path.split('/') : [];
  return segments.length >= 2 && segments[0] === ownerId && segments.every((segment) => SAFE_SEGMENT.test(segment));
}

async function assertPortAvailable(port) {
  const server = createServer();
  try { await new Promise((resolveListen, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolveListen)); }
  catch (error) { if (error?.code === 'EADDRINUSE') throw new Error(`Port ${port} is already owned; this smoke left it untouched.`); throw error; }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

function minimalEnvironment(home = join(temporaryRoot || tmpdir(), 'home')) {
  const environment = { PATH: process.env.PATH || '', HOME: home, TMPDIR: temporaryRoot || tmpdir() };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}

function browserEnvironment() {
  const environment = minimalEnvironment();
  // Edge uses the host HOME for loopback networking; its browser profile remains temporary.
  environment.HOME = process.env.HOME || tmpdir();
  return environment;
}

function findBrowserExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')]
      : ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/') || candidate.includes('\\')) { execFileSync(process.platform === 'win32' ? 'where.exe' : 'test', process.platform === 'win32' ? [candidate] : ['-x', candidate], { stdio: 'ignore' }); return candidate; }
      return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    } catch { /* Try the next browser. */ }
  }
  throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Local DevTools returned HTTP ${response.status}.`);
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

function baseAppEnvironment() {
  return {
    ...minimalEnvironment(),
    NEXT_PUBLIC_SUPABASE_URL: localValues.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
}

async function startTemporaryApp() {
  const projectRoot = await makeIsolatedProject();
  const nextCli = resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next');
  const fontMockPath = join(temporaryRoot, 'mock-google-fonts.cjs');
  const fontFace = (family) => `@font-face {\n  font-family: '${family}';\n  src: local('Arial');\n}`;
  const fontResponses = {
    'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': fontFace('Inter'),
    'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap': fontFace('Playfair Display'),
    'https://fonts.googleapis.com/css2?family=Literata:wght@400;500;600&display=swap': fontFace('Literata'),
    'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap': fontFace('Courier Prime'),
  };
  await writeFile(fontMockPath, `module.exports = ${JSON.stringify(fontResponses)};\n`, { flag: 'wx' });
  const buildEnvironment = { ...baseAppEnvironment(), NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMockPath };
  const build = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: projectRoot,
    env: buildEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  app = build;
  let output = '';
  const retain = (chunk) => { output = `${output}${chunk}`.slice(-6_000); };
  build.stdout?.on('data', retain);
  build.stderr?.on('data', retain);
  let spawnError = null;
  build.on('error', (error) => { spawnError = error; });
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline && !spawnError && build.exitCode === null) await sleep(250, active.signal);
  if (spawnError || build.exitCode !== 0) {
    const reason = spawnError ? 'could not start' : build.exitCode === null ? 'timed out' : `exited with code ${build.exitCode}`;
    const safeOutput = output
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_URL, '[loopback Supabase URL]')
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, '[redacted anon key]')
      .replaceAll(localValues.SUPABASE_SERVICE_ROLE_KEY, '[redacted service-role key]')
      .trim();
    try { await stopOwnedProcess(build, 'isolated local build'); } catch { /* Keep the build failure primary; cleanup reports its own status. */ }
    app = null;
    throw new Error(`The isolated local build ${reason}.${safeOutput ? ` Build output: ${safeOutput}` : ''}`);
  }
  await stopOwnedProcess(build, 'isolated local build');

  // Service role exists only in the isolated server runtime, never in build or browser environments.
  app = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(TEST_PORT)], {
    cwd: projectRoot,
    env: { ...buildEnvironment, SUPABASE_SERVICE_ROLE_KEY: localValues.SUPABASE_SERVICE_ROLE_KEY },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: process.platform !== 'win32',
  });
  let serverError = null;
  app.on('error', (error) => { serverError = error; });
  for (let attempt = 0; attempt < APP_TIMEOUT_MS / 500; attempt += 1) {
    if (serverError || app.exitCode !== null) throw new Error('The isolated local app failed to start.');
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* The isolated Next process is still starting. */ }
    await sleep(500, active.signal);
  }
  throw new Error('The isolated local app did not become ready on port 6004.');
}

async function createAccount(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `drop-instant-media-${label}-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`Could not create disposable local ${label} account.`);
  const id = data.user.id;
  createdUserIds.push(id);
  const account = {
    id,
    email,
    username: `im_${label === 'sender' ? 's' : 'r'}_${suffix.slice(0, 8)}`,
    displayName: label === 'sender' ? 'Instant Sender' : 'Instant Recipient',
  };
  const { error: profileError } = await admin.from('profiles').insert({
    id,
    username: account.username,
    display_name: account.displayName,
    bio: '',
  });
  if (profileError) throw new Error(`Could not create disposable local ${label} profile.`);
  return { ...account, password };
}

async function signIn(session, account) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (error || !data.properties?.action_link) throw new Error(`Local Supabase could not sign in the disposable ${account.displayName}.`);
  const actionLink = new URL(data.properties.action_link);
  assert.equal(actionLink.protocol, 'http:');
  assert.equal(actionLink.port, '54321');
  assert.ok(LOOPBACK_HOSTS.has(actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase()));
  await session.navigate(data.properties.action_link);
  await session.waitFor(() => session.evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.body.innerText.includes(${JSON.stringify(`Connected as ${account.email}.`)})`), 'local magic-link sign-in');
}

async function clickButton(session, label) {
  return session.evaluate(`(() => {
    const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const expected = ${JSON.stringify(label.toLocaleLowerCase())};
    const button = [...document.querySelectorAll('button')].find((item) => norm(item.getAttribute('aria-label')) === expected || norm(item.innerText) === expected);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function fill(session, selector, value) {
  const ready = await session.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input || input.disabled || input.readOnly) return false;
    input.focus();
    input.select?.();
    return document.activeElement === input;
  })()`);
  assert.equal(ready, true, `Could not focus Compose field ${selector}.`);
  await session.pageCdp.send('Input.insertText', { text: value });
}

async function setInputFile(session, selector, filePath) {
  const { root } = await session.pageCdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await session.pageCdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `Could not find rendered file input ${selector}.`);
  await session.pageCdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
}

async function readDraft(session) {
  return session.evaluate(`(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('dear-exe:active-letter:v1:account:'));
    if (keys.length !== 1) return null;
    try {
      const value = JSON.parse(localStorage.getItem(keys[0]) || 'null');
      return value ? { id: value.id || null, mediaUploadId: value.mediaUploadId || null, payloadKind: value.payloadKind || null } : null;
    } catch { return null; }
  })()`);
}

async function sendMediaThroughCompose(session, payloadKind) {
  const isGif = payloadKind === 'gif';
  const filePath = resolve(PROJECT_ROOT, isGif ? 'public/demo-cat.gif' : 'public/demo-cat.png');
  const bytes = await readFile(filePath);
  const mime = isGif ? 'image/gif' : 'image/png';
  assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024);
  const subject = `Instant ${isGif ? 'GIF' : 'photo'} ${randomUUID().slice(0, 8)}`;
  const content = `INSTANT_MEDIA_${payloadKind.toUpperCase()}_${randomUUID()}`;

  await session.navigate(`${APP_ORIGIN}/compose?new=1`);
  await session.waitFor(() => session.evaluate(`location.pathname === '/compose'
    && Boolean(document.querySelector('#drop-recipient'))
    && Boolean(document.querySelector('#drop-subject'))
    && Boolean(document.querySelector('#drop-content'))`), 'Compose form');
  await session.waitFor(() => session.evaluate(`document.body.innerText.includes('Your account is ready.')`), 'connected sender account');
  const selectedMode = await session.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => button.querySelector('span')?.innerText.trim() === 'Instant' && button.getAttribute('aria-pressed') === 'true')`);
  assert.equal(selectedMode, true, 'Instant delivery must be selected before sending media.');
  await fill(session, '#drop-recipient', recipient.username);
  const checkReady = await session.waitFor(() => session.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => /^check(?:\\s|$)/i.test(button.innerText.trim()) && !button.disabled)`), 'enabled handle check');
  assert.equal(checkReady, true);
  const checkClicked = await session.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => /^check(?:\\s|$)/i.test(item.innerText.trim()));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(checkClicked, true);
  await session.waitFor(() => session.evaluate(`document.body.innerText.includes(${JSON.stringify(`Recipient confirmed: ${recipient.displayName} (@${recipient.username})`)})`), 'confirmed recipient handle');
  assert.equal(await clickButton(session, isGif ? 'a gif' : 'a photo'), true, `Could not select the ${payloadKind} payload type.`);
  await session.waitFor(() => session.evaluate(`Boolean(document.querySelector('#drop-media'))`), `${payloadKind} file input`);
  await setInputFile(session, '#drop-media', filePath);
  await session.waitFor(() => session.evaluate(`document.body.innerText.includes('Saved privately on this device')`), `${payloadKind} attachment saved locally`);
  await session.waitFor(() => session.evaluate(`(() => {
    const image = [...document.querySelectorAll('img[alt]')].find((item) => item.getAttribute('alt') === ${JSON.stringify(isGif ? 'Attached GIF' : 'Attached photo')});
    return Boolean(image && image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0);
  })()`), `${payloadKind} Compose preview`);
  await fill(session, '#drop-subject', subject);
  await fill(session, '#drop-content', content);
  const draft = await session.waitFor(async () => {
    const value = await readDraft(session);
    return value?.payloadKind === payloadKind && value.mediaUploadId ? value : null;
  }, `${payloadKind} draft upload metadata`);
  assert.match(draft.id || '', /^draft-[a-f0-9-]{36}$/i);
  assert.match(draft.mediaUploadId || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const fixture = {
    letterId: draft.id,
    mediaUploadId: draft.mediaUploadId,
    senderId: sender.id,
    recipientId: recipient.id,
    payloadKind,
    subject,
    content,
    mime,
    mediaPath: `${sender.id}/${draft.id}/${draft.mediaUploadId}`,
  };
  fixtures.push(fixture);
  storagePaths.add(fixture.mediaPath);
  session.expectedStorageOwner = sender.id;
  assert.equal(await clickButton(session, 'send drop'), true, 'Could not submit Send drop from Compose.');
  await session.waitFor(() => session.evaluate(`location.pathname === '/sent' && new URL(location.href).searchParams.get('letter') === ${JSON.stringify(fixture.letterId)}`), 'Compose send receipt');
  session.expectedStorageOwner = null;

  const stagedPrefix = `${sender.id}/pending/${draft.id}/${draft.mediaUploadId}/`;
  const stagedWrites = session.storageWrites.filter((item) => item.objectPath.startsWith(stagedPrefix));
  assert.equal(stagedWrites.length, 1, `The ${payloadKind} action should upload one unique staged object.`);
  const stagedPath = stagedWrites[0].objectPath;
  assert.ok(stagedPath.slice(stagedPrefix.length).length > 0 && isSafeOwnedStorageObjectPath(stagedPath, sender.id));
  fixture.stagedPath = stagedPath;
  storagePaths.add(stagedPath);

  const { data, error } = await admin.from('letters')
    .select('id,sender_id,recipient_id,status,delivery_mode,subject,content,payload_kind,media_path,media_mime_type,media_size_bytes')
    .eq('id', fixture.letterId)
    .eq('sender_id', sender.id);
  assert.ifError(error);
  assert.equal(data?.length, 1);
  assert.deepEqual(data[0], {
    id: fixture.letterId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    status: 'delivered',
    delivery_mode: 'instant',
    subject,
    content,
    payload_kind: payloadKind,
    media_path: fixture.mediaPath,
    media_mime_type: mime,
    media_size_bytes: data[0].media_size_bytes,
  });
  assert.ok(Number.isInteger(data[0].media_size_bytes) && data[0].media_size_bytes > 0 && data[0].media_size_bytes <= 8 * 1024 * 1024);
  const { data: stored, error: storageError } = await admin.storage.from(BUCKET).download(fixture.mediaPath);
  assert.ifError(storageError);
  assert.ok(stored);
  assert.equal(stored.type, mime);
  assert.equal(stored.size, data[0].media_size_bytes);
  const signature = Buffer.from(await stored.slice(0, isGif ? 6 : 8).arrayBuffer()).toString('hex');
  assert.ok(isGif ? /^474946383[79]61$/i.test(signature) : /^89504e470d0a1a0a$/i.test(signature));
  await assertStorageObjectMissing(stagedPath, `The finalized ${payloadKind} should have no remaining staged object.`);
  console.log(`[browser-instant-media-e2e] PASS Compose sent one known-recipient Instant ${payloadKind} drop with validated media metadata.`);
  return fixture;
}

async function openAndReact(session, fixture) {
  const mediaReadStart = session.storageReads.length;
  await session.navigate(`${APP_ORIGIN}/mailbox`);
  await session.waitFor(() => session.evaluate(`location.pathname === '/mailbox'
    && document.body.innerText.includes('A mailbox for your people.')
    && document.body.innerText.includes(${JSON.stringify(fixture.subject)})`), `${fixture.payloadKind} recipient Inbox item`);
  const clicked = await session.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')].find((item) => item.innerText.includes(${JSON.stringify(fixture.subject)}));
    if (!link) return false;
    link.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not open the ${fixture.payloadKind} drop from recipient Inbox.`);
  await session.waitFor(() => session.evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.letterId}`)}
    && Array.from(document.querySelectorAll('button')).some((button) => button.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'reveal fragments')`), `${fixture.payloadKind} sealed detail`);
  const sealedState = await session.evaluate(`({ images: document.querySelectorAll('#letter-body img').length, body: document.querySelector('#letter-body')?.innerText || '' })`);
  assert.equal(sealedState.images, 0, `${fixture.payloadKind} media must remain sealed before opening.`);
  assert.equal(sealedState.body.includes(fixture.content), false);
  assert.equal(await clickButton(session, 'reveal fragments'), true, 'Could not reveal the sealed drop.');
  await session.waitFor(() => session.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => button.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'open received drop' && !button.disabled)`), `${fixture.payloadKind} open action`);
  assert.deepEqual(
    session.storageReads.slice(mediaReadStart).filter((request) => request.objectPath === fixture.mediaPath),
    [],
    `${fixture.payloadKind} bytes must not be fetched before the recipient explicitly opens the drop.`,
  );
  assert.equal(await clickButton(session, 'open received drop'), true, 'Could not explicitly open the received drop.');
  await session.waitFor(() => session.evaluate(`document.querySelector('#letter-body')?.innerText.includes(${JSON.stringify(fixture.content)})`), `${fixture.payloadKind} caption after open`);
  const rendered = await session.waitFor(() => session.evaluate(`(() => {
    const image = document.querySelector('#letter-body img');
    if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
      alt: image.getAttribute('alt'), origin: new URL(image.currentSrc || image.src, location.href).origin,
      badge: document.querySelector('#letter-body')?.innerText.toLocaleLowerCase().includes(${JSON.stringify(fixture.payloadKind === 'gif' ? 'gif' : 'photo')}) || false };
  })()`), `${fixture.payloadKind} decoded recipient media`, 20_000);
  assert.equal(rendered.complete, true);
  assert.ok(rendered.width > 0 && rendered.height > 0);
  assert.equal(rendered.alt, fixture.payloadKind === 'gif' ? 'Attached GIF' : 'Attached photo');
  assert.equal(rendered.origin, supabaseUrl.origin);
  assert.equal(rendered.badge, true);
  const openedMediaReads = session.storageReads.slice(mediaReadStart).filter((request) => request.objectPath === fixture.mediaPath);
  assert.equal(openedMediaReads.length, 1, `${fixture.payloadKind} should fetch its exact private object once after opening.`);
  assert.equal(openedMediaReads[0].origin, supabaseUrl.origin);
  const dimensions = await session.evaluate('({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })');
  assert.ok(dimensions.scroll <= dimensions.width + 1, `Recipient ${fixture.payloadKind} detail overflows the 390px viewport.`);

  assert.equal(await clickButton(session, 'react with heart hands'), true, 'Could not submit the heart-hands reaction.');
  await session.waitFor(() => session.evaluate(`document.body.innerText.includes('Reaction sent.')`), `${fixture.payloadKind} reaction confirmation`);
  const { data: reactions, error } = await admin.from('letter_reactions').select('letter_id,recipient_id,emoji').eq('letter_id', fixture.letterId);
  assert.ifError(error);
  assert.deepEqual(reactions, [{ letter_id: fixture.letterId, recipient_id: recipient.id, emoji: '🫶' }]);
  console.log(`[browser-instant-media-e2e] PASS recipient opened decoded ${fixture.payloadKind} from Inbox and reacted.`);
}

async function assertOutsiderCannotRead(fixture) {
  const { data: userData, error: authError } = await outsider.client.auth.getUser();
  assert.ifError(authError);
  assert.equal(userData.user?.id, outsider.id, 'The denial check must use the signed-in outsider account.');
  const { data: object, error: downloadError } = await outsider.client.storage.from(BUCKET).download(fixture.mediaPath);
  assert.ok(downloadError && !object, 'A signed-in outsider must not download this exact media object.');
  const { data: signedUrl, error: signError } = await outsider.client.storage.from(BUCKET).createSignedUrl(fixture.mediaPath, 60);
  assert.ok(signError && !signedUrl, 'A signed-in outsider must not create a signed URL for this exact media object.');
  console.log(`[browser-instant-media-e2e] PASS signed-in outsider denied the exact ${fixture.payloadKind} object.`);
}

async function assertStorageObjectMissing(path, message) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`/storage/v1/object/${BUCKET}/${encodedPath}`, supabaseUrl);
  assert.equal(url.origin, supabaseUrl.origin);
  const key = localValues.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (response.ok) { await response.body?.cancel(); assert.fail(message); }
  let payload;
  try { payload = await response.json(); } catch { await response.body?.cancel().catch(() => undefined); }
  assert.ok(response.status === 404 || (response.status === 400 && payload?.statusCode === '404' && payload?.error === 'not_found' && payload?.code === 'NoSuchKey'), 'Storage must confirm a missing staged object.');
}

async function collectStorageObjectsBelow(prefix, ownerId, depth = 0) {
  if (depth > 12 || (prefix !== ownerId && !isSafeOwnedStorageObjectPath(prefix, ownerId))) throw new Error('Unsafe disposable storage prefix.');
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) throw error;
    const objects = data || [];
    for (const object of objects) {
      if (!SAFE_SEGMENT.test(object.name || '')) throw new Error('Unsafe Storage entry under disposable sender prefix.');
      const path = `${prefix}/${object.name}`;
      if (!isSafeOwnedStorageObjectPath(path, ownerId)) throw new Error('Storage listing escaped disposable sender prefix.');
      if (object.id === null && object.metadata === null) await collectStorageObjectsBelow(path, ownerId, depth + 1);
      else storagePaths.add(path);
    }
    if (objects.length < 100) return;
    offset += objects.length;
  }
}

async function cleanup() {
  for (const session of sessions) { session.pageCdp?.close(); session.browserCdp?.close(); }
  let processesStopped = true;
  for (const [child, label] of [...sessions.map((session) => [session.browser, `isolated ${session.name} browser`]), [app, 'isolated app']]) {
    if (!child) continue;
    try { await stopOwnedProcess(child, label); }
    catch { cleanupFailed = true; processesStopped = false; console.error(`[browser-instant-media-e2e] CLEANUP FAILED: could not stop this smoke's ${label}.`); }
  }

  if (admin) {
    for (const fixture of fixtures) {
      try {
        const { data: rows, error } = await admin.from('letters').select('id,subject,content')
          .eq('id', fixture.letterId).eq('sender_id', fixture.senderId);
        if (error) throw error;
        if (rows?.length > 1 || (rows?.length === 1 && (rows[0].subject !== fixture.subject || rows[0].content !== fixture.content))) throw new Error('Test row marker mismatch.');
        const { error: reactionError } = await admin.from('letter_reactions').delete().eq('letter_id', fixture.letterId).eq('recipient_id', fixture.recipientId);
        if (reactionError) throw reactionError;
        if (rows?.length === 1) {
          const { data: deleted, error: deleteError } = await admin.from('letters').delete().eq('id', fixture.letterId)
            .eq('sender_id', fixture.senderId).eq('subject', fixture.subject).eq('content', fixture.content).select('id');
          if (deleteError || deleted?.length !== 1) throw deleteError || new Error('The exact disposable drop was not deleted.');
        }
        const { data: remains, error: verifyError } = await admin.from('letters').select('id').eq('id', fixture.letterId).eq('sender_id', fixture.senderId);
        if (verifyError || remains?.length) throw verifyError || new Error('Test drop remains.');
      } catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: an exact disposable drop or reaction could not be removed.'); }
    }
    if (sender?.id && createdUserIds.includes(sender.id)) {
      try { await collectStorageObjectsBelow(sender.id, sender.id); }
      catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: could not enumerate the disposable sender Storage prefix.'); }
    }
    if (sessions.some((session) => session.uncleanableStorageWrite)) {
      cleanupFailed = true;
      console.error('[browser-instant-media-e2e] CLEANUP FAILED: a Storage write could not be scoped to the disposable sender.');
    }
    if (outsider?.client) {
      try {
        await outsider.client.auth.signOut();
        const { data, error } = await outsider.client.auth.getSession();
        if (error || data.session) throw new Error('Disposable outsider session remains active.');
      } catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: could not clear the disposable outsider auth session.'); }
    }
    if (storagePaths.size) {
      try {
        const paths = [...storagePaths];
        for (const path of paths) if (!isSafeOwnedStorageObjectPath(path, sender?.id)) throw new Error('Unsafe cleanup path.');
        const { error } = await admin.storage.from(BUCKET).remove(paths);
        if (error) throw error;
        for (const path of paths) await assertStorageObjectMissing(path, 'A disposable media object remains.');
      } catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: disposable media objects remain or could not be verified absent.'); }
    }
    for (const userId of createdUserIds) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        const { data, error: verifyError } = await admin.auth.admin.getUserById(userId);
        if (data.user || (verifyError && verifyError.status !== 404)) throw new Error('Disposable user remains.');
      } catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: a disposable local account remains.'); }
    }
    if (createdUserIds.length) {
      try {
        const { data, error } = await admin.from('profiles').select('id').in('id', createdUserIds);
        if (error || data?.length) throw error || new Error('Disposable profile remains.');
      } catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: a disposable profile remains.'); }
    }
  }
  if (temporaryRoot && processesStopped) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch { cleanupFailed = true; console.error('[browser-instant-media-e2e] CLEANUP FAILED: could not remove temporary app and browser profiles.'); }
  } else if (temporaryRoot) {
    cleanupFailed = true;
    console.error('[browser-instant-media-e2e] CLEANUP FAILED: retained temp files because an owned process may still use them.');
  }
}

async function stopOwnedProcess(child, label) {
  if (!child || await waitForProcessExit(child, 0)) return;
  try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM'); }
  catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not stop ${label}.`); }
  if (await waitForProcessExit(child, 10_000)) return;
  try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if (error?.code !== 'ESRCH') throw new Error(`Could not stop ${label}.`); }
  if (!await waitForProcessExit(child, 5_000)) throw new Error(`${label} did not exit.`);
}

async function waitForProcessExit(child, timeoutMs) {
  const stopped = () => process.platform === 'win32' ? child.exitCode !== null || child.signalCode !== null : !processGroupExists(child.pid);
  const deadline = Date.now() + timeoutMs;
  while (!stopped()) { const remaining = deadline - Date.now(); if (remaining <= 0) return false; await sleep(Math.min(100, remaining)); }
  return true;
}

function processGroupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; if (error?.code === 'EPERM') return true; throw error; }
}

function sleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolveSleep(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason || new Error('Interrupted.')); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function guardSelfTest() {
  assert.equal(TEST_PORT, 6004);
  assert.equal(requireLocalSupabaseUrl('http://127.0.0.1:54321').origin, 'http://127.0.0.1:54321');
  assert.equal(requireLocalSupabaseUrl('http://localhost:54321').hostname, 'localhost');
  for (const value of ['https://127.0.0.1:54321', 'http://example.test:54321', 'http://0.0.0.0:54321', 'http://127.0.0.1:54322', 'http://user:pass@127.0.0.1:54321', 'http://127.0.0.1:54321/path']) assert.throws(() => requireLocalSupabaseUrl(value));
  const owner = 'b8b8d9a1-80a8-48ee-96c0-0f991c450561';
  assert.equal(isSafeOwnedStorageObjectPath(`${owner}/pending/draft/id/attempt`, owner), true);
  assert.equal(isSafeOwnedStorageObjectPath('a8b8d9a1-80a8-48ee-96c0-0f991c450561/pending/a/b/c', owner), false);
  assert.equal(isSafeOwnedStorageObjectPath(`${owner}/pending/../outside`, owner), false);
  assert.equal(browserEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(baseAppEnvironment().SUPABASE_SERVICE_ROLE_KEY, undefined);
  console.log('[browser-instant-media-e2e] PASS loopback-only, owned-storage, and server/browser secret-boundary guards.');
}

async function main() {
  if (process.argv.includes('--guard-self-test')) {
    assert.deepEqual(process.argv.slice(2), ['--guard-self-test']);
    guardSelfTest();
    return;
  }
  assert.deepEqual(process.argv.slice(2), [], 'This smoke accepts only --guard-self-test.');
  await assertPortAvailable(TEST_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local with loopback Supabase URL, anon key, and service-role key first.');
  });
  localValues = parseEnv(envText);
  supabaseUrl = requireLocalSupabaseUrl(localValues.NEXT_PUBLIC_SUPABASE_URL || '');
  assertTrustedLocalSupabaseListener(54321);
  assert.ok(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY && localValues.SUPABASE_SERVICE_ROLE_KEY, '.env.local needs local Supabase anon and service-role keys.');
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Install project dependencies before running this smoke.');
  allowedOrigins.add(supabaseUrl.origin);
  for (const host of LOOPBACK_HOSTS) allowedOrigins.add(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:54321`);
  const health = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, `Local Supabase Auth health returned HTTP ${health.status}.`);
  admin = createClient(supabaseUrl.origin, localValues.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-instant-media-e2e-'));
  await mkdir(join(temporaryRoot, 'home'), { recursive: true });
  try {
    currentStep = 'starting the isolated production app';
    await startTemporaryApp();
    currentStep = 'creating disposable local accounts';
    sender = await createAccount('sender');
    recipient = await createAccount('recipient');
    outsider = await createAccount('outsider');
    outsider.client = createClient(supabaseUrl.origin, localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: outsiderAuth, error: outsiderSignInError } = await outsider.client.auth.signInWithPassword({ email: outsider.email, password: outsider.password });
    if (outsiderSignInError || outsiderAuth.user?.id !== outsider.id || !outsiderAuth.session?.access_token) throw new Error('Could not authenticate the disposable outsider.');
    const senderSession = new BrowserSession('sender');
    const recipientSession = new BrowserSession('recipient');
    sessions.push(senderSession, recipientSession);
    currentStep = 'starting isolated browser sessions';
    await Promise.all([senderSession.launch(), recipientSession.launch()]);
    currentStep = 'authenticating the sender through local magic link';
    await signIn(senderSession, sender);
    await signIn(recipientSession, recipient);
    currentStep = 'sending Instant photo and GIF drops through Compose';
    const photo = await sendMediaThroughCompose(senderSession, 'image');
    await assertOutsiderCannotRead(photo);
    const gif = await sendMediaThroughCompose(senderSession, 'gif');
    await assertOutsiderCannotRead(gif);
    currentStep = 'opening and reacting to both media drops from recipient Inbox';
    await openAndReact(recipientSession, photo);
    await openAndReact(recipientSession, gif);
    currentStep = 'checking sender reaction feedback after reload';
    await senderSession.navigate(`${APP_ORIGIN}/mailbox`);
    for (const fixture of [photo, gif]) {
      await senderSession.waitFor(() => senderSession.evaluate(`document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(fixture.subject.toLocaleLowerCase())})
        && document.body.innerText.toLocaleLowerCase().includes('they reacted 🫶')`), `sender feedback for ${fixture.payloadKind} reaction`);
    }
    await senderSession.pageCdp.send('Page.reload');
    for (const fixture of [photo, gif]) {
      await senderSession.waitFor(() => senderSession.evaluate(`document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(fixture.subject.toLocaleLowerCase())})
        && document.body.innerText.toLocaleLowerCase().includes('they reacted 🫶')`), `persisted sender feedback for ${fixture.payloadKind}`);
    }
    for (const session of sessions) {
      assert.deepEqual([...session.externalOrigins], [], `${session.name} attempted cross-origin network access.`);
      assert.deepEqual(session.failedLocalRequests, [], `${session.name} had a failed local request.`);
      assert.equal(session.consoleErrors, 0, `${session.name} recorded a browser console error.`);
      assert.equal(session.runtimeExceptions, 0, `${session.name} recorded a browser exception.`);
    }
    console.log('[browser-instant-media-e2e] PASS both sender and recipient stayed on local origins without browser errors.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The browser smoke finished with cleanup failures; see the messages above.');
}

const onSignal = (signal) => active.abort(new Error(`Received ${signal}; cleaning up this local smoke.`));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  if (!process.argv.includes('--guard-self-test')) {
    console.log('[browser-instant-media-e2e] PASS exact disposable cleanup completed; main port 4004 and hosted Supabase were untouched.');
  }
}).catch((error) => {
  active.abort(error);
  console.error(`[browser-instant-media-e2e] FAIL during ${currentStep}: ${error?.message || 'unexpected failure'}`);
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
