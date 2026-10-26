#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertTrustedLocalSupabaseListener } from './localSupabaseListener.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_PORT = 6004;
const APP_ORIGIN = 'http://127.0.0.1:' + TEST_PORT;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const HOST_RESOLVER_RULES = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1';
const BUILD_TIMEOUT_MS = 180_000;
const APP_TIMEOUT_MS = 60_000;
const BROWSER_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 30_000;
const TEST_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SYNTHETIC_SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-drop-push-' + randomUUID(),
  expirationTime: null,
  keys: { p256dh: base64Url(Buffer.concat([Buffer.from([4]), randomBytes(64)])), auth: base64Url(randomBytes(16)) },
};
const active = new AbortController();
const allowedOrigins = new Set([APP_ORIGIN]);
const sessions = [];
const createdUserIds = [];
const children = [];

let localValues = {};
let supabaseUrl;
let admin;
let app;
let temporaryRoot;
let temporaryProject;
let currentStep = 'initializing';
let cleanupFailed = false;

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
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
        if (message.error) pending.reject(new Error(pending.method + ': ' + (message.error.message || 'DevTools command failed')));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {}, message.sessionId);
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('DevTools closed during ' + pending.method + '.'));
        this.pending.delete(id);
      }
    });
    socket.addEventListener('error', () => {});
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to isolated browser DevTools.')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to isolated browser DevTools.')); }, { once: true });
    });
    return new CdpConnection(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeoutMs = 10_000, sessionId) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('DevTools closed before ' + method + '.'));
    const id = ++this.nextId;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out waiting for DevTools ' + method + '.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer, method });
      try {
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}

class BrowserSession {
  constructor(name, mode, account) {
    this.name = name;
    this.mode = mode;
    this.account = account;
    this.profile = join(temporaryRoot, 'browser-' + name);
    this.browser = null;
    this.browserCdp = null;
    this.pageCdp = null;
    this.spawnError = null;
    this.externalOrigins = new Set();
    this.failedLocalRequests = [];
    this.consoleErrors = [];
    this.runtimeExceptions = [];
    this.actions = [];
    this.pendingPausedRequests = new Set();
    this.workerRegistrations = [];
    this.workerRegistrationWaiters = [];
    this.workerTargetSessionId = null;
  }

