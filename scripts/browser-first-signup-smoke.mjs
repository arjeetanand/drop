#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertTrustedLocalSupabaseListener } from './localSupabaseListener.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = 6004;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const MAILPIT_ORIGIN = 'http://127.0.0.1:54324';
const MAILPIT_API = `${MAILPIT_ORIGIN}/api/v1`;
const STEP_TIMEOUT_MS = 60_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const active = new AbortController();

let temporaryRoot;
let temporaryProject;
let app;
let chrome;
let browserCdp;
let pageCdp;
let admin;
let sender;
let outsider;
let dropFixture;
let dropSubject = '';
let dropContent = '';
let appError = '';
let browserError = '';
let browserSpawnError;
let appSpawnError;
let email = '';
let inviteeEmail = '';
let userId = '';
let inviteeUserId = '';
let mailpitMessageId = '';
const mailpitMessageIds = new Set();
const mailpitMessageIdsByEmail = new Map();
let localSupabaseOrigin = '';
let localAnonKey = '';
let cleanupFailed = false;
let firewallFailure = false;
let dropCleanupVerified = false;
let dropCleanupDeleted = 0;
let inviteeDropDraftId = '';
let inviteeDropSubject = '';
let inviteeDropContent = '';
let inviteeDropCleanupVerified = false;
let inviteeDropCleanupDeleted = 0;
let mailpitCleanupVerified = false;
let mailpitCleanupDeleted = 0;
let authCleanupVerified = 0;
let profileCleanupVerified = 0;
const createdUsers = [];
const browserProcesses = [];
const allowedOrigins = new Set();
const blockedExternalOrigins = new Set();
const exceptions = [];
const consoleErrors = [];

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
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('Interrupted while connecting to DevTools.'));
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
      return Promise.reject(new Error(`DevTools is closed before ${method}.`));
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

