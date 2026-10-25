#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  assertLocalSupabasePortsAreSafe,
  createBrowserSmokeEnvironment,
  loadExpectedLocalSupabaseProjectId,
  loadLocalSupabaseValues,
  validateLocalSupabaseUrl,
} from './localSupabaseEndpointGuard.mjs';

const PROJECT_ROOT = process.cwd();
const TEST_PORT = 5004;
const APP_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const SUBJECT = 'Unread state browser smoke';
const MESSAGE = 'This private message confirms the full delivered drop opened.';
const EMAIL_SUFFIX = '@example.test';
const APP_START_TIMEOUT_MS = 60_000;
const BROWSER_START_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 25_000;
const MOBILE_VIEWPORT = { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const DESKTOP_VIEWPORT = { name: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
let supabaseApiPort;

let admin;
let temporaryRoot;
let app;
let chrome;
let browserCdp;
let pageCdp;
let browserProfile;
let appSpawnError;
let browserSpawnError;
let appStderr = '';
let browserStderr = '';
let temporaryProject;
let createdUsers = [];
let letterId;
let recipientId;
let cleanupFailed = false;
const allowedOrigins = new Set();
const blockedExternalOrigins = new Set();
const observedRpcResponses = [];
const rpcResponsesByRequestId = new Map();
const failedLocalRequests = [];
const browserExceptions = [];
const browserConsoleErrors = [];
const pendingRequests = new Map();
const active = new AbortController();

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
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
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

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already owned; leave its process untouched and retry the unread smoke after it exits.`);
    }
    throw error;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
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
      } catch { /* Try the next browser path. */ }
    } else {
      try {
        return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      } catch { /* Try the next browser executable. */ }
    }
  }
  throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
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

function safeAppEnvironment(localValues) {
  const environment = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || tmpdir(),
    TMPDIR: process.env.TMPDIR || tmpdir(),
    NEXT_PUBLIC_SUPABASE_URL: localValues.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    WATCHPACK_POLLING: 'true',
    NODE_ENV: 'development',
  };
  for (const name of ['LANG', 'LC_ALL', 'TZ', 'NODE_OPTIONS']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

async function startTemporaryApp(localValues) {
  await assertPortAvailable(TEST_PORT);
  const projectRoot = await makeIsolatedProject();
  app = spawn(process.execPath, [
    resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'),
    'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(TEST_PORT),
  ], {
    cwd: projectRoot,
    env: safeAppEnvironment(localValues),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  app.on('error', (error) => { appSpawnError = error; });
  app.stderr.on('data', (chunk) => { appStderr = `${appStderr}${chunk.toString('utf8')}`.slice(-12_000); });

  for (let attempt = 0; attempt < APP_START_TIMEOUT_MS / 500; attempt += 1) {
    if (appSpawnError) throw new Error(`The isolated Next.js app could not start: ${appSpawnError.message}`);
    if (app.exitCode !== null) throw new Error(`The isolated Next.js app exited before becoming ready.${lastLines(appStderr)}`);
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* The dev server is still compiling or binding. */ }
    await sleep(500, active.signal);
  }
  throw new Error(`The isolated Next.js app did not become ready within ${APP_START_TIMEOUT_MS}ms.${lastLines(appStderr)}`);
}

async function createAccount(label, adminClient) {
  const userSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `drop-unread-${label}-${userSuffix}${EMAIL_SUFFIX}`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Local Supabase could not create the disposable ${label} account: ${error.message}`);
  const userId = data.user?.id;
  assert.ok(userId, `Local Supabase returned no ID for the disposable ${label} account.`);
  createdUsers.push(userId);

  const profile = {
    id: userId,
    username: `sm_${label === 'sender' ? 's' : 'r'}_${userSuffix.slice(0, 8)}`,
    display_name: label === 'sender' ? 'Smoke Sender' : 'Smoke Recipient',
    bio: '',
  };
  const { error: profileError } = await adminClient.from('profiles').insert(profile);
  if (profileError) throw new Error(`Local Supabase could not create the disposable ${label} profile: ${profileError.message}`);
  return { id: userId, email, username: profile.username, displayName: profile.display_name };
}