  async launch() {
    if (typeof WebSocket !== 'function') throw new Error('This smoke needs Node’s built-in WebSocket API.');
    const executable = findBrowserExecutable();
    this.browser = spawn(executable, [
      '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + this.profile,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
      '--disable-features=MediaRouter', '--no-proxy-server', '--host-resolver-rules=' + HOST_RESOLVER_RULES, 'about:blank',
    ], { env: browserEnvironment(), stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
    children.push(this.browser);
    this.browser.on('error', (error) => { this.spawnError = error; });
    const devTools = await this.waitForDevTools();
    this.browserCdp = await CdpConnection.connect('ws://127.0.0.1:' + devTools.port + devTools.path);
    const target = await requestJson('http://127.0.0.1:' + devTools.port + '/json/new?about:blank', { method: 'PUT' });
    this.pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl);
    await this.pageCdp.send('Page.enable');
    await this.pageCdp.send('Runtime.enable');
    await this.pageCdp.send('Network.enable');
    await this.pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.pageCdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    this.pageCdp.on('Fetch.requestPaused', (params) => {
      void this.handlePausedRequest(params).catch((error) => active.abort(error));
    });
    this.pageCdp.on('Network.requestWillBeSent', ({ request }) => {
      let url;
      try { url = new URL(request.url); } catch { return; }
      if (/^https?:$/.test(url.protocol) && !allowedOrigins.has(url.origin)) this.externalOrigins.add(url.origin);
    });
    this.pageCdp.on('Network.webSocketCreated', ({ url }) => {
      try {
        const parsed = new URL(url);
        const origin = (parsed.protocol === 'wss:' ? 'https:' : 'http:') + '//' + parsed.host;
        if (!['ws:', 'wss:'].includes(parsed.protocol) || !allowedOrigins.has(origin)) this.externalOrigins.add(origin);
      } catch { this.externalOrigins.add('invalid-websocket-origin'); }
    });
    this.pageCdp.on('Network.loadingFailed', ({ errorText }) => {
      if (errorText !== 'net::ERR_ABORTED') this.failedLocalRequests.push(errorText);
    });
    this.pageCdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      this.runtimeExceptions.push(exceptionDetails?.text || 'Browser exception');
    });
    this.pageCdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') this.consoleErrors.push(args?.map((arg) => arg.value || arg.description || '').join(' ').slice(0, 300));
    });
    this.pageCdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      this.workerRegistrations = registrations || [];
      for (const resolveRegistration of this.workerRegistrationWaiters.splice(0)) resolveRegistration();
    });
    await this.pageCdp.send('ServiceWorker.enable');
    await this.browserCdp.send('Target.setDiscoverTargets', { discover: true });
    if (this.mode !== 'unsupported') {
      await this.browserCdp.send('Browser.grantPermissions', { origin: APP_ORIGIN, permissions: ['notifications'] });
    }
    await this.pageCdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildBrowserApiShim(this.mode) });
  }

  async handlePausedRequest({ requestId, request }) {
    let url;
    try { url = new URL(request.url); } catch { /* Non-HTTP requests are blocked below. */ }
    if (!url || !allowedOrigins.has(url.origin)) {
      if (url) this.externalOrigins.add(url.origin);
      await this.pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }
    if (url.origin === supabaseUrl.origin && url.pathname.startsWith('/functions/v1/')) {
      if (url.pathname !== '/functions/v1/manage-drop-push-subscription'
        || !['OPTIONS', 'POST'].includes(request.method)) {
        await this.pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        this.failedLocalRequests.push('Unexpected Edge Function request was blocked.');
        return;
      }
      const origin = headerValue(request.headers, 'origin');
      if (origin && origin !== APP_ORIGIN) {
        await this.pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        this.failedLocalRequests.push('Unexpected Edge Function origin was blocked.');
        return;
      }
      if (request.method === 'POST') {
        let body = null;
        try { body = JSON.parse(request.postData || 'null'); } catch { /* Record only the action name. */ }
        const action = ['status', 'enable', 'disable'].includes(body?.action) ? body.action : 'invalid';
        const endpoint = typeof body?.endpoint === 'string'
          ? body.endpoint
          : typeof body?.subscription?.endpoint === 'string' ? body.subscription.endpoint : null;
        this.actions.push({
          action,
          hasEndpoint: Boolean(endpoint),
          hasPushKeys: Boolean(body?.subscription?.keys?.p256dh && body?.subscription?.keys?.auth),
        });
        if (action === 'invalid') {
          await this.pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
          this.failedLocalRequests.push('Unexpected manager action was blocked.');
          return;
        }
      }
      await this.pageCdp.send('Fetch.continueRequest', { requestId });
      return;
    }
    await this.pageCdp.send('Fetch.continueRequest', { requestId });
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
      } catch { /* Browser has not published its DevTools port yet. */ }
      await sleep(100);
    }
    throw new Error('Isolated browser DevTools did not start in time.');
  }

  async evaluate(expression, userGesture = true) {
    const result = await this.pageCdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    }, STEP_TIMEOUT_MS);
    if (result.exceptionDetails) throw new Error('Browser assertion raised an exception.');
    return result.result?.value;
  }

  async navigate(url) {
    const target = new URL(url);
    assert.ok(allowedOrigins.has(target.origin), 'Browser navigation must stay on the isolated app or local Supabase.');
    await this.pageCdp.send('Page.navigate', { url }, STEP_TIMEOUT_MS);
  }

  async waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
      try {
        const value = await predicate();
        if (value) return value;
      } catch { /* A route transition can briefly make selectors unavailable. */ }
      await sleep(200);
    }
    throw new Error('Timed out waiting for ' + description + '.');
  }

  async getNotifications(tag) {
    return this.evaluate('(async () => { const registration = await navigator.serviceWorker.getRegistration("/"); if (!registration) return []; const notifications = await registration.getNotifications('
      + (tag ? '{ tag: ' + JSON.stringify(tag) + ' }' : '') + '); return notifications.map((item) => ({ title: item.title, body: item.body, tag: item.tag, data: item.data })); })()');
  }

  async registrationId() {
    await this.waitFor(() => this.workerRegistrations.some((item) => item.scopeURL === APP_ORIGIN + '/'), 'Drop service worker registration');
    const registration = this.workerRegistrations.find((item) => item.scopeURL === APP_ORIGIN + '/');
    assert.ok(registration?.registrationId, 'The service worker registration ID was missing.');
    return registration.registrationId;
  }

  async deliverPush(payload) {
    await this.waitFor(() => this.evaluate('(async () => { const registration = await navigator.serviceWorker.ready; return Boolean(registration.active && registration.active.state === "activated"); })()'), 'activated Drop service worker');
    const registrationId = await this.registrationId();
    await this.pageCdp.send('ServiceWorker.deliverPushMessage', {
      origin: APP_ORIGIN,
      registrationId,
      data: JSON.stringify(payload),
    }, STEP_TIMEOUT_MS);
  }

  async assertNoBrowserErrors() {
    assert.deepEqual([...this.externalOrigins], [], this.name + ' attempted a non-local network request.');
    assert.deepEqual(this.failedLocalRequests, [], this.name + ' had a failed local browser request.');
    assert.deepEqual(this.runtimeExceptions, [], this.name + ' recorded a browser exception.');
    assert.deepEqual(this.consoleErrors, [], this.name + ' recorded a browser console error.');
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
  assert.ok(LOOPBACK_HOSTS.has(host), 'This browser smoke only accepts local Supabase loopback addresses.');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.port || '80', '54321');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
  return url;
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

function findBrowserExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')]
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('Local DevTools returned HTTP ' + response.status + '.');
  return response.json();
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function buildBrowserApiShim(mode) {
  return [
    '(() => {',
    '  const storageKey = "__drop_push_browser_smoke_state";',
    '  let saved = null;',
    '  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch {}',
    '  const state = { mode: ' + JSON.stringify(mode) + ', permission: saved?.permission || "default", nextPermission: "granted", permissionRequests: saved?.permissionRequests || 0, subscribeCalls: saved?.subscribeCalls || 0, unsubscribeCalls: saved?.unsubscribeCalls || 0, subscription: null };',
    '  Object.defineProperty(window, "__dropPushHarness", { configurable: false, enumerable: false, value: state });',
    '  if (state.mode === "unsupported") { Object.defineProperty(window, "isSecureContext", { configurable: true, value: false }); Object.defineProperty(window, "Notification", { configurable: true, value: undefined }); return; }',
    '  const persist = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ permission: state.permission, permissionRequests: state.permissionRequests, subscribeCalls: state.subscribeCalls, unsubscribeCalls: state.unsubscribeCalls, subscribed: Boolean(state.subscription) })); } catch {} };',
    '  const TestNotification = function TestNotification() {};',
    '  Object.defineProperty(TestNotification, "permission", { get: () => state.permission });',
    '  TestNotification.requestPermission = async () => { state.permissionRequests += 1; state.permission = state.nextPermission; persist(); return state.permission; };',
    '  Object.defineProperty(window, "Notification", { configurable: true, value: TestNotification });',
    '  const prototype = window.PushManager && window.PushManager.prototype;',
    '  if (!prototype) return;',
    '  const subscriptionData = ' + JSON.stringify(SYNTHETIC_SUBSCRIPTION) + ';',
    '  const makeSubscription = () => ({ endpoint: subscriptionData.endpoint, expirationTime: null, toJSON: () => subscriptionData, getKey: (name) => { const encoded = subscriptionData.keys[name]; if (!encoded) return null; const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer; }, unsubscribe: async () => { state.unsubscribeCalls += 1; state.subscription = null; persist(); return true; } });',
    '  if (saved ? saved.subscribed : state.mode === "existing") state.subscription = makeSubscription();',
    '  persist();',
    '  Object.defineProperty(prototype, "getSubscription", { configurable: true, value: async () => state.subscription });',
    '  Object.defineProperty(prototype, "subscribe", { configurable: true, value: async () => { state.subscribeCalls += 1; if (state.permission !== "granted") throw new Error("Synthetic push permission is not granted."); state.subscription = makeSubscription(); persist(); return state.subscription; } });',
    '})();',
  ].join('\n');
}

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolveListen));
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new Error('Port ' + port + ' is already owned; this smoke left it untouched.');
    throw error;
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
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

function isolatedBaseEnvironment(vapidKey) {
  return {
    ...browserEnvironment(),
    NEXT_PUBLIC_SUPABASE_URL: localValues.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: vapidKey,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  };
}

async function startTemporaryApp(vapidKey) {
  const projectRoot = await makeIsolatedProject();
  const nextCli = resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next');
  const fontMockPath = join(temporaryRoot, 'mock-google-fonts.cjs');
  const fontFace = (family) => '@font-face {\n  font-family: ' + JSON.stringify(family) + ';\n  src: local(Arial);\n}';
  const fontResponses = {
    'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': fontFace('Inter'),
    'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap': fontFace('Playfair Display'),
    'https://fonts.googleapis.com/css2?family=Literata:wght@400;500;600&display=swap': fontFace('Literata'),
    'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap': fontFace('Courier Prime'),
  };
  await writeFile(fontMockPath, 'module.exports = ' + JSON.stringify(fontResponses) + ';\n', { flag: 'wx' });
  const appEnvironment = isolatedBaseEnvironment(vapidKey);
  const buildEnvironment = { ...appEnvironment, NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMockPath };
  const build = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: projectRoot,
    env: buildEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.push(build);
  app = build;
  let output = '';
  const retain = (chunk) => { output = (output + chunk.toString('utf8')).slice(-6_000); };
  build.stdout?.on('data', retain);
  build.stderr?.on('data', retain);
  let spawnError = null;
  build.on('error', (error) => { spawnError = error; });
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline && !spawnError && build.exitCode === null) await sleep(250);
  if (spawnError || build.exitCode !== 0) {
    const reason = spawnError ? 'could not start' : build.exitCode === null ? 'timed out' : 'exited with code ' + build.exitCode;
    const safeOutput = output
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_URL, '[loopback Supabase URL]')
      .replaceAll(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY, '[redacted anon key]')
      .replaceAll(localValues.SUPABASE_SERVICE_ROLE_KEY, '[redacted service-role key]')
      .trim();
    try { await stopOwnedProcess(build, 'isolated local build'); } catch { /* Cleanup emits its own diagnostic. */ }
    app = null;
    throw new Error('The isolated local build ' + reason + '.' + (safeOutput ? ' Build output: ' + safeOutput : ''));
  }
  await stopOwnedProcess(build, 'isolated local build');
  app = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(TEST_PORT)], {
    cwd: projectRoot,
    env: { ...buildEnvironment, SUPABASE_SERVICE_ROLE_KEY: localValues.SUPABASE_SERVICE_ROLE_KEY },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: process.platform !== 'win32',
  });
  children.push(app);
  let serverError = null;
  app.on('error', (error) => { serverError = error; });
  for (let attempt = 0; attempt < APP_TIMEOUT_MS / 500; attempt += 1) {
    if (serverError || app.exitCode !== null) throw new Error('The isolated local app failed to start.');
    try {
      const response = await fetch(APP_ORIGIN + '/profile', { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* The isolated app is still starting. */ }
    await sleep(500);
  }
  throw new Error('The isolated local app did not become ready on port 6004.');
}

async function createAccount(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = 'drop-push-' + label + '-' + suffix + '@example.test';
  const password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error('Could not create the disposable local ' + label + ' account.');
  const id = data.user.id;
  createdUserIds.push(id);
  const account = {
    id,
    email,
    username: 'dp_' + label.slice(0, 4) + '_' + suffix.slice(0, 5),
    displayName: 'Push ' + label,
  };
  const { error: profileError } = await admin.from('profiles').insert({
    id,
    username: account.username,
    display_name: account.displayName,
    bio: '',
  });
  if (profileError) throw new Error('Could not create the disposable local ' + label + ' profile.');
  return { ...account, password };
}

async function signIn(session, account) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
    options: { redirectTo: APP_ORIGIN + '/auth/callback' },
  });
  if (error || !data.properties?.action_link) throw new Error('Could not sign in the disposable local account.');
  const actionLink = new URL(data.properties.action_link);
  assert.equal(actionLink.protocol, 'http:');
  assert.equal(actionLink.port, '54321');
  assert.ok(LOOPBACK_HOSTS.has(actionLink.hostname.replace(/^\[|\]$/g, '').toLowerCase()));
  await session.navigate(data.properties.action_link);
  await session.waitFor(() => session.evaluate('location.origin === ' + JSON.stringify(APP_ORIGIN)
    + ' && location.pathname === "/profile" && document.body.innerText.includes('
    + JSON.stringify('Connected as ' + account.email + '.') + ')'), 'local magic-link sign-in');
}