function requireLoopbackSupabaseUrl(rawValue) {
  let url;
  try { url = new URL(rawValue); } catch { throw new Error('.env.local has an invalid NEXT_PUBLIC_SUPABASE_URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(hostname), 'This smoke accepts Supabase only on a loopback host.');
  assert.equal(url.protocol, 'http:', 'Local Supabase must use HTTP.');
  assert.equal(url.port || '80', '54321', 'This smoke accepts only the local Supabase API port 54321.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'The Supabase URL must be a plain local origin.');
  return url;
}

function parseLocalMailpitUrl(rawValue) {
  const url = new URL(rawValue);
  assert.equal(url.protocol, 'http:', 'Local Mailpit must use HTTP.');
  assert.equal(url.hostname, '127.0.0.1', 'Mailpit must use IPv4 loopback.');
  assert.equal(url.port, '54324', 'This smoke accepts only the local Supabase Mailpit port 54324.');
  assert.equal(url.pathname, '/', 'The Mailpit URL must be a plain local origin.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'The Mailpit URL must not include credentials or extra URL components.');
  return url;
}

async function assertPortAvailable(port) {
  const server = createServer();
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already owned; this smoke leaves that process untouched.`);
    }
    throw error;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
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

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (active.signal.aborted) throw active.signal.reason || new Error('Interrupted.');
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last check: ${lastError.message}` : ''}`);
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
  for (const name of ['LANG', 'LC_ALL', 'TZ']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
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

function lastLines(value) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean).slice(-8);
  return lines.length ? `\n${lines.join('\n')}` : '';
}

async function startTemporaryApp(localValues) {
  await assertPortAvailable(APP_PORT);
  const projectRoot = await makeIsolatedProject();
  app = spawn(process.execPath, [
    resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next'),
    'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(APP_PORT),
  ], {
    cwd: projectRoot,
    env: safeAppEnvironment(localValues),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  app.on('error', (error) => { appSpawnError = error; });
  app.stderr.on('data', (chunk) => { appError = `${appError}${chunk.toString('utf8')}`.slice(-10_000); });
  await waitFor(async () => {
    if (appSpawnError) throw new Error('The isolated Next.js app could not start.');
    if (app.exitCode !== null) throw new Error(`The isolated Next.js app exited.${lastLines(appError)}`);
    try {
      const response = await fetch(`${APP_ORIGIN}/profile`, { signal: AbortSignal.timeout(1_000) });
      return response.status < 500;
    } catch { return false; }
  }, 'the isolated Next.js profile page to start');
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
        `${process.env['PROGRAMFILES(X86)'] || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error('No supported Chrome, Edge, or Chromium executable was found.');
  return executable;
}

function browserEnvironment() {
  const environment = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || tmpdir(),
    TMPDIR: process.env.TMPDIR || tmpdir(),
  };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

async function waitForDevTools(profilePath) {
  const file = join(profilePath, 'DevToolsActivePort');
  return waitFor(async () => {
    if (browserSpawnError) throw new Error('An isolated browser process could not start.');
    if (chrome.exitCode !== null) throw new Error(`The isolated browser exited.${lastLines(browserError)}`);
    try {
      const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return { port, path: lines[1] };
    } catch { /* The browser has not created its DevTools port file yet. */ }
    return false;
  }, 'the isolated browser DevTools endpoint', 45_000);
}

async function requestJson(url, options = {}) {
  const parsed = new URL(url);
  assert.ok(LOOPBACK_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()), 'DevTools requests must stay on loopback.');
  const response = await fetch(parsed, { ...options, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`DevTools returned HTTP ${response.status} for ${parsed.pathname}.`);
  return response.json();
}

function observeNetwork(connection) {
  connection.on('Fetch.requestPaused', ({ requestId, request }) => {
    let origin = '';
    try { origin = new URL(request.url).origin; } catch { /* Invalid URLs are blocked below. */ }
    const allowed = allowedOrigins.has(origin);
    if (!allowed) blockedExternalOrigins.add(origin || '[invalid-url]');
    const method = allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest';
    const params = allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' };
    void connection.send(method, params).catch((error) => {
      // Chrome can retire a paused request while a same-origin navigation is
      // replacing it. External origins are still blocked by the resolver rule.
      if (!/Invalid InterceptionId/i.test(error.message)) firewallFailure = true;
    });
  });
  connection.on('Runtime.exceptionThrown', () => exceptions.push('browser exception'));
  connection.on('Runtime.consoleAPICalled', ({ type }) => {
    if (type === 'error') consoleErrors.push('browser console error');
  });
}

async function startBrowser(profileName) {
  if (typeof WebSocket !== 'function') throw new Error('This smoke needs Node with the built-in WebSocket API.');
  const executable = findChromeExecutable();
  const profile = join(temporaryRoot, profileName);
  browserError = '';
  browserSpawnError = undefined;
  const resolverRule = 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE [::1]';
  chrome = spawn(executable, [
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
    `--host-resolver-rules=${resolverRule}`,
    'about:blank',
  ], {
    env: browserEnvironment(),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  browserProcesses.push(chrome);
  chrome.on('error', (error) => { browserSpawnError = error; });
  chrome.stderr.on('data', (chunk) => { browserError = `${browserError}${chunk.toString('utf8')}`.slice(-8_000); });
  const devTools = await waitForDevTools(profile);
  browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
  const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
  pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
  observeNetwork(pageCdp);
  try {
    await browserCdp.send('Browser.grantPermissions', { origin: APP_ORIGIN, permissions: ['clipboardReadWrite'] });
  } catch { /* The composer still shows a manual link if clipboard permission is unavailable. */ }
  await Promise.all([
    pageCdp.send('Page.enable'),
    pageCdp.send('Runtime.enable'),
    pageCdp.send('Network.enable'),
    pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
  ]);
}

async function closeCurrentBrowser() {
  pageCdp?.close();
  browserCdp?.close();
  if (chrome) await stopOwnedProcess(chrome, 'isolated browser');
  pageCdp = undefined;
  browserCdp = undefined;
  chrome = undefined;
}

async function evaluate(expression) {
  const response = await pageCdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) throw new Error('A browser interaction failed.');
  return response.result?.value;
}

async function navigate(url) {
  const parsed = new URL(url);
  assert.ok(allowedOrigins.has(parsed.origin), 'Browser navigation must use the app or local Supabase origin.');
  await pageCdp.send('Page.navigate', { url: parsed.href });
}

async function findDisposableUser(targetEmail = email) {
  if (!admin || !targetEmail) return null;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not check for the exact disposable local Auth user.');
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error('The local Auth user list exceeded the safety limit for exact cleanup.');
}

async function createDisposableAccount(label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const accountEmail = `drop-first-claim-${label}-${suffix}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const username = `sm_${label.slice(0, 3)}_${suffix.slice(0, 8)}`;
  const displayName = label === 'sender' ? 'Pilot Sender' : 'Pilot Outsider';
  const { data, error } = await admin.auth.admin.createUser({ email: accountEmail, password, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`Could not create the disposable local ${label} account.`);
  createdUsers.push({ id: data.user.id, email: accountEmail });

  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id,
    username,
    display_name: displayName,
    bio: '',
  });
  if (profileError) throw new Error(`Could not create the disposable local ${label} profile.`);

  const client = createClient(localSupabaseOrigin, localAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email: accountEmail, password });
  if (signInError || session.user?.id !== data.user.id || !session.session?.access_token) {
    throw new Error(`Could not authenticate the disposable local ${label} account for access-boundary checks.`);
  }
  const { data: profile, error: verifyError } = await client.from('profiles')
    .select('id, username, display_name')
    .eq('id', data.user.id)
    .maybeSingle();
  assert.ifError(verifyError);
  assert.deepEqual(profile, { id: data.user.id, username, display_name: displayName });
  return { id: data.user.id, email: accountEmail, username, displayName, client };
}

async function generateSenderMagicLink(account) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
    options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
  });
  if (error || !data.properties?.action_link) throw new Error('Local Supabase could not create the disposable sender sign-in link.');
  const url = new URL(data.properties.action_link);
  assert.equal(url.origin, localSupabaseOrigin, 'The sender sign-in link must use loopback Supabase.');
  assert.equal(url.pathname, '/auth/v1/verify');
  return url.href;
}

async function waitForIssuedTextDrop(subject, content) {
  return waitFor(async () => {
    const { data, error } = await admin.from('letters')
      .select('id, sender_id, recipient_id, recipient_username, recipient_name, subject, content, status, delivery_mode, payload_kind')
      .eq('sender_id', sender.id)
      .eq('subject', subject)
      .eq('content', content)
      .limit(2);
    if (error) throw new Error('Could not verify the exact local text claim drop.');
    assert.ok((data || []).length <= 1, 'The unique disposable text claim must create at most one row.');
    const row = data?.[0];
    if (!row) return false;
    dropFixture = { id: row.id, senderId: sender.id, subject, content };
    assert.deepEqual(row, {
      id: row.id,
      sender_id: sender.id,
      recipient_id: null,
      recipient_username: null,
      recipient_name: null,
      subject,
      content,
      status: 'claim_pending',
      delivery_mode: 'instant',
      payload_kind: 'text',
    });
    return row;
  }, 'the sender UI to issue one exact private text claim drop');
}

async function clickButton(label) {
  const result = await evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const button = Array.from(document.querySelectorAll('button')).find((item) => normalize(item.innerText) === ${JSON.stringify(label.toLocaleLowerCase())});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(result, true, `The browser could not activate the ${label} button.`);
}

async function tapControl(tagName, label) {
  const point = await evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const control = Array.from(document.querySelectorAll(${JSON.stringify(tagName)})).find((item) => normalize(item.innerText) === ${JSON.stringify(label.toLocaleLowerCase())});
    if (!control || control.disabled) return null;
    control.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = control.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`);
  assert.ok(point && point.width >= 44 && point.height >= 44, `The mobile ${label} control must be visible and at least 44px by 44px; measured=${JSON.stringify(point)}.`);
  assert.ok(point.x >= 0 && point.x <= point.viewportWidth && point.y >= 0 && point.y <= point.viewportHeight, `The mobile ${label} control must be inside the viewport before the tap.`);
  await pageCdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await pageCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function activateHomeInviteWithKeyboard() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const focused = await evaluate(`(() => {
      const element = document.activeElement;
      if (!element?.matches('a')) return null;
      return {
        href: element.getAttribute('href'),
        label: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase(),
        focusVisible: element.matches(':focus-visible'),
      };
    })()`);
    if (focused?.href === '/profile?invite=1' && focused.label === 'invite a friend') {
      assert.equal(focused.focusVisible, true, 'Invite a friend must show a visible keyboard focus indicator.');
      await pageCdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await pageCdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      return;
    }
    await pageCdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await pageCdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  }
  throw new Error('Could not keyboard-focus and activate the Home Invite a friend link.');
}

async function waitForClaimUiState(predicate, description, handoffId) {
  try {
    return await waitFor(predicate, description);
  } catch (error) {
    let snapshot = {
      path: 'unavailable',
      handoffMatches: false,
      claimButtonPresent: false,
      revealButtonPresent: false,
      openButtonPresent: false,
      profileFormPresent: false,
    };
    try {
      snapshot = await evaluate(`(() => {
        const buttonLabels = new Set([...document.querySelectorAll('button')]
          .map((button) => button.innerText.trim().toLocaleLowerCase()));
        return {
          path: location.pathname,
          handoffMatches: new URLSearchParams(location.search).get('handoff') === ${JSON.stringify(handoffId)},
          claimButtonPresent: buttonLabels.has('claim this drop'),
          revealButtonPresent: buttonLabels.has('reveal fragments'),
          openButtonPresent: buttonLabels.has('open received drop'),
          profileFormPresent: Boolean(document.querySelector('#display-name')),
        };
      })()`);
    } catch { /* Keep the fallback snapshot free of page or secret data. */ }
    throw new Error(`${error.message} Safe UI snapshot: ${JSON.stringify(snapshot)}`);
  }
}

async function stubNativeShareForTest() {
  const installed = await evaluate(`(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (details) => {
        if (!details || typeof details.url !== 'string') throw new TypeError('Share URL missing.');
        const captured = {
          keys: Object.keys(details).sort(),
          title: details.title ?? null,
          text: details.text ?? null,
          url: details.url,
        };
        window.__dropBrowserE2EShareCallCount = (window.__dropBrowserE2EShareCallCount || 0) + 1;
        window.__dropBrowserE2EShareDetails = captured;
        window.__dropBrowserE2EShareUrl = details.url;
        try {
          window.sessionStorage.setItem('drop-browser-e2e-share-url', details.url);
          window.sessionStorage.setItem('drop-browser-e2e-share-details', JSON.stringify(captured));
        } catch { /* The in-memory result remains available. */ }
      },
    });
    return typeof navigator.share === 'function';
  })()`);
  assert.equal(installed, true, 'The isolated browser must allow the share result to be captured without opening a native sheet.');
}

async function waitForMailpitMessage(targetEmail = email) {
  return waitFor(async () => {
    const response = await fetch(`${MAILPIT_API}/messages?limit=100`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Local Mailpit returned HTTP ${response.status}.`);
    const result = await response.json();
    const matching = result.messages?.filter((candidate) =>
      (candidate.To || []).some((recipient) => (recipient.Address || '').toLowerCase() === targetEmail.toLowerCase())) || [];
    if (!matching.length) return false;
    assert.equal(matching.length, 1, 'The unique public-signup address must receive exactly one local message.');
    const [message] = matching;
    mailpitMessageId = message.ID;
    mailpitMessageIds.add(mailpitMessageId);
    mailpitMessageIdsByEmail.set(targetEmail.toLowerCase(), mailpitMessageId);
    assert.ok(mailpitMessageId, 'Mailpit returned a matching message without an ID.');
    return message;
  }, 'the new user’s local Mailpit message');
}

function extractMagicLink(message) {
  const bodies = [message.HTML, message.Text].filter((body) => typeof body === 'string');
  const candidates = [];
  for (const body of bodies) {
    for (const match of body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
    for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/gi)) candidates.push(match[0]);
  }
  for (const candidate of candidates) {
    const decoded = candidate
      .replaceAll('&amp;', '&')
      .replaceAll('&#x3D;', '=')
      .replaceAll('&#61;', '=')
      .replaceAll('&quot;', '"');
    let url;
    try { url = new URL(decoded); } catch { continue; }
    if (url.origin === localSupabaseOrigin && url.pathname === '/auth/v1/verify') return url;
  }
  throw new Error('Mailpit contained no local Supabase confirmation link for the new account.');
}

async function readMagicLinkFromMailpit(targetEmail = email, expectedNextPath = null) {
  const messageId = mailpitMessageIdsByEmail.get(targetEmail.toLowerCase()) || (await waitForMailpitMessage(targetEmail)).ID;
  const response = await fetch(`${MAILPIT_API}/message/${encodeURIComponent(messageId)}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Local Mailpit message retrieval returned HTTP ${response.status}.`);
  const message = await response.json();
  const url = extractMagicLink(message);
  assert.equal(url.searchParams.get('type'), 'magiclink', 'The email link must be a Supabase magic link.');
  const redirect = new URL(url.searchParams.get('redirect_to') || '');
  assert.equal(redirect.origin, APP_ORIGIN, 'The email link must return to the isolated app on loopback.');
  assert.equal(redirect.pathname, '/auth/callback', 'The email link must return through the app auth callback.');
  if (expectedNextPath) {
    assert.equal(redirect.searchParams.get('next'), expectedNextPath, 'The sign-in link must preserve the validated composer return path.');
    assert.equal(redirect.searchParams.has('invite'), false, 'A first-send signup link must not inherit the owner-invite context.');
  } else {
    assert.equal(redirect.search, '?invite=1', 'The first-use signup link must return through the invite callback only.');
    assert.equal(redirect.searchParams.get('invite'), '1', 'The first-use signup link must preserve the Home invite context.');
    assert.equal(redirect.searchParams.has('next'), false, 'The Home invite signup link must not inherit an unrelated return route.');
  }
  return url.href;
}

async function deleteExactMailpitMessage() {
  const targetEmails = new Set([email, inviteeEmail].filter(Boolean).map((value) => value.toLowerCase()));
  if (targetEmails.size) {
    const response = await fetch(`${MAILPIT_API}/messages?limit=100`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Mailpit did not return the local message list for cleanup.');
    const result = await response.json();
    for (const message of result.messages || []) {
      if ((message.To || []).some((recipient) => targetEmails.has((recipient.Address || '').toLowerCase())) && message.ID) {
        mailpitMessageIds.add(message.ID);
      }
    }
  }
  if (mailpitMessageId) mailpitMessageIds.add(mailpitMessageId);
  const ids = [...mailpitMessageIds];
  if (!ids.length) {
    mailpitCleanupVerified = true;
    return;
  }
  const response = await fetch(`${MAILPIT_API}/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('Mailpit did not delete the exact disposable message.');
  for (const id of ids) {
    const check = await fetch(`${MAILPIT_API}/message/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5_000) });
    if (check.status !== 404) throw new Error('An exact disposable Mailpit message still exists after cleanup.');
    mailpitCleanupDeleted += 1;
  }
  mailpitCleanupVerified = true;
}

async function fillBrowserInput(selector, value) {
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
  assert.equal(result, true, `The browser form field ${selector} must be available.`);
}

async function waitForNewProfileForm(expectedEmail = email) {
  return waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.querySelector('#display-name') !== null
    && document.querySelector('#account-email') === null
    && document.body.innerText.includes(${JSON.stringify(`Connected as ${expectedEmail}.`)})
    && !document.querySelector('#display-name').disabled`), 'the signed-in first-use profile form');
}

async function createTextClaimInvite() {
  dropSubject = `Local private note ${randomUUID().slice(0, 8)}`;
  dropContent = `A first-use claim test note ${randomUUID()}.`;
  await navigate(`${APP_ORIGIN}/compose?new=1`);
  await waitFor(async () => evaluate(`location.pathname === '/compose'
    && document.querySelector('#drop-subject') !== null
    && document.querySelector('#drop-content') !== null
    && document.querySelector('#drop-recipient')?.value === ''`), 'the signed-in sender composer with a fresh unaddressed draft');
  await fillBrowserInput('#drop-subject', dropSubject);
  await fillBrowserInput('#drop-content', dropContent);
  await clickButton('Share without a handle');
  await waitFor(async () => evaluate(`document.querySelector('#unaddressed-claim-title') !== null
    && [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Share private link') && !button.disabled)`), 'the sender private text-link action');
  await stubNativeShareForTest();
  await clickButton('Share private link');

  const issued = await waitForIssuedTextDrop(dropSubject, dropContent);
  try {
    await waitFor(async () => evaluate(`(() => {
      const params = new URLSearchParams(location.search);
      return location.pathname === '/sent'
        && params.get('claim') === '1'
        && params.get('share') === 'shared'
        && params.get('letter') === ${JSON.stringify(issued.id)};
    })()`), 'the sender private claim receipt route', 15_000);
  } catch {
    let state = 'unavailable';
    try {
      state = await evaluate(`(() => {
        const params = new URLSearchParams(location.search);
        return {
          path: location.pathname,
          routeParams: ['claim', 'share'].filter((key) => params.has(key)).map((key) => [key, params.get(key)]),
          hasLetterParam: params.has('letter'),
          hasPrivateLinkCode: Boolean(document.querySelector('code[aria-label="Select and copy this private claim link"]')),
          heading: document.querySelector('#claim-pending-title')?.innerText?.trim() || '',
          statuses: [...document.querySelectorAll('[role="status"], [role="alert"]')]
            .map((element) => element.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
          buttons: [...document.querySelectorAll('button')]
            .map((button) => ({ text: button.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80), disabled: button.disabled }))
            .filter((button) => button.text).slice(0, 12),
        };
      })()`);
    } catch { /* Keep a generic state if the sender page is already gone. */ }
    throw new Error(`Timed out waiting for the sender private claim receipt route. Safe rendered state: ${JSON.stringify(state)}`);
  }
  const receipt = await evaluate(`(() => {
    const params = new URLSearchParams(location.search);
    return { path: location.pathname, claim: params.get('claim'), share: params.get('share'), letter: params.get('letter') };
  })()`);
  assert.deepEqual(receipt, { path: '/sent', claim: '1', share: 'shared', letter: issued.id }, 'The sender must reach the successful claim receipt for this exact drop.');
  const linkText = await evaluate(`(() => {
    const value = window.__dropBrowserE2EShareUrl || window.sessionStorage.getItem('drop-browser-e2e-share-url') || '';
    try { window.sessionStorage.removeItem('drop-browser-e2e-share-url'); } catch { /* The isolated browser profile is removed after the smoke. */ }
    return value;
  })()`);
  assert.equal(typeof linkText, 'string', 'The sender flow must return the private link to the isolated test.');
  let url;
  try { url = new URL(linkText, APP_ORIGIN); }
  catch { throw new Error('The sender flow did not return a valid private claim link.'); }
  assert.ok(allowedOrigins.has(url.origin), 'The private claim link must use the isolated app origin.');
  assert.equal(url.pathname, '/claim', 'The sender must create the supported claim route.');
  assert.equal(url.search, '', 'The private claim capability must not be in the query string.');
  const token = new URLSearchParams(url.hash.slice(1)).get('token') || '';
  assert.ok(/^[a-f0-9]{64}$/i.test(token), 'The private link must carry the expected fragment token.');
  dropFixture = { ...issued, token, url: url.href };
  return dropFixture;
}

async function startUnauthenticatedRecipient() {
  await navigate(dropFixture.url);
  let lastClaimPageState;
  try {
    await waitFor(async () => {
      lastClaimPageState = await evaluate(`(() => {
        const bodyText = document.body.innerText.toLocaleLowerCase();
        return {
          appOriginMatches: location.origin === ${JSON.stringify(APP_ORIGIN)},
          claimRoute: location.pathname === '/claim',
          hasClaimHeading: bodyText.includes('private claim invite'),
          hasSignInLink: [...document.querySelectorAll('a')].some((link) => link.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'sign in or create your account'),
          hasStorageWarning: bodyText.includes('blocking the storage needed to keep your invite open'),
        };
      })()`);
      return lastClaimPageState.appOriginMatches
        && lastClaimPageState.claimRoute
        && lastClaimPageState.hasClaimHeading
        && lastClaimPageState.hasSignInLink;
    }, 'the unauthenticated recipient claim page');
  } catch (error) {
    throw new Error(`${error.message} Safe page state: ${JSON.stringify(lastClaimPageState || {})}`);
  }
  const sealedState = await evaluate(`(() => ({
    hasSubject: document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(dropFixture.subject.toLocaleLowerCase())}),
    hasContent: document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(dropFixture.content.toLocaleLowerCase())}),
    hasClaimAction: [...document.querySelectorAll('button')].some((button) => button.innerText.trim().toLocaleLowerCase() === 'claim this drop'),
    hasOpenedBody: Boolean(document.querySelector('#letter-body')),
    imageCount: document.querySelectorAll('img').length,
    handoff: new URLSearchParams(location.search).get('handoff'),
    hash: location.hash,
  }))()`);
  assert.equal(sealedState.hasSubject, false, 'The unclaimed text subject must remain sealed.');
  assert.equal(sealedState.hasContent, false, 'The unclaimed text content must remain sealed.');
  assert.equal(sealedState.hasClaimAction, false, 'An unauthenticated browser cannot claim before setup.');
  assert.equal(sealedState.hasOpenedBody, false, 'The unopened letter body must not render on the claim page.');
  assert.equal(sealedState.imageCount, 0, 'The text claim page must not render media.');
  assert.equal(sealedState.hash, '', 'The claim token fragment must be removed from the visible address.');
  assert.match(sealedState.handoff || '', /^[0-9a-f-]{36}$/i, 'The browser must retain an opaque return handoff.');
  const storedHandoffId = await evaluate(`window.sessionStorage.getItem('drop:claim-handoff-id:v1')`);
  assert.equal(storedHandoffId, sealedState.handoff, 'The sealed claim handoff must be stored before leaving its page.');
  console.log('[browser-first-signup-smoke] PASS unauthenticated browser opened the sealed text invite and retained its opaque handoff.');
  return { claimHandoffId: sealedState.handoff };
}

async function requestInviteSignupFromHome(emailAddress) {
  await navigate(APP_ORIGIN);
  await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/'
    && document.body.innerText.includes('Your inbox is waiting on its first drop.')
    && [...document.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/profile?invite=1')`), 'the signed-out Home inbox and Invite a friend link');
  await activateHomeInviteWithKeyboard();
  await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && location.search === '?invite=1'
    && new URLSearchParams(location.search).get('invite') === '1'
    && !new URLSearchParams(location.search).has('next')
    && document.querySelector('#account-email') !== null`), 'the keyboard-invited signed-out email form without an unrelated return route');
  const beforeSignupState = await evaluate(`(() => ({
    inviteShareTitlePresent: Boolean(document.querySelector('#invite-share-title')),
    inviteButtonsPresent: [...document.querySelectorAll('button')].some((button) => /^(share @|copy handle \\+ link)/i.test(button.innerText.trim())),
    inviteContext: new URLSearchParams(location.search).get('invite'),
    hasNext: new URLSearchParams(location.search).has('next'),
    emailFormPresent: Boolean(document.querySelector('#account-email')),
  }))()`);
  assert.deepEqual(beforeSignupState, {
    inviteShareTitlePresent: false,
    inviteButtonsPresent: false,
    inviteContext: '1',
    hasNext: false,
    emailFormPresent: true,
  }, 'An unauthenticated invite page must retain its context without exposing post-sync share controls.');
  await fillBrowserInput('#account-email', emailAddress);
  const submitted = await evaluate(`(() => {
    const form = document.querySelector('#account-email')?.closest('form');
    if (!form) return false;
    form.requestSubmit(form.querySelector('button[type="submit"]'));
    return true;
  })()`);
  assert.equal(submitted, true, 'The invite profile must submit the public email sign-in form.');
  await waitFor(async () => evaluate(`document.body.innerText.includes('Sign-in link sent. Check your inbox to continue.')`), 'the Home invite email form to request a sign-in link');
  const message = await waitForMailpitMessage();
  console.log('[browser-first-signup-smoke] PASS signed-out Home keyboard-activated Invite a friend and requested email signup from /profile?invite=1.');
  return message;
}

async function verifySignedOutInviteeFirstSend() {
  const senderProfilePath = `/u/${encodeURIComponent(sender.username)}`;
  inviteeDropSubject = `First friend drop ${randomUUID().slice(0, 8)}`;
  inviteeDropContent = `Kept through signup ${randomUUID()}.`;

  await closeCurrentBrowser();
  await startBrowser('invited-friend-browser');
  await pageCdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pageCdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await navigate(`${APP_ORIGIN}${senderProfilePath}`);
  await waitFor(async () => evaluate(`location.pathname === ${JSON.stringify(senderProfilePath)}
    && document.body.innerText.includes('Open to drops')
    && [...document.querySelectorAll('a')].some((link) => link.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'send a drop')`), 'the owner public profile and its Send a drop action');

  const composeHref = await evaluate(`(() => {
    const link = Array.from(document.querySelectorAll('a')).find((item) => item.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'send a drop');
    return link?.href || null;
  })()`);
  assert.ok(composeHref, 'The public profile must expose a working Send a drop link.');
  const composeUrl = new URL(composeHref);
  assert.equal(composeUrl.origin, APP_ORIGIN);
  assert.equal(composeUrl.pathname, '/compose');
  assert.equal(composeUrl.searchParams.get('new'), '1');
  assert.equal(composeUrl.searchParams.get('recipient'), `@${sender.username}`);
  await tapControl('a', 'Send a drop');
  await waitFor(async () => evaluate(`location.pathname === '/compose'
    && new URLSearchParams(location.search).get('recipient') === ${JSON.stringify(`@${sender.username}`)}
    && document.querySelector('#drop-recipient')?.value === ${JSON.stringify(sender.username)}
    && document.querySelector('#drop-subject') !== null
    && document.querySelector('#drop-content') !== null`), 'the mobile signed-out composer with the owner prefilled');
  const primaryAction = await evaluate(`(() => {
    const element = document.querySelector('.composer-action-primary');
    if (!element) return null;
    return { tagName: element.tagName, label: element.innerText.replace(/\\s+/g, ' ').trim(), href: element.getAttribute('href') };
  })()`);
  assert.equal(primaryAction?.tagName, 'A', `The signed-out composer must offer a sign-in link; safe action state=${JSON.stringify(primaryAction)}.`);
  const primaryActionUrl = new URL(primaryAction.href, APP_ORIGIN);
  assert.equal(primaryActionUrl.pathname, '/profile', 'The sign-in action must lead to account setup.');
  assert.ok(primaryActionUrl.searchParams.get('next'), 'The sign-in action must carry the saved composer return path.');

  await fillBrowserInput('#drop-subject', inviteeDropSubject);
  await fillBrowserInput('#drop-content', inviteeDropContent);
  await tapControl('.composer-action-primary', primaryAction.label);
  await waitFor(async () => evaluate(`location.pathname === '/profile'
    && Boolean(document.querySelector('#account-email'))
    && new URLSearchParams(location.search).has('next')`), 'the email sign-in form with a composer return path');

  const nextPath = await evaluate(`new URLSearchParams(location.search).get('next')`);
  assert.equal(typeof nextPath, 'string');
  const nextUrl = new URL(nextPath, APP_ORIGIN);
  assert.equal(nextUrl.origin, APP_ORIGIN);
  assert.equal(nextUrl.pathname, '/compose');
  inviteeDropDraftId = nextUrl.searchParams.get('letter') || '';
  assert.match(inviteeDropDraftId, /^draft-[a-f0-9-]{36}$/i, 'The friend must return to this exact local draft after signup.');
  assert.equal(nextUrl.searchParams.has('new'), false, 'The return path must restore the saved draft, not start another one.');

  const { data: unsentRows, error: unsentError } = await admin.from('letters').select('id')
    .eq('subject', inviteeDropSubject).eq('content', inviteeDropContent).limit(2);
  assert.ifError(unsentError);
  assert.deepEqual(unsentRows, [], 'Opening sign-up must not send the friend’s draft.');
  assert.equal(await findDisposableUser(inviteeEmail), null, 'The invited friend must be a genuinely new local Auth account before the sign-up request.');

  await fillBrowserInput('#account-email', inviteeEmail);
  const submitted = await evaluate(`(() => {
    const form = document.querySelector('#account-email')?.closest('form');
    if (!form) return false;
    form.requestSubmit(form.querySelector('button[type="submit"]'));
    return true;
  })()`);
  assert.equal(submitted, true, 'The new invited friend must be able to request an email sign-in link.');
  await waitFor(async () => evaluate(`document.body.innerText.includes('Sign-in link sent. Check your inbox to continue.')`), 'the invited friend’s sign-in link confirmation');
  await waitForMailpitMessage(inviteeEmail);

  const newInvitee = await waitFor(async () => findDisposableUser(inviteeEmail), 'local Auth to create the new invited friend');
  inviteeUserId = newInvitee.id;
  if (!createdUsers.some((candidate) => candidate.id === inviteeUserId)) createdUsers.push({ id: inviteeUserId, email: inviteeEmail });
  const { data: inviteeProfileBeforeSend, error: inviteeProfileError } = await admin.from('profiles')
    .select('id').eq('id', inviteeUserId).maybeSingle();
  assert.ifError(inviteeProfileError);
  assert.equal(inviteeProfileBeforeSend, null, 'The new sender should not need a Drop handle to send to the profile they opened.');

  const magicLink = await readMagicLinkFromMailpit(inviteeEmail, nextPath);
  await navigate(magicLink);
  await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/compose'
    && new URLSearchParams(location.search).get('letter') === ${JSON.stringify(inviteeDropDraftId)}
    && document.querySelector('#drop-recipient')?.value === ${JSON.stringify(sender.username)}
    && document.querySelector('#drop-subject')?.value === ${JSON.stringify(inviteeDropSubject)}
    && document.querySelector('#drop-content')?.value === ${JSON.stringify(inviteeDropContent)}
    && document.body.innerText.includes('Your account is ready.')`), 'signup to return to the same addressed, editable mobile draft');

  const mobileLayout = await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight })`);
  assert.equal(mobileLayout.width, 390, 'The invited-friend send flow must render at the mobile test width.');
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.width + 1, 'The restored composer must not overflow horizontally on mobile.');

  const { data: stillUnsentRows, error: stillUnsentError } = await admin.from('letters').select('id')
    .eq('subject', inviteeDropSubject).eq('content', inviteeDropContent).limit(2);
  assert.ifError(stillUnsentError);
  assert.deepEqual(stillUnsentRows, [], 'Email verification must not send the draft automatically.');

  inviteeDropContent = `${inviteeDropContent} Edited after signup.`;
  await fillBrowserInput('#drop-content', inviteeDropContent);
  await waitFor(async () => evaluate(`Array.from(document.querySelectorAll('button')).some((button) =>
    button.innerText.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'check handle' && !button.disabled)`), 'the enabled owner-handle check');
  await clickButton('Check handle');
  await waitFor(async () => evaluate(`document.body.innerText.includes(${JSON.stringify(`Recipient confirmed: ${sender.displayName} (@${sender.username})`)})`), 'the public-profile recipient to be confirmed after signup');

  await tapControl('button', 'Send drop');
  await waitFor(async () => evaluate(`location.pathname === '/sent'
    && new URLSearchParams(location.search).get('letter') === ${JSON.stringify(inviteeDropDraftId)}`), 'the friend’s explicit send receipt');

  const sentRow = await waitFor(async () => {
    const { data, error } = await admin.from('letters')
      .select('id, sender_id, recipient_id, recipient_username, recipient_name, status, subject, content, delivery_mode, payload_kind')
      .eq('id', inviteeDropDraftId)
      .eq('sender_id', inviteeUserId)
      .limit(2);
    if (error) throw new Error('Could not verify the exact local first-friend send.');
    assert.ok(data.length <= 1, 'The friend’s explicit send must create at most one delivered row.');
    return data[0] || false;
  }, 'the exact first-friend drop to be delivered');
  assert.deepEqual(sentRow, {
    id: inviteeDropDraftId,
    sender_id: inviteeUserId,
    recipient_id: sender.id,
    recipient_username: sender.username,
    recipient_name: sender.displayName,
    status: 'delivered',
    subject: inviteeDropSubject,
    content: inviteeDropContent,
    delivery_mode: 'instant',
    payload_kind: 'text',
  }, 'The signed-out friend must explicitly create one delivered text drop addressed to the profile owner.');
  console.log('[browser-first-signup-smoke] PASS at 390x844: a new signed-out friend opened the public profile, kept an editable addressed draft through Mailpit signup, and sent exactly one text drop only after tapping Send drop.');

  await closeCurrentBrowser();
  await startBrowser('owner-inbox-browser');
  await navigate(await generateSenderMagicLink(sender));
  await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname !== '/auth/callback'`), 'the owner account sign-in callback');
  await navigate(`${APP_ORIGIN}/profile`);
  const ownerSessionConfirmed = Boolean(await waitForNewProfileForm(sender.email));
  await navigate(APP_ORIGIN);
  const receivedLinkPath = `/letter/${encodeURIComponent(inviteeDropDraftId)}`;
  let ownerHome;
  try {
    ownerHome = await waitFor(async () => evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a')).filter((link) => {
      try { return new URL(link.href).pathname === ${JSON.stringify(receivedLinkPath)}; }
      catch { return false; }
    });
    return location.pathname === '/' && links.length === 1 && links[0].innerText.includes(${JSON.stringify(inviteeDropSubject)})
      ? { count: links.length, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }
      : false;
    })()`), 'the owner’s Home inbox to show the new friend drop exactly once');
  } catch (error) {
    const state = await evaluate(`(() => ({
      path: location.pathname,
      ownerSessionConfirmed: ${JSON.stringify(ownerSessionConfirmed)},
      receivedLinkCount: [...document.querySelectorAll('a')].filter((link) => {
        try { return new URL(link.href).pathname === ${JSON.stringify(receivedLinkPath)}; }
        catch { return false; }
      }).length,
      subjectVisible: document.body.innerText.includes(${JSON.stringify(inviteeDropSubject)}),
      firstDropMessageVisible: document.body.innerText.includes('Your inbox is waiting on its first drop.')
    }))()`);
    throw new Error(`${error.message} Owner Home state=${JSON.stringify(state)}.`);
  }
  assert.equal(ownerHome.count, 1);
  assert.ok(ownerHome.scrollWidth <= ownerHome.width + 1, 'The owner’s new-drop card must fit the mobile Home layout.');
  console.log('[browser-first-signup-smoke] PASS the owner signed in separately and saw exactly one first-friend drop on Home at 390x844.');
}

async function saveFirstInviteProfile(handle, displayName, bio) {
  await waitForNewProfileForm();
  await fillBrowserInput('#display-name', displayName);
  await fillBrowserInput('#username', handle);
  await fillBrowserInput('#bio', bio);
  await clickButton('Save & sync handle');
  await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && location.search === '?invite=1'
    && new URLSearchParams(location.search).get('invite') === '1'
    && !new URLSearchParams(location.search).has('next')
    && document.querySelector('#invite-share-title') !== null
    && [...document.querySelectorAll('button')].some((button) => button.innerText.trim().toLocaleLowerCase() === ${JSON.stringify(`share @${handle}`)} && !button.disabled)`), 'the synced first-use profile to show the invite-share controls');
}