async function createDeliveredDrop(sender, recipient, adminClient) {
  letterId = `unread-browser-${randomUUID()}`;
  const now = new Date().toISOString();
  const { error } = await adminClient.from('letters').insert({
    id: letterId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    sender_display_name: sender.displayName,
    recipient_username: recipient.username,
    recipient_name: recipient.displayName,
    subject: SUBJECT,
    content: MESSAGE,
    teaser: ['A private note is waiting behind the seal.'],
    status: 'delivered',
    seal_id: 'fern',
    dispatched_at: now,
    delivered_at: now,
    payload_kind: 'text',
    delivery_mode: 'instant',
  });
  if (error) throw new Error(`Local Supabase could not create the disposable delivered drop: ${error.message}`);
}

function lastLines(value) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean).slice(-8);
  return lines.length ? `\n${lines.join('\n')}` : '';
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

async function waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200, active.signal);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last check: ${lastError.message}` : ''}`);
}

async function waitForBrowserDevTools(profilePath, browser) {
  const activePortPath = join(profilePath, 'DevToolsActivePort');
  for (let attempt = 0; attempt < BROWSER_START_TIMEOUT_MS / 100; attempt += 1) {
    if (browserSpawnError) throw new Error(`Chrome could not start: ${browserSpawnError.message}`);
    if (browser.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready.${lastLines(browserStderr)}`);
    try {
      const lines = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return { port, browserWebSocketPath: lines[1] };
    } catch { /* Chrome has not written its DevTools port file yet. */ }
    await sleep(100, active.signal);
  }
  throw new Error(`Chrome DevTools did not start within ${BROWSER_START_TIMEOUT_MS}ms.${lastLines(browserStderr)}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status} for ${new URL(url).pathname}.`);
  return response.json();
}

async function startBrowser() {
  if (typeof WebSocket !== 'function') throw new Error('The browser smoke needs Node with the built-in WebSocket API.');
  const chromeExecutable = await findChromeExecutable();
  browserProfile = join(temporaryRoot, 'chrome-profile');
  const resolverRule = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
  chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${browserProfile}`,
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
    env: createBrowserSmokeEnvironment({ temporaryDirectory: temporaryRoot }),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  chrome.on('error', (error) => { browserSpawnError = error; });
  chrome.stderr.on('data', (chunk) => { browserStderr = `${browserStderr}${chunk.toString('utf8')}`.slice(-8_000); });

  const devTools = await waitForBrowserDevTools(browserProfile, chrome);
  const browserWebSocketUrl = `ws://127.0.0.1:${devTools.port}${devTools.browserWebSocketPath}`;
  browserCdp = await CdpConnection.connect(browserWebSocketUrl, active.signal);
  const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
  pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);

  pageCdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    let parsed;
    try { parsed = new URL(request.url); } catch { return; }
    const entry = { origin: parsed.origin, path: parsed.pathname, method: request.method || 'GET' };
    pendingRequests.set(requestId, entry);
    if (/^https?:$/.test(parsed.protocol) && !allowedOrigins.has(parsed.origin)) blockedExternalOrigins.add(parsed.origin);
  });
  pageCdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    browserExceptions.push(exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown browser exception');
  });
  pageCdp.on('Runtime.consoleAPICalled', ({ type, args = [] }) => {
    if (type !== 'error') return;
    browserConsoleErrors.push(args.map((argument) => argument.value ?? argument.description ?? '').filter(Boolean).join(' '));
  });
  pageCdp.on('Network.responseReceived', ({ requestId, response }) => {
    const request = pendingRequests.get(requestId);
    if (!request) return;
    if (request.path === '/rest/v1/rpc/mark_recipient_drop_read'
      || request.path === '/rest/v1/rpc/get_recipient_drop_read_states') {
      const entry = { requestId, path: request.path, status: response.status, body: undefined, bodyError: undefined };
      observedRpcResponses.push(entry);
      rpcResponsesByRequestId.set(requestId, entry);
    }
  });
  pageCdp.on('Network.loadingFinished', ({ requestId }) => {
    const entry = rpcResponsesByRequestId.get(requestId);
    if (!entry) return;
    entry.bodyPromise = pageCdp.send('Network.getResponseBody', { requestId })
      .then((response) => {
        entry.body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
      })
      .catch((error) => { entry.bodyError = error.message; });
  });
  pageCdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const request = pendingRequests.get(requestId);
    if (request && allowedOrigins.has(request.origin) && errorText !== 'net::ERR_ABORTED') {
      failedLocalRequests.push({ path: request.path, errorText });
    }
  });
  pageCdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    let requestOrigin = '';
    try { requestOrigin = new URL(request.url).origin; } catch { /* Non-HTTP URL. */ }
    const allowed = allowedOrigins.has(requestOrigin);
    const decision = allowed
      ? pageCdp.send('Fetch.continueRequest', { requestId })
      : pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    void decision.catch((error) => { active.abort(error); });
  });

  await Promise.all([
    pageCdp.send('Page.enable'),
    pageCdp.send('Runtime.enable'),
    pageCdp.send('Network.enable'),
    pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
  ]);
  await setViewport(pageCdp, MOBILE_VIEWPORT);
}

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, STEP_TIMEOUT_MS);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  }
  return result.result?.value;
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
}