async function clickButton(session, accessibleName) {
  return session.evaluate('(() => { const expected = ' + JSON.stringify(accessibleName)
    + '; const button = Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === expected || item.innerText.replace(/\\s+/g, " ").trim().toLowerCase() === expected.toLowerCase()); if (!button || button.disabled) return false; button.click(); return true; })()');
}

async function profileState(session) {
  return session.evaluate('(() => ({ heading: Array.from(document.querySelectorAll("h1,h2,h3")).some((item) => item.innerText.trim() === "New-drop alerts"), enable: Array.from(document.querySelectorAll("button")).some((item) => item.getAttribute("aria-label") === "Turn on new-drop alerts" || item.innerText.replace(/\\s+/g, " ").trim().toLowerCase() === "turn on new-drop alerts"), disable: Array.from(document.querySelectorAll("button")).some((item) => item.getAttribute("aria-label") === "Turn off alerts" || item.innerText.replace(/\\s+/g, " ").trim().toLowerCase() === "turn off alerts"), status: Array.from(document.querySelectorAll(\'[role="status"]\')).map((item) => item.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean).join(" ") }))()');
}

async function setPermissionOutcome(session, outcome) {
  const updated = await session.evaluate('(() => { const state = window.__dropPushHarness; if (!state) return false; state.nextPermission = ' + JSON.stringify(outcome) + '; return true; })()');
  assert.equal(updated, true, session.name + ' browser permission test shim is missing.');
}

async function pushHarnessState(session) {
  return session.evaluate('(() => { const state = window.__dropPushHarness; return state ? { permission: state.permission, permissionRequests: state.permissionRequests, subscribeCalls: state.subscribeCalls, unsubscribeCalls: state.unsubscribeCalls, subscribed: Boolean(state.subscription) } : null; })()');
}

async function verifyProfileReady(session, expectedButton) {
  try {
    await session.waitFor(async () => {
      const state = await profileState(session);
      return state.heading && (expectedButton === 'enable' ? state.enable : expectedButton === 'disable' ? state.disable : true);
    }, 'New-drop alerts profile control');
  } catch (error) {
    const rendered = await session.evaluate('(() => ({ path: location.pathname, headings: Array.from(document.querySelectorAll("h1,h2,h3")).map((item) => item.innerText.trim()), buttons: Array.from(document.querySelectorAll("button")).map((item) => item.innerText.replace(/\\s+/g, " ").trim()), status: Array.from(document.querySelectorAll("[role=status]")).map((item) => item.innerText.replace(/\\s+/g, " ").trim()), secureContext: window.isSecureContext, notificationApi: "Notification" in window, pushManagerApi: "PushManager" in window, serviceWorkerApi: "serviceWorker" in navigator }))()');
    throw new Error((error?.message || 'Profile control wait failed.') + ' Rendered state: ' + JSON.stringify(rendered));
  }
}