async function revealClaimedText(fixture, handoffId) {
  await waitForClaimUiState(async () => evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.id}`)}
    && document.body.innerText.includes(${JSON.stringify(fixture.subject)})
    && [...document.querySelectorAll('button')].some((button) => button.innerText.trim().toLocaleLowerCase() === 'reveal fragments' && !button.disabled)`), 'the claimed drop page before reveal', handoffId);
  const sealed = await evaluate(`(() => ({
    path: location.pathname,
    hasContent: document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(fixture.content.toLocaleLowerCase())}),
    bodyExists: Boolean(document.querySelector('#letter-body')),
  }))()`);
  assert.equal(sealed.path, `/letter/${fixture.id}`);
  assert.equal(sealed.hasContent, false, 'The recipient must explicitly reveal the claimed note.');
  assert.equal(sealed.bodyExists, false, 'The note body must stay closed until the reveal action.');
  await clickButton('Reveal fragments');
  await waitForClaimUiState(async () => evaluate(`location.pathname === ${JSON.stringify(`/letter/${fixture.id}`)}
    && [...document.querySelectorAll('button')].some((button) => button.innerText.trim().toLocaleLowerCase() === 'open received drop')`), 'the recipient reveal confirmation', handoffId);
  await clickButton('Open received drop');
  await waitFor(async () => evaluate(`document.querySelector('#letter-body')?.innerText.includes(${JSON.stringify(fixture.content)})`), 'the opened text drop content');
  const openedText = await evaluate(`document.querySelector('#letter-body')?.innerText || ''`);
  assert.ok(openedText.includes(fixture.content), 'The opened text drop must show its full content.');
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(fixture.subject)})`), true, 'The opened text drop must show its subject.');
}

async function stopOwnedProcess(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error(`Could not stop this smoke’s ${label} process.`);
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(10_000).then(() => false),
  ]);
  if (exited) return true;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw new Error(`Could not force-stop this smoke’s ${label} process.`);
  }
  const stopped = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ]);
  if (!stopped) throw new Error(`This smoke’s ${label} process did not exit.`);
  return true;
}

async function cleanup() {
  pageCdp?.close();
  browserCdp?.close();
  let ownedProcessesStopped = true;
  for (const child of browserProcesses) {
    if (!child) continue;
    try { await stopOwnedProcess(child, 'isolated browser'); }
    catch {
      ownedProcessesStopped = false;
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not stop its isolated browser process.');
    }
  }
  if (app) {
    try { await stopOwnedProcess(app, 'isolated Next.js app'); }
    catch {
      ownedProcessesStopped = false;
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not stop its isolated Next.js app process.');
    }
  }
  try { await deleteExactMailpitMessage(); }
  catch {
    cleanupFailed = true;
    console.error('[browser-first-signup-smoke] CLEANUP FAILED: the exact disposable Mailpit message could not be removed.');
  }

  if (admin && inviteeEmail) {
    try {
      const invitee = inviteeUserId ? { id: inviteeUserId } : await findDisposableUser(inviteeEmail);
      if (invitee?.id && sender?.id && inviteeDropSubject && inviteeDropContent) {
        const { data: matches, error: lookupError } = await admin.from('letters')
          .select('id, sender_id')
          .eq('sender_id', invitee.id)
          .eq('recipient_id', sender.id)
          .eq('subject', inviteeDropSubject)
          .eq('content', inviteeDropContent)
          .limit(2);
        if (lookupError || (matches || []).length > 1) throw new Error('ambiguous exact first-friend send lookup');
        const target = matches?.[0];
        if (target) {
          const { error: deleteError } = await admin.from('letters').delete()
            .eq('id', target.id)
            .eq('sender_id', invitee.id)
            .eq('recipient_id', sender.id);
          if (deleteError) throw new Error('exact first-friend send delete failed');
          const { data: remaining, error: verifyError } = await admin.from('letters')
            .select('id')
            .eq('id', target.id)
            .eq('sender_id', invitee.id)
            .eq('recipient_id', sender.id)
            .maybeSingle();
          if (verifyError || remaining) throw new Error('exact first-friend send still exists');
          inviteeDropCleanupDeleted += 1;
        }
      }
      inviteeDropCleanupVerified = true;
    } catch {
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: the exact invited-friend send could not be removed.');
    }
  }

  if (admin && sender?.id && (dropFixture?.id || (dropSubject && dropContent))) {
    try {
      let query = admin.from('letters')
        .select('id, sender_id')
        .eq('sender_id', sender.id);
      query = dropFixture?.id
        ? query.eq('id', dropFixture.id)
        : query.eq('subject', dropSubject).eq('content', dropContent);
      const { data: matches, error: lookupError } = await query.limit(2);
      if (lookupError || (matches || []).length > 1) throw new Error('ambiguous exact letter lookup');
      const target = matches?.[0];
      if (target) {
        const { error: deleteError } = await admin.from('letters')
          .delete()
          .eq('id', target.id)
          .eq('sender_id', sender.id);
        if (deleteError) throw new Error('exact letter delete failed');
        const { data: remaining, error: verifyError } = await admin.from('letters')
          .select('id')
          .eq('id', target.id)
          .eq('sender_id', sender.id)
          .maybeSingle();
        if (verifyError || remaining) throw new Error('exact letter still exists');
        dropCleanupDeleted += 1;
      }
      dropCleanupVerified = true;
    } catch {
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: the exact disposable text drop could not be removed.');
    }
  }

  if (admin) {
    const targets = new Map(createdUsers.map((candidate) => [candidate.id, candidate.email]));
    if (email) {
      try {
        const recipient = userId ? { id: userId, email } : await findDisposableUser(email);
        if (recipient?.id) targets.set(recipient.id, recipient.email || email);
      } catch {
        cleanupFailed = true;
        console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not resolve the exact public-signup Auth user.');
      }
    }
    if (inviteeEmail) {
      try {
        const invitee = inviteeUserId ? { id: inviteeUserId, email: inviteeEmail } : await findDisposableUser(inviteeEmail);
        if (invitee?.id) targets.set(invitee.id, invitee.email || inviteeEmail);
      } catch {
        cleanupFailed = true;
        console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not resolve the exact invited-friend Auth user.');
      }
    }
    for (const [id, targetEmail] of targets) {
      try {
        const { data: existingUser, error: lookupError } = await admin.auth.admin.getUserById(id);
        if (lookupError && !/not found/i.test(lookupError.message || '')) throw new Error('Auth lookup failed');
        if (existingUser?.user) {
          const { error: deleteError } = await admin.auth.admin.deleteUser(id);
          if (deleteError) throw new Error('Auth delete failed');
        }
        const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
        if (profileError || profile) throw new Error('profile still exists');
        profileCleanupVerified += 1;
        if (targetEmail && await findDisposableUser(targetEmail)) throw new Error('exact Auth user still exists');
        authCleanupVerified += 1;
      } catch {
        cleanupFailed = true;
        console.error('[browser-first-signup-smoke] CLEANUP FAILED: an exact disposable Auth/profile pair could not be removed.');
      }
    }
  }
  if (temporaryRoot && ownedProcessesStopped) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not remove its isolated app and browser profile.');
    }
  } else if (temporaryRoot && !ownedProcessesStopped) {
    console.error('[browser-first-signup-smoke] Preserved its temporary directory because an owned child process may still be running.');
  }
  if (!cleanupFailed) {
    console.log(`[browser-first-signup-smoke] CLEANUP VERIFIED exactClaimDropAbsent=${dropCleanupVerified} exactClaimDropsDeleted=${dropCleanupDeleted} exactInviteeSendAbsent=${inviteeDropCleanupVerified} exactInviteeSendsDeleted=${inviteeDropCleanupDeleted} disposableAuthUsersAbsent=${authCleanupVerified} profilesAbsent=${profileCleanupVerified} recipientMailpitMessagesAbsent=${mailpitCleanupVerified} recipientMailpitMessagesDeleted=${mailpitCleanupDeleted} temporaryDirectoryRemoved=${Boolean(temporaryRoot && ownedProcessesStopped)}.`);
  }
}

async function main() {
  // Confirm port ownership before any app, browser, or account side effects.
  await assertPortAvailable(APP_PORT);
  const envText = await readFile(resolve(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => {
    throw new Error('Create .env.local from the local Supabase CLI output before running this smoke.');
  });
  const localValues = parseEnvFile(envText);
  const supabaseUrl = requireLoopbackSupabaseUrl(localValues.NEXT_PUBLIC_SUPABASE_URL || '');
  assertTrustedLocalSupabaseListener(54321);
  localSupabaseOrigin = supabaseUrl.origin;
  parseLocalMailpitUrl(MAILPIT_ORIGIN);
  assertTrustedLocalSupabaseListener(54324);
  const anonKey = localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = localValues.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(anonKey && serviceRoleKey, '.env.local must contain local anon and service-role keys.');
  localAnonKey = anonKey;
  assert.ok(existsSync(resolve(PROJECT_ROOT, 'node_modules/next/dist/bin/next')), 'Install project dependencies before running this smoke.');
  allowedOrigins.add(APP_ORIGIN);
  allowedOrigins.add(supabaseUrl.origin);

  const healthResponse = await fetch(new URL('/auth/v1/health', supabaseUrl), { signal: AbortSignal.timeout(5_000) });
  assert.ok(healthResponse.ok, `Local Supabase Auth health returned HTTP ${healthResponse.status}.`);
  const mailpitHealth = await fetch(`${MAILPIT_API}/messages?limit=1`, { signal: AbortSignal.timeout(5_000) });
  assert.ok(mailpitHealth.ok, `Local Mailpit returned HTTP ${mailpitHealth.status}.`);
  admin = createClient(supabaseUrl.origin, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  email = `drop-first-signup-${randomUUID().replaceAll('-', '').slice(0, 20)}@example.test`;
  inviteeEmail = `drop-first-send-${randomUUID().replaceAll('-', '').slice(0, 20)}@example.test`;
  const handle = `sm${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const displayName = `Pilot ${randomUUID().slice(0, 6)}`;
  const bio = 'First signup private claim smoke profile.';

  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-first-signup-'));
  try {
    await startTemporaryApp(localValues);
    sender = await createDisposableAccount('sender');
    outsider = await createDisposableAccount('outsider');
    await startBrowser('sender-browser');
    await navigate(await generateSenderMagicLink(sender));
    await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
      && location.pathname !== '/auth/callback'`), 'the disposable sender magic-link callback');
    await navigate(`${APP_ORIGIN}/profile`);
    await waitForNewProfileForm(sender.email);
    await navigate(`${APP_ORIGIN}/compose`);
    await createTextClaimInvite();
    console.log('[browser-first-signup-smoke] PASS sender created a private text claim through the composer UI.');
    await closeCurrentBrowser();

    await startBrowser('recipient-browser');
    const { claimHandoffId } = await startUnauthenticatedRecipient();
    await requestInviteSignupFromHome(email);
    const newUser = await waitFor(async () => findDisposableUser(email), 'the Home invite email form to create the exact new local Auth user');
    userId = newUser.id;
    if (!createdUsers.some((candidate) => candidate.id === userId)) createdUsers.push({ id: userId, email });
    const { data: beforeProfile, error: beforeProfileError } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
    assert.ifError(beforeProfileError);
    assert.equal(beforeProfile, null, 'The new recipient account must not already have a profile before first-use setup.');

    const magicLink = await readMagicLinkFromMailpit();
    await navigate(magicLink);
    await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
      && location.pathname === '/profile'
      && location.search === '?invite=1'
      && new URLSearchParams(location.search).get('invite') === '1'
      && !new URLSearchParams(location.search).has('next')`), 'the Mailpit signup callback to preserve /profile?invite=1 without an unrelated next route');
    await waitForNewProfileForm(email);
    const returnedHandoffId = await evaluate(`window.sessionStorage.getItem('drop:claim-handoff-id:v1')`);
    assert.equal(returnedHandoffId, claimHandoffId, 'The original sealed claim handoff must survive signup from the Home invite profile.');
    console.log('[browser-first-signup-smoke] PASS Mailpit signup callback returned to /profile?invite=1 with the sealed claim handoff intact.');

    const recipientHandle = handle;
    const recipientDisplayName = displayName;
    const beforeSyncInviteState = await evaluate(`(() => ({
      inviteShareTitlePresent: Boolean(document.querySelector('#invite-share-title')),
      inviteButtonsPresent: [...document.querySelectorAll('button')].some((button) => /^(share @|copy handle \\+ link)/i.test(button.innerText.trim())),
      inviteContext: new URLSearchParams(location.search).get('invite'),
      hasNext: new URLSearchParams(location.search).has('next'),
    }))()`);
    assert.deepEqual(beforeSyncInviteState, {
      inviteShareTitlePresent: false,
      inviteButtonsPresent: false,
      inviteContext: '1',
      hasNext: false,
    }, 'The invite share controls must stay hidden before the first verified profile sync.');
    const { data: profileBeforeInviteSync, error: profileBeforeInviteSyncError } = await admin.from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    assert.ifError(profileBeforeInviteSyncError);
    assert.equal(profileBeforeInviteSync, null, 'The new profile must not exist remotely before the user saves it.');

    await stubNativeShareForTest();
    assert.equal(await evaluate('window.__dropBrowserE2EShareCallCount || 0'), 0, 'Loading the profile must not open sharing before an explicit user action.');
    await saveFirstInviteProfile(recipientHandle, recipientDisplayName, bio);
    const { data: savedProfile, error: savedProfileError } = await admin.from('profiles')
      .select('id, username, display_name, bio')
      .eq('id', userId)
      .maybeSingle();
    assert.ifError(savedProfileError);
    assert.deepEqual(savedProfile, { id: userId, username: recipientHandle, display_name: recipientDisplayName, bio });

    await clickButton(`Share @${recipientHandle}`);
    await waitFor(async () => evaluate(`window.__dropBrowserE2EShareCallCount === 1
      && document.body.innerText.includes(${JSON.stringify(`Shared @${recipientHandle} and your public profile link.`)})`), 'the explicit public handle share action');
    const sharePayload = await evaluate(`window.__dropBrowserE2EShareDetails || null`);
    assert.deepEqual(sharePayload, {
      keys: ['text', 'title', 'url'],
      title: 'My Drop handle',
      text: `@${recipientHandle}`,
      url: `${APP_ORIGIN}/u/${recipientHandle}`,
    }, 'The share sheet must receive only the public handle and its profile URL.');
    const sharePayloadText = JSON.stringify(sharePayload);
    for (const privateValue of [dropSubject, dropContent, sender.username, outsider.username, email, bio]) {
      assert.equal(sharePayloadText.includes(privateValue), false, 'The public invite share payload must not contain drop, account, or profile details.');
    }
    console.log('[browser-first-signup-smoke] PASS empty Home inbox keyboard-invited a friend, kept invite controls hidden until profile sync, and shared only the public handle and profile URL.');

    await navigate(`${APP_ORIGIN}/claim?handoff=${encodeURIComponent(claimHandoffId)}`);
    await waitForClaimUiState(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
      && location.pathname === '/claim'
      && new URLSearchParams(location.search).get('handoff') === ${JSON.stringify(claimHandoffId)}
      && [...document.querySelectorAll('button')].some((button) => button.innerText.trim().toLocaleLowerCase() === 'claim this drop' && !button.disabled)`), 'the original private claim handoff after the invite share flow', claimHandoffId);

    const { data: beforeClaim, error: beforeClaimError } = await admin.from('letters')
      .select('id, recipient_id, status')
      .eq('id', dropFixture.id)
      .eq('sender_id', sender.id)
      .maybeSingle();
    assert.ifError(beforeClaimError);
    assert.deepEqual(beforeClaim, { id: dropFixture.id, recipient_id: null, status: 'claim_pending' }, 'Profile setup alone must not claim the invite.');
    const { data: outsiderBefore, error: outsiderBeforeError } = await outsider.client.from('letters')
      .select('id')
      .eq('id', dropFixture.id)
      .maybeSingle();
    assert.ifError(outsiderBeforeError);
    assert.equal(outsiderBefore, null, 'An unrelated account must not read an unclaimed private drop.');

    await clickButton('Claim this drop');
    await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
      && location.pathname === ${JSON.stringify(`/letter/${dropFixture.id}`)}`), 'the explicit recipient claim to open the received drop page');
    await revealClaimedText(dropFixture, claimHandoffId);

    const { data: claimedLetter, error: claimedLetterError } = await admin.from('letters')
      .select('id, sender_id, recipient_id, recipient_username, recipient_name, subject, content, status, delivery_mode, payload_kind')
      .eq('id', dropFixture.id)
      .eq('sender_id', sender.id)
      .maybeSingle();
    assert.ifError(claimedLetterError);
    assert.deepEqual(claimedLetter, {
      id: dropFixture.id,
      sender_id: sender.id,
      recipient_id: userId,
      recipient_username: recipientHandle,
      recipient_name: recipientDisplayName,
      subject: dropFixture.subject,
      content: dropFixture.content,
      status: 'delivered',
      delivery_mode: 'instant',
      payload_kind: 'text',
    }, 'The local database must record the claimed text drop for the new profile.');

    const { data: outsiderAfter, error: outsiderAfterError } = await outsider.client.from('letters')
      .select('id')
      .eq('id', dropFixture.id)
      .maybeSingle();
    assert.ifError(outsiderAfterError);
    assert.equal(outsiderAfter, null, 'An unrelated account must not read a claimed private drop.');
    const { data: replay, error: replayError } = await outsider.client.rpc('claim_drop_invite', { p_token: dropFixture.token });
    assert.equal(replayError?.code, '42501', 'An unrelated account must not replay the consumed invite.');
    assert.equal(replay, null);

    await verifySignedOutInviteeFirstSend();

    const { data: confirmedUser, error: confirmedUserError } = await admin.auth.admin.getUserById(userId);
    assert.ifError(confirmedUserError);
    assert.equal(confirmedUser.user.id, userId);
    assert.equal(confirmedUser.user.email?.toLowerCase(), email.toLowerCase());
    assert.equal(blockedExternalOrigins.size, 0, `Unexpected browser origin was blocked: ${[...blockedExternalOrigins].join(', ')}`);
    assert.equal(firewallFailure, false, 'The isolated browser network guard must remain active.');
    assert.deepEqual(consoleErrors, [], 'The first-use browser flow must not produce console errors.');
    assert.deepEqual(exceptions, [], 'The first-use browser flow must not throw page exceptions.');
    console.log('[browser-first-signup-smoke] PASS new recipient completed first profile setup, explicitly claimed, revealed, and opened the text drop.');
  } finally {
    await cleanup();
  }
  if (cleanupFailed) throw new Error('The smoke finished with cleanup failures; see the CLEANUP FAILED message above.');
}

const onSigint = () => active.abort(new Error('Received SIGINT; cleaning up the local first-signup smoke.'));
const onSigterm = () => active.abort(new Error('Received SIGTERM; cleaning up the local first-signup smoke.'));
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

main().then(() => {
  console.log('[browser-first-signup-smoke] PASS exact disposable letter, Auth/profile, and Mailpit cleanup completed; only loopback Supabase/Mailpit were used, and ports 4004 and hosted Supabase were untouched.');
}).catch((error) => {
  active.abort(error);
  console.error(`[browser-first-signup-smoke] FAIL: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});