async function signInWithMagicLink(recipient, adminClient) {
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: recipient.email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (error) throw new Error(`Local Supabase could not create the disposable recipient sign-in link: ${error.message}`);
  const actionLink = data.properties?.action_link;
  assert.ok(actionLink, 'Local Supabase returned no sign-in link for the disposable recipient.');
  const link = new URL(actionLink);
  assert.ok(LOOPBACK_HOSTS.has(link.hostname.replace(/^\[|\]$/g, '').toLowerCase())
    || LOOPBACK_HOSTS.has(link.hostname.toLowerCase()), 'The generated sign-in link was not local.');
  assert.equal(link.protocol, 'http:', 'The generated local sign-in link must use HTTP.');
  assert.equal(Number(link.port), supabaseApiPort, 'The generated sign-in link did not use this local Supabase API.');
  await navigate(pageCdp, actionLink);
  await waitFor(async () => evaluate(pageCdp, `location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.body.innerText.includes('Connected as ${recipient.email}.')`), 'the recipient’s local magic-link sign-in');
}

const VISIBLE_NEW_STATE = `(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const card = Array.from(document.querySelectorAll('a')).find((element) => visible(element)
    && element.innerText.includes(${JSON.stringify(SUBJECT)}));
  const cardBadge = Array.from(card?.querySelectorAll('[aria-label="New unread drop"]') || []).find(visible);
  const navBadge = Array.from(document.querySelectorAll('[role="status"][aria-label="1 new drop"]')).find(visible);
  return {
    pathname: location.pathname,
    subjectVisible: Boolean(card && visible(card) && card.innerText.includes(${JSON.stringify(SUBJECT)})),
    cardNew: Boolean(cardBadge),
    navNew: Boolean(navBadge),
    navLabel: navBadge?.getAttribute('aria-label') || null,
  };
})()`;

const HOME_FEATURED_UNREAD_STATE = `(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const card = Array.from(document.querySelectorAll('a[href^="/letter/"]')).find((element) => visible(element)
    && element.innerText.includes(${JSON.stringify(SUBJECT)}));
  const text = card?.innerText.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
  return {
    pathname: location.pathname,
    cardNew: Boolean(card && text.split(/\\s+/).includes('new')),
    cardInbox: Boolean(card && text.includes('in your inbox')),
    accessibleLabel: card?.getAttribute('aria-label') || null,
  };
})()`;

async function waitForMailbox() {
  await waitFor(async () => evaluate(pageCdp, `location.pathname === '/mailbox'
    && document.body.innerText.includes('A mailbox for your people.')
    && document.body.innerText.includes(${JSON.stringify(SUBJECT)})`), 'the delivered drop in the recipient mailbox');
}

async function assertNewVisible(viewport) {
  await setViewport(pageCdp, viewport);
  const state = await waitFor(async () => {
    const current = await evaluate(pageCdp, VISIBLE_NEW_STATE);
    return current?.subjectVisible && current.cardNew && current.navNew ? current : null;
  }, `the New marker at ${viewport.name}`);
  assert.equal(state.pathname, '/mailbox');
  assert.equal(state.navLabel, '1 new drop');
  console.log(`[browser-unread-smoke] PASS ${viewport.name}: the delivered card and Inbox navigation show New.`);
}