async function verifyDefaultOffAndEnable(recipientA) {
  await recipientA.navigate(APP_ORIGIN + '/profile');
  await verifyProfileReady(recipientA, 'enable');
  const initial = await profileState(recipientA);
  assert.equal(initial.disable, false, 'New-drop alerts must be off for a new account.');
  assert.equal((await pushHarnessState(recipientA)).permissionRequests, 0, 'The app requested notification permission before the user tapped.');
  assert.deepEqual(recipientA.actions.filter((item) => item.action === 'enable'), [], 'The app enabled alerts before the user tapped.');
  console.log('[browser-drop-push-smoke] PASS new account starts opted out and does not prompt on page load.');

  await setPermissionOutcome(recipientA, 'granted');
  assert.equal(await clickButton(recipientA, 'Turn on new-drop alerts'), true, 'Could not activate the explicit opt-in button.');
  await recipientA.waitFor(async () => {
    const state = await profileState(recipientA);
    const browser = await pushHarnessState(recipientA);
    return state.disable && browser?.permission === 'granted' && recipientA.actions.some((item) => item.action === 'enable');
  }, 'explicit opt-in to enable new-drop alerts');
  const afterEnable = await pushHarnessState(recipientA);
  assert.equal(afterEnable.permissionRequests, 1, 'Permission should be requested once, on the explicit tap.');
  assert.equal(afterEnable.subscribeCalls, 1, 'PushManager.subscribe should run after permission is granted.');
  assert.ok(recipientA.actions.some((item) => item.action === 'enable' && item.hasEndpoint && item.hasPushKeys), 'The signed-in account did not submit its browser push subscription.');
  console.log('[browser-drop-push-smoke] PASS explicit opt-in requests permission, subscribes, and enables only the signed-in account.');
}

async function verifyAccountIsolation(recipientA, recipientB) {
  await recipientB.navigate(APP_ORIGIN + '/profile');
  await verifyProfileReady(recipientB, 'enable');
  assert.equal((await pushHarnessState(recipientB)).permissionRequests, 0, 'The second account must not inherit an opt-in prompt.');
  assert.equal((await profileState(recipientB)).disable, false, 'A second account inherited another account’s enabled status.');
  assert.deepEqual(recipientB.actions.filter((item) => item.action === 'enable'), [], 'The second account was enabled before its own explicit tap.');
  assert.ok(recipientB.actions.some((item) => item.action === 'status'), 'The second account must resolve its own status for the shared device endpoint.');

  await setPermissionOutcome(recipientB, 'granted');
  assert.equal(await clickButton(recipientB, 'Turn on new-drop alerts'), true, 'Could not enable alerts for the second account.');
  await recipientB.waitFor(async () => (await profileState(recipientB)).disable
    && recipientB.actions.some((item) => item.action === 'enable'), 'second account alert opt-in');
  await recipientA.navigate(APP_ORIGIN + '/profile');
  await verifyProfileReady(recipientA, 'enable');
  assert.equal((await profileState(recipientA)).disable, false, 'The shared browser endpoint remained enabled for the previous account.');
  assert.equal((await profileState(recipientB)).disable, true);
  console.log('[browser-drop-push-smoke] PASS real local manager function reassigns the shared endpoint and leaves the first account disabled.');
}

async function verifyDeniedState(deniedSession) {
  await deniedSession.navigate(APP_ORIGIN + '/profile');
  await verifyProfileReady(deniedSession, 'enable');
  await setPermissionOutcome(deniedSession, 'denied');
  assert.equal(await clickButton(deniedSession, 'Turn on new-drop alerts'), true, 'Could not test the user-denied permission response.');
  await deniedSession.waitFor(async () => {
    const state = await profileState(deniedSession);
    return state.status.includes('Alerts are blocked in browser settings.')
      && !(await pushHarnessState(deniedSession)).subscribeCalls;
  }, 'denied permission fallback');
  assert.equal((await pushHarnessState(deniedSession)).permissionRequests, 1);
  assert.deepEqual(deniedSession.actions.filter((item) => item.action === 'enable'), [], 'The denied browser state must not create a server subscription.');
  assert.equal((await profileState(deniedSession)).enable, false, 'The enable control should disappear once permission is denied.');
  console.log('[browser-drop-push-smoke] PASS denied permission shows a fallback and creates no subscription.');
}

async function verifyUnsupportedState(unsupportedSession) {
  await unsupportedSession.navigate(APP_ORIGIN + '/profile');
  await unsupportedSession.waitFor(async () => {
    const state = await profileState(unsupportedSession);
    return state.heading && state.status.includes('Alerts aren’t available in this browser.');
  }, 'unsupported browser fallback');
  assert.equal((await profileState(unsupportedSession)).enable, false, 'Unsupported browsers must not show an enable control.');
  assert.equal((await pushHarnessState(unsupportedSession)).permissionRequests, 0, 'Unsupported browsers must not request permission.');
  assert.deepEqual(unsupportedSession.actions.filter((item) => item.action === 'enable'), [], 'Unsupported browsers must not create subscriptions.');
  console.log('[browser-drop-push-smoke] PASS unsupported browser keeps the Inbox fallback and never prompts.');
}