async function assertHomeUnreadFeatured(viewport) {
  await setViewport(pageCdp, viewport);
  await navigate(pageCdp, `${APP_ORIGIN}/`);
  let state;
  try {
    state = await waitFor(async () => {
      const current = await evaluate(pageCdp, HOME_FEATURED_UNREAD_STATE);
      return current?.pathname === '/' && current.cardNew && current.accessibleLabel?.startsWith('Open new drop')
        ? current
        : null;
    }, `Home’s unread featured drop at ${viewport.name}`);
  } catch (error) {
    const diagnostic = await evaluate(pageCdp, `(() => {
      const card = Array.from(document.querySelectorAll('a[href^="/letter/"]')).find((element) => element.innerText.includes(${JSON.stringify(SUBJECT)}));
      const text = card?.innerText.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
      const accessibleLabel = card?.getAttribute('aria-label') || '';
      return {
        pathname: location.pathname,
        fixtureVisible: document.body.innerText.includes(${JSON.stringify(SUBJECT)}),
        featuredCardFound: Boolean(card),
        featuredCardNew: text.split(/\\s+/).includes('new'),
        featuredCardInbox: text.includes('in your inbox'),
        accessibleNewName: accessibleLabel.startsWith('Open new drop'),
      };
    })()`);
    throw new Error(`${error.message}; Home state=${JSON.stringify(diagnostic)}`);
  }
  assert.equal(state.cardInbox, false, 'Home showed the read-state label for an unread featured drop.');
  console.log(`[browser-unread-smoke] PASS ${viewport.name}: Home promotes the unread drop with a visible New label and an accessible new-drop name.`);
}

async function assertHomeReadFeatured(viewport) {
  await setViewport(pageCdp, viewport);
  await navigate(pageCdp, `${APP_ORIGIN}/`);
  const state = await waitFor(async () => {
    const current = await evaluate(pageCdp, HOME_FEATURED_UNREAD_STATE);
    return current?.pathname === '/' && current.cardInbox && !current.cardNew ? current : null;
  }, `Home’s read featured drop at ${viewport.name}`);
  assert.ok(state.accessibleLabel?.startsWith('Open drop from'), 'The read featured drop lost its accessible name.');
  console.log(`[browser-unread-smoke] PASS ${viewport.name}: Home clears the New treatment after the drop is opened.`);
}