async function verifySyntheticPushAndClick(targetSession, otherSession) {
  const marker = 'DROP_PUSH_PRIVATE_FIXTURE_' + randomUUID();
  const tag = 'drop-arrival-' + TEST_EVENT_ID;
  const testPayload = {
    type: 'drop-arrived',
    tag,
    sender: marker,
    subject: marker,
    caption: marker,
    mediaUrl: 'https://private-media.invalid/' + marker,
    claimToken: marker,
  };
  let first = null;
  let lastDeliveryError = null;
  for (let attempt = 0; attempt < 2 && !first; attempt += 1) {
    try {
      await targetSession.deliverPush(testPayload);
      first = await targetSession.waitFor(async () => {
        const notifications = await targetSession.getNotifications(tag);
        return notifications.length ? notifications : null;
      }, 'synthetic persistent notification', 10_000);
    } catch (error) {
      lastDeliveryError = error;
    }
  }
  if (!first) {
    throw new Error('Synthetic push did not create a persistent notification after one retry: '
      + (lastDeliveryError?.message || 'unknown browser error'));
  }
  assert.equal(first.length, 1, 'One push should create exactly one active notification.');
  assert.deepEqual(first[0], {
    title: 'A Drop is in your Inbox',
    body: 'Open when you’re ready.',
    tag,
    data: { type: 'drop-arrived' },
  }, 'The notification must have generic text, a unique dedupe tag, and no account or drop content in data.');
  assert.equal(JSON.stringify(first[0]).includes(marker), false, 'Private sender/drop fixture data leaked into the notification.');

  await targetSession.deliverPush(testPayload);
  const afterRepeat = await targetSession.waitFor(async () => {
    const notifications = await targetSession.getNotifications(tag);
    return notifications.length === 1 ? notifications : null;
  }, 'same-tag notification replacement');
  assert.deepEqual(afterRepeat, first, 'Repeated push for the same tag should not duplicate notification content.');
  assert.deepEqual(await otherSession.getNotifications(tag), [], 'A push delivered to one account’s worker appeared for another account.');
  console.log('[browser-drop-push-smoke] PASS synthetic push displays only generic data, replaces same-tag notices, and stays in the target browser.');

  await verifyServiceWorkerHandlers();
}

async function verifyServiceWorkerHandlers() {
  const source = await readFile(join(PROJECT_ROOT, 'public/service-worker.js'), 'utf8');
  const listeners = new Map();
  const shownNotifications = [];
  const navigationCalls = [];
  let closedNotifications = 0;
  let focusedMailbox = 0;
  let externalNavigationCalls = 0;
  let openedWindow = null;
  let clientSearches = 0;
  const mailboxClient = { focus: async () => { focusedMailbox += 1; } };
  const sameOriginClient = {
    url: APP_ORIGIN + '/',
    navigate: async (url) => { navigationCalls.push(url); return mailboxClient; },
  };
  const externalClient = {
    url: 'https://external.invalid/',
    navigate: async () => { externalNavigationCalls += 1; },
  };
  const self = {
    location: { origin: APP_ORIGIN },
    registration: {
      showNotification: async (title, options) => { shownNotifications.push({ title, options }); },
    },
    clients: {
      matchAll: async () => { clientSearches += 1; return [externalClient, sameOriginClient]; },
      openWindow: async (url) => { openedWindow = url; return mailboxClient; },
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  runInNewContext(source, { self, URL, Set });

  const marker = 'DROP_PUSH_PRIVATE_VM_' + randomUUID();
  const tag = 'drop-arrival-' + TEST_EVENT_ID;
  let validPushWait = null;
  listeners.get('push')({
    data: { json: () => ({ type: 'drop-arrived', tag, sender: marker, caption: marker, claimToken: marker }) },
    waitUntil: (promise) => { validPushWait = Promise.resolve(promise); },
  });
  await validPushWait;
  assert.deepEqual(JSON.parse(JSON.stringify(shownNotifications[0])), {
    title: 'A Drop is in your Inbox',
    options: { body: 'Open when you’re ready.', tag, renotify: false, data: { type: 'drop-arrived' } },
  }, 'The source service worker must reduce push content to fixed generic notification data.');
  assert.equal(JSON.stringify(shownNotifications).includes(marker), false, 'The source service worker passed private fixture data into notification output.');

  let invalidPushWaited = false;
  listeners.get('push')({
    data: { json: () => ({ type: 'drop-arrived', tag: 'drop-arrival-invalid', sender: marker }) },
    waitUntil: () => { invalidPushWaited = true; },
  });
  listeners.get('push')({
    data: { json: () => ({ type: 'private-letter', tag, sender: marker }) },
    waitUntil: () => { invalidPushWaited = true; },
  });
  assert.equal(shownNotifications.length, 1, 'Malformed or unrelated push data must be ignored.');
  assert.equal(invalidPushWaited, false, 'Invalid pushes must not start notification work.');

  listeners.get('notificationclick')({
    notification: { tag: 'drop-arrival-invalid', data: { type: 'drop-arrived' }, close: () => { closedNotifications += 1; } },
    waitUntil: () => { throw new Error('Invalid click should not wait on navigation.'); },
  });
  assert.equal(closedNotifications, 0, 'Invalid notification tags must not be acted on.');
  assert.equal(clientSearches, 0, 'Invalid notification tags must not inspect app clients.');

  let clickWait = null;
  listeners.get('notificationclick')({
    notification: { tag, data: { type: 'drop-arrived' }, close: () => { closedNotifications += 1; } },
    waitUntil: (promise) => { clickWait = Promise.resolve(promise); },
  });
  await clickWait;
  assert.equal(closedNotifications, 1, 'A valid notification should close after click.');
  assert.deepEqual(navigationCalls, [APP_ORIGIN + '/mailbox'], 'A valid notification should navigate only to the fixed same-origin Inbox.');
  assert.equal(focusedMailbox, 1, 'The mailbox client should be focused after navigation.');
  assert.equal(externalNavigationCalls, 0, 'The worker attempted navigation through an external client.');
  assert.equal(openedWindow, null, 'The worker should reuse an existing same-origin client when present.');
  console.log('[browser-drop-push-smoke] PASS source-level service-worker checks accept only generic drop pushes, close valid notices, and navigate/focus same-origin /mailbox; OS notification tapping remains unverified.');
}

async function disableAlerts(session) {
  if (!session?.pageCdp || session.pageCdp.closed) return;
  try {
    await session.navigate(APP_ORIGIN + '/profile');
    const ready = await session.waitFor(async () => (await profileState(session)).disable, 'enabled alert control for cleanup', 5_000).catch(() => false);
    if (ready) {
      await clickButton(session, 'Turn off alerts');
      await session.waitFor(async () => (await profileState(session)).enable, 'disabled alert state during cleanup', 5_000).catch(() => null);
    }
  } catch { /* User deletion below is the final local fixture cleanup boundary. */ }
}

async function cleanup() {
  for (const session of sessions) {
    if (session.mode !== 'unsupported') await disableAlerts(session);
  }
  for (const session of sessions) {
    session.pageCdp?.close();
    session.browserCdp?.close();
  }

  let processesStopped = true;
  for (const child of [...children].reverse()) {
    try { await stopOwnedProcess(child); }
    catch {
      cleanupFailed = true;
      processesStopped = false;
      console.error('[browser-drop-push-smoke] CLEANUP FAILED: an isolated build, app, or browser process remains.');
    }
  }

  if (admin) {
    for (const userId of createdUserIds) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        const { data, error: verifyError } = await admin.auth.admin.getUserById(userId);
        if (data.user || (verifyError && verifyError.status !== 404)) throw new Error('User remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-drop-push-smoke] CLEANUP FAILED: a disposable local account remains.');
      }
    }
    if (createdUserIds.length) {
      try {
        const { data, error } = await admin.from('profiles').select('id').in('id', createdUserIds);
        if (error || data?.length) throw error || new Error('Profile remains.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-drop-push-smoke] CLEANUP FAILED: a disposable local profile remains.');
      }
      try {
        const literals = createdUserIds.map((userId) => {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
            throw new Error('Unexpected disposable account identifier.');
          }
          return "'" + userId + "'::uuid";
        }).join(',');
        const sql = 'SELECT count(*) FROM private.drop_push_subscriptions WHERE user_id IN (' + literals + ')';
        const result = execFileSync('docker', [
          'exec', 'supabase_db_drop', 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c', sql,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 1_024 }).trim();
        if (result !== '0') throw new Error('Disposable subscription rows remain.');
      } catch {
        cleanupFailed = true;
        console.error('[browser-drop-push-smoke] CLEANUP FAILED: could not verify that disposable push subscriptions were removed.');
      }
    }
  }
  if (temporaryRoot && processesStopped) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-drop-push-smoke] CLEANUP FAILED: temporary app/browser profiles remain.');
    }
  } else if (temporaryRoot) {
    cleanupFailed = true;
    console.error('[browser-drop-push-smoke] CLEANUP FAILED: temp files retained because an owned process may still use them.');
  }
}

async function stopOwnedProcess(child) {
  if (!child || await waitForProcessExit(child, 0)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error('Could not stop an isolated test process.');
  }
  if (await waitForProcessExit(child, 10_000)) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error('Could not force-stop an isolated test process.');
  }
  if (!await waitForProcessExit(child, 5_000)) throw new Error('An isolated test process did not exit.');
}

async function waitForProcessExit(child, timeoutMs) {
  const stopped = () => process.platform === 'win32'
    ? child.exitCode !== null || child.signalCode !== null
    : !processGroupExists(child.pid);
  if (stopped()) return true;
  if (timeoutMs <= 0) return false;
  return Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    sleep(timeoutMs).then(() => stopped()),
  ]);
}

function processGroupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; if (error?.code === 'EPERM') return true; throw error; }
}