function queryDisposableReadMarker() {
  if (!letterId || !recipientId || !/^unread-browser-[a-f0-9-]+$/i.test(letterId) || !/^[a-f0-9-]{36}$/i.test(recipientId)) {
    return { available: false, reason: 'Disposable row identity was not available or did not match the generated format.' };
  }
  const sql = `SELECT CASE WHEN EXISTS (
    SELECT 1 FROM private.recipient_drop_reads
    WHERE letter_id = '${letterId}' AND recipient_id = '${recipientId}'::uuid
  ) THEN 'true' ELSE 'false' END`;
  try {
    const result = execFileSync('docker', [
      'exec', 'supabase_db_drop', 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c', sql,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 1024 });
    return { available: true, hasReadMarker: result.trim() === 'true' };
  } catch {
    return { available: false, reason: 'The read-only local database query could not run.' };
  }
}

async function clearStateDiagnostic() {
  await Promise.allSettled(observedRpcResponses.map((entry) => entry.bodyPromise || Promise.resolve()));
  const page = await evaluate(pageCdp, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const body = document.body.innerText || '';
    return {
      pathname: location.pathname,
      visibleBodyLength: body.length,
      subjectPresent: body.includes(${JSON.stringify(SUBJECT)}),
      fullMessageVisible: body.includes(${JSON.stringify(MESSAGE)}),
      visibleHeadings: Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible).map((node) => node.innerText.trim()).slice(0, 8),
      visibleButtons: Array.from(document.querySelectorAll('button')).filter(visible).map((node) => node.innerText.trim()).filter(Boolean).slice(0, 12),
      visibleStatusLabels: Array.from(document.querySelectorAll('[role="status"]')).filter(visible).map((node) => node.getAttribute('aria-label') || node.innerText.trim()).filter(Boolean).slice(0, 8),
      marker: ${VISIBLE_NEW_STATE},
    };
  })()`);
  const rpc = observedRpcResponses.map(({ path, status, body, bodyError }) => ({
    method: path.split('/').at(-1),
    status,
    responseBody: typeof body === 'string'
      ? body.replaceAll(letterId || '', '[test-drop]').replaceAll(MESSAGE, '[test-content]').slice(0, 1200)
      : null,
    bodyError: bodyError || null,
  }));
  return { page, rpc, disposableReadMarker: queryDisposableReadMarker() };
}

async function openDropAndVerifyRead() {
  await setViewport(pageCdp, MOBILE_VIEWPORT);
  const clicked = await evaluate(pageCdp, `(() => {
    const badge = Array.from(document.querySelectorAll('[aria-label="New unread drop"]'))
      .find((element) => element.getBoundingClientRect().width > 0);
    const card = badge?.closest('a');
    if (!card) return false;
    card.click();
    return true;
  })()`);
  assert.equal(clicked, true, 'The smoke could not activate the delivered New card.');
  let route;
  try {
    route = await waitFor(async () => evaluate(pageCdp, `location.pathname.startsWith('/letter/')
      && document.body.innerText.toLocaleLowerCase().includes('reveal fragments')`), 'the sealed received drop');
  } catch (error) {
    const diagnostic = await evaluate(pageCdp, `(() => {
      const body = document.body.innerText;
      return {
        pathname: location.pathname,
        headings: Array.from(document.querySelectorAll('h1, h2')).map((node) => node.innerText.trim()).slice(0, 5),
        buttons: Array.from(document.querySelectorAll('button')).map((node) => node.innerText.trim()).filter(Boolean).slice(0, 12),
        loading: body.includes('Finding your drop…'),
        missing: body.includes('This drop isn’t available from this link.'),
        signInRequired: body.includes('Sign in to check this drop.'),
      };
    })()`);
    throw new Error(`${error.message}; page state=${JSON.stringify(diagnostic)}${browserExceptions.length ? `; browser exceptions=${JSON.stringify(browserExceptions.slice(-3))}` : ''}${browserConsoleErrors.length ? `; console errors=${JSON.stringify(browserConsoleErrors.slice(-3))}` : ''}`);
  }
  assert.ok(route);

  const revealed = await evaluate(pageCdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'reveal fragments');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(revealed, true, 'The smoke could not reveal the received drop fragments.');
  await waitFor(async () => evaluate(pageCdp, `Array.from(document.querySelectorAll('button')).some((element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'open received drop')`), 'the revealed drop action');
  const opened = await evaluate(pageCdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((element) => element.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'open received drop');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(opened, true, 'The smoke could not open the full received drop.');
  await waitFor(async () => evaluate(pageCdp, `document.querySelector('#letter-body')?.innerText.includes(${JSON.stringify(MESSAGE)})`), 'the complete delivered message body');
  await waitFor(async () => observedRpcResponses.some(({ path, status }) => path === '/rest/v1/rpc/mark_recipient_drop_read' && status === 200), 'the successful local recipient read-state RPC');
  await navigate(pageCdp, `${APP_ORIGIN}/mailbox`);
  await waitForMailbox();
  let state;
  try {
    state = await waitFor(async () => {
      const current = await evaluate(pageCdp, VISIBLE_NEW_STATE);
      return current?.subjectVisible && !current.cardNew && !current.navNew ? current : null;
    }, 'New to clear from the recipient inbox');
  } catch (error) {
    const diagnostic = await clearStateDiagnostic();
    throw new Error(`${error.message}; clear-state diagnostic=${JSON.stringify(diagnostic)}`);
  }
  assert.equal(state.navNew, false);
  console.log('[browser-unread-smoke] PASS opened full content; the marker RPC succeeded and New cleared from the inbox.');
}

async function reloadAndVerifyRead() {
  await navigate(pageCdp, `${APP_ORIGIN}/mailbox`);
  await waitForMailbox();
  const state = await evaluate(pageCdp, VISIBLE_NEW_STATE);
  assert.equal(state.subjectVisible, true, 'The delivered drop disappeared from the mailbox after reload.');
  assert.equal(state.cardNew, false, 'New returned on the card after reloading the mailbox.');
  assert.equal(state.navNew, false, 'The Inbox navigation count returned after reloading the mailbox.');
  assert.ok(observedRpcResponses.some(({ path, status }) => path === '/rest/v1/rpc/get_recipient_drop_read_states' && status === 200), 'The browser did not successfully reload recipient read state from local Supabase.');
  console.log('[browser-unread-smoke] PASS after mailbox reload: the delivered drop remains read and its New markers stay cleared.');
}

async function stopOwnedProcess(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error(`Could not stop this smoke’s ${label} process: ${error.message}`);
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    sleep(10_000).then(() => false),
  ]);
  if (exited) return true;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error(`Could not force-stop this smoke’s ${label} process: ${error.message}`);
  }
  const stopped = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!stopped) throw new Error(`This smoke’s ${label} process did not exit.`);
  return true;
}

async function cleanup() {
  pageCdp?.close();
  browserCdp?.close();
  for (const [child, label] of [[chrome, 'isolated Chrome'], [app, 'temporary Next.js app']]) {
    if (!child) continue;
    try { await stopOwnedProcess(child, label); }
    catch (error) {
      cleanupFailed = true;
      console.error(`[browser-unread-smoke] CLEANUP FAILED: ${error.message}`);
    }
  }

  if (admin) {
    if (letterId) {
      const { error } = await admin.from('letters').delete().eq('id', letterId);
      if (error) {
        cleanupFailed = true;
        console.error(`[browser-unread-smoke] CLEANUP FAILED: could not remove the disposable drop: ${error.message}`);
      }
    }
    for (const userId of createdUsers) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        cleanupFailed = true;
        console.error(`[browser-unread-smoke] CLEANUP FAILED: could not remove a disposable local account: ${error.message}`);
      }
    }
  }

  if (temporaryRoot) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch (error) {
      cleanupFailed = true;
      console.error(`[browser-unread-smoke] CLEANUP FAILED: could not remove its temporary app and browser profile: ${error.message}`);
    }
  }
}

async function main() {
  const localValues = await loadLocalSupabaseValues({ envFilePath: resolve(PROJECT_ROOT, '.env.local') });
  const supabaseUrl = validateLocalSupabaseUrl(localValues.NEXT_PUBLIC_SUPABASE_URL);
  const expectedProjectId = await loadExpectedLocalSupabaseProjectId({
    configFilePath: resolve(PROJECT_ROOT, 'supabase/config.toml'),
  });
  supabaseApiPort = Number(supabaseUrl.port);
  await assertLocalSupabasePortsAreSafe({ ports: [supabaseApiPort], expectedProjectId });
  // Leave an occupied app port exactly as found.
  await assertPortAvailable(TEST_PORT);
  const anonKey = localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = localValues.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'), 'Install project dependencies before running this smoke.');
  allowedOrigins.add(APP_ORIGIN);
  allowedOrigins.add(supabaseUrl.origin);

  const healthResponse = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(healthResponse.ok, `The local Supabase Auth health check returned HTTP ${healthResponse.status}.`);
  admin = createClient(supabaseUrl.origin, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-unread-browser-'));
  try {
    await startTemporaryApp(localValues);
    const sender = await createAccount('sender', admin);
    const recipient = await createAccount('recipient', admin);
    recipientId = recipient.id;
    await createDeliveredDrop(sender, recipient, admin);
    console.log('[browser-unread-smoke] Created two disposable local accounts and one delivered text drop.');

    await startBrowser();
    await navigate(pageCdp, `${APP_ORIGIN}/profile`);
    await waitFor(async () => evaluate(pageCdp, `location.origin === ${JSON.stringify(APP_ORIGIN)} && location.pathname === '/profile'
      && document.querySelector('#account-email') !== null`), 'the local account sign-in page');
    await signInWithMagicLink(recipient, admin);
    console.log('[browser-unread-smoke] PASS recipient completed Supabase’s local magic-link sign-in in an isolated browser.');

    await assertHomeUnreadFeatured(DESKTOP_VIEWPORT);
    await assertHomeUnreadFeatured(MOBILE_VIEWPORT);
    await navigate(pageCdp, `${APP_ORIGIN}/mailbox`);
    await waitForMailbox();
    await assertNewVisible(DESKTOP_VIEWPORT);
    await assertNewVisible(MOBILE_VIEWPORT);
    await openDropAndVerifyRead();
    await reloadAndVerifyRead();
    await assertHomeReadFeatured(DESKTOP_VIEWPORT);
    await assertHomeReadFeatured(MOBILE_VIEWPORT);

    assert.deepEqual(failedLocalRequests, [], `A local browser request failed: ${JSON.stringify(failedLocalRequests)}`);

    if (blockedExternalOrigins.size) {
      console.log(`[browser-unread-smoke] External origins blocked by the isolated browser: ${[...blockedExternalOrigins].sort().join(', ')}.`);
    }
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The browser smoke completed with cleanup failures; review the CLEANUP FAILED messages above.');
}

const onSigint = () => active.abort(new Error('Received SIGINT; cleaning up the local unread smoke.'));
const onSigterm = () => active.abort(new Error('Received SIGTERM; cleaning up the local unread smoke.'));
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  console.log('[browser-unread-smoke] PASS cleanup completed; port 4004 and hosted Supabase were untouched.');
}).catch((error) => {
  active.abort(error);
  console.error(`[browser-unread-smoke] FAIL: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
}).finally(() => {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
});