function sleep(ms) {
  return new Promise((resolveSleep, reject) => {
    const timer = setTimeout(() => { active.signal.removeEventListener('abort', onAbort); resolveSleep(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(active.signal.reason || new Error('Interrupted.')); };
    if (active.signal.aborted) onAbort(); else active.signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function main() {
  assert.deepEqual(process.argv.slice(2), [], 'This smoke accepts no command-line options.');
  await assertPortAvailable(TEST_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local with loopback Supabase URL, anon key, and server-only service-role key first.');
  });
  localValues = parseEnv(envText);
  supabaseUrl = requireLocalSupabaseUrl(localValues.NEXT_PUBLIC_SUPABASE_URL || '');
  assertTrustedLocalSupabaseListener(54321);
  assert.ok(localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY && localValues.SUPABASE_SERVICE_ROLE_KEY, '.env.local needs local Supabase anon and service-role keys.');
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Install project dependencies before running this smoke.');
  allowedOrigins.add(supabaseUrl.origin);
  for (const host of LOOPBACK_HOSTS) {
    const normalized = host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host;
    allowedOrigins.add('http://' + normalized + ':54321');
  }
  const health = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(health.ok, 'Local Supabase Auth is not healthy.');
  admin = createClient(supabaseUrl.origin, localValues.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-push-browser-e2e-'));
  await mkdir(join(temporaryRoot, 'home'), { recursive: true });

  // The test key is syntactically valid but exists only in the isolated app build/runtime.
  const vapidBytes = Buffer.concat([Buffer.from([4]), randomBytes(64)]);
  const vapidKey = base64Url(vapidBytes);
  try {
    currentStep = 'starting the isolated production app';
    await startTemporaryApp(vapidKey);
    currentStep = 'creating disposable local test accounts';
    const recipientAccountA = await createAccount('recipient-a');
    const recipientAccountB = await createAccount('recipient-b');
    const deniedAccount = await createAccount('denied');
    const unsupportedAccount = await createAccount('unsupported');

    const recipientA = new BrowserSession('recipient-a', 'default', recipientAccountA);
    const recipientB = new BrowserSession('recipient-b', 'existing', recipientAccountB);
    const deniedSession = new BrowserSession('denied', 'default', deniedAccount);
    const unsupportedSession = new BrowserSession('unsupported', 'unsupported', unsupportedAccount);
    sessions.push(recipientA, recipientB, deniedSession, unsupportedSession);

    currentStep = 'starting isolated browser profiles';
    for (const session of sessions) await session.launch();
    currentStep = 'authenticating each disposable recipient through local magic links';
    for (const session of sessions) await signIn(session, session.account);

    currentStep = 'verifying default-off and explicit opt-in';
    await verifyDefaultOffAndEnable(recipientA);
    currentStep = 'verifying subscription account isolation';
    await verifyAccountIsolation(recipientA, recipientB);
    currentStep = 'verifying denied and unsupported browser states';
    await verifyDeniedState(deniedSession);
    await verifyUnsupportedState(unsupportedSession);
    currentStep = 'verifying synthetic notification, privacy, deduplication, and click route';
    await verifySyntheticPushAndClick(recipientB, recipientA);

    await recipientB.navigate(APP_ORIGIN + '/profile');
    await verifyProfileReady(recipientB, 'disable');
    assert.equal(await clickButton(recipientB, 'Turn off alerts'), true, 'Could not disable the second account alerts.');
    await recipientB.waitFor(async () => (await profileState(recipientB)).enable, 'second account opt-out');
    assert.ok(recipientB.actions.some((item) => item.action === 'disable' && item.hasEndpoint), 'Disabling alerts did not remove the endpoint from the signed-in account.');
    await recipientA.navigate(APP_ORIGIN + '/profile');
    await verifyProfileReady(recipientA, 'enable');
    assert.equal((await profileState(recipientA)).enable, true, 'Disabling the second account did not leave the previous account opted out.');
    assert.ok(recipientA.actions.some((item) => item.action === 'enable' && item.hasEndpoint && item.hasPushKeys), 'The first account did not reach the real local manager enable action.');
    assert.ok(recipientB.actions.some((item) => item.action === 'enable' && item.hasEndpoint && item.hasPushKeys), 'The second account did not reach the real local manager enable action.');
    assert.ok(recipientB.actions.some((item) => item.action === 'disable' && item.hasEndpoint), 'The second account did not reach the real local manager disable action.');
    for (const session of sessions) await session.assertNoBrowserErrors();
    console.log('[browser-drop-push-smoke] PASS real local manager function/browser flow used only loopback origins with no console/runtime errors.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The browser smoke finished with cleanup failures.');
}

const onSignal = (signal) => active.abort(new Error('Received ' + signal + '; cleaning up this local smoke.'));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  console.log('[browser-drop-push-smoke] PASS exact disposable accounts/profiles and isolated browser/app files cleaned; port 4004 and hosted Supabase were untouched. Synthetic pushes do not verify OS prompts or provider delivery.');
}).catch((error) => {
  active.abort(error);
  console.error('[browser-drop-push-smoke] FAIL during ' + currentStep + ': ' + (error?.message || 'unexpected failure'));
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
