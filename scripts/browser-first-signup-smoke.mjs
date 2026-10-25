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
let appError = '';
let browserError = '';
let browserSpawnError;
let appSpawnError;
let email = '';
let userId = '';
let mailpitMessageId = '';
let localSupabaseOrigin = '';
let cleanupFailed = false;
let firewallFailure = false;
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

function observeNetwork() {
  pageCdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    let origin = '';
    try { origin = new URL(request.url).origin; } catch { /* Invalid URLs are blocked below. */ }
    const allowed = allowedOrigins.has(origin);
    if (!allowed) blockedExternalOrigins.add(origin || '[invalid-url]');
    const method = allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest';
    const params = allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' };
    void pageCdp.send(method, params).catch((error) => {
      // Chrome can retire a paused request while a same-origin navigation is
      // replacing it. External origins are still blocked by the resolver rule.
      if (!/Invalid InterceptionId/i.test(error.message)) firewallFailure = true;
    });
  });
  pageCdp.on('Runtime.exceptionThrown', () => exceptions.push('browser exception'));
  pageCdp.on('Runtime.consoleAPICalled', ({ type }) => {
    if (type === 'error') consoleErrors.push('browser console error');
  });
}

async function startBrowser() {
  if (typeof WebSocket !== 'function') throw new Error('This smoke needs Node with the built-in WebSocket API.');
  const executable = findChromeExecutable();
  const profile = join(temporaryRoot, 'chrome-profile');
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
  chrome.on('error', (error) => { browserSpawnError = error; });
  chrome.stderr.on('data', (chunk) => { browserError = `${browserError}${chunk.toString('utf8')}`.slice(-8_000); });
  const devTools = await waitForDevTools(profile);
  browserCdp = await CdpConnection.connect(`ws://127.0.0.1:${devTools.port}${devTools.path}`, active.signal);
  const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
  pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, active.signal);
  observeNetwork();
  await Promise.all([
    pageCdp.send('Page.enable'),
    pageCdp.send('Runtime.enable'),
    pageCdp.send('Network.enable'),
    pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
  ]);
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

async function findDisposableUser() {
  if (!admin || !email) return null;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not check for the exact disposable local Auth user.');
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error('The local Auth user list exceeded the safety limit for exact cleanup.');
}

async function waitForMailpitMessage() {
  return waitFor(async () => {
    const response = await fetch(`${MAILPIT_API}/messages?limit=100`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Local Mailpit returned HTTP ${response.status}.`);
    const result = await response.json();
    const message = result.messages?.find((candidate) =>
      (candidate.To || []).some((recipient) => (recipient.Address || '').toLowerCase() === email.toLowerCase()));
    if (!message) return false;
    mailpitMessageId = message.ID;
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

async function readMagicLinkFromMailpit() {
  const response = await fetch(`${MAILPIT_API}/message/${encodeURIComponent(mailpitMessageId)}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Local Mailpit message retrieval returned HTTP ${response.status}.`);
  const message = await response.json();
  const url = extractMagicLink(message);
  assert.equal(url.searchParams.get('type'), 'magiclink', 'The email link must be a Supabase magic link.');
  const redirect = new URL(url.searchParams.get('redirect_to') || '');
  assert.equal(redirect.origin, APP_ORIGIN, 'The email link must return to the isolated app on loopback.');
  assert.equal(redirect.pathname, '/auth/callback', 'The email link must return through the app auth callback.');
  return url.href;
}

async function deleteExactMailpitMessage() {
  if (!mailpitMessageId && email) {
    const response = await fetch(`${MAILPIT_API}/messages?limit=100`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Mailpit did not return the local message list for cleanup.');
    const result = await response.json();
    const message = result.messages?.find((candidate) =>
      (candidate.To || []).some((recipient) => (recipient.Address || '').toLowerCase() === email.toLowerCase()));
    mailpitMessageId = message?.ID || '';
  }
  if (!mailpitMessageId) return;
  const response = await fetch(`${MAILPIT_API}/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: [mailpitMessageId] }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('Mailpit did not delete the exact disposable message.');
  const check = await fetch(`${MAILPIT_API}/message/${encodeURIComponent(mailpitMessageId)}`, { signal: AbortSignal.timeout(5_000) });
  if (check.status !== 404) throw new Error('The exact disposable Mailpit message still exists after cleanup.');
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

async function waitForNewProfileForm() {
  return waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
    && location.pathname === '/profile'
    && document.querySelector('#display-name') !== null
    && document.querySelector('#account-email') === null
    && document.body.innerText.includes(${JSON.stringify(`Connected as ${email}.`)})
    && !document.querySelector('#display-name').disabled`), 'the signed-in first-use profile form');
}

async function saveFirstProfile(handle, displayName, bio) {
  await fillBrowserInput('#display-name', displayName);
  await fillBrowserInput('#username', handle);
  await fillBrowserInput('#bio', bio);
  await evaluate(`(() => {
    const form = document.querySelector('#display-name')?.closest('form');
    if (!form) return false;
    form.requestSubmit(form.querySelector('button[type="submit"]'));
    return true;
  })()`);
  await waitFor(async () => evaluate(`location.pathname === '/profile'
    && [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Saved & synced'))`), 'the new profile to save and sync');
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
  for (const [child, label] of [[chrome, 'isolated browser'], [app, 'isolated Next.js app']]) {
    if (!child) continue;
    try { await stopOwnedProcess(child, label); }
    catch {
      cleanupFailed = true;
      console.error(`[browser-first-signup-smoke] CLEANUP FAILED: could not stop its ${label} process.`);
    }
  }
  try { await deleteExactMailpitMessage(); }
  catch {
    cleanupFailed = true;
    console.error('[browser-first-signup-smoke] CLEANUP FAILED: the exact disposable Mailpit message could not be removed.');
  }
  if (admin && email) {
    try {
      const candidate = userId ? { id: userId } : await findDisposableUser();
      if (candidate?.id) {
        const { error } = await admin.auth.admin.deleteUser(candidate.id);
        if (error) throw new Error('delete failed');
        const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('id', candidate.id).maybeSingle();
        if (profileError || profile) throw new Error('profile cleanup did not complete');
        const remainingUser = await findDisposableUser();
        if (remainingUser) throw new Error('Auth cleanup did not complete');
      }
    } catch {
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: exact disposable Auth/profile cleanup did not complete.');
    }
  }
  if (temporaryRoot) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); }
    catch {
      cleanupFailed = true;
      console.error('[browser-first-signup-smoke] CLEANUP FAILED: could not remove its isolated app and browser profile.');
    }
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
  localSupabaseOrigin = supabaseUrl.origin;
  parseLocalMailpitUrl(MAILPIT_ORIGIN);
  const anonKey = localValues.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = localValues.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(anonKey && serviceRoleKey, '.env.local must contain local anon and service-role keys.');
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

  const handle = `sm${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const displayName = `Pilot ${randomUUID().slice(0, 6)}`;
  const bio = 'First signup smoke profile.';

  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-first-signup-'));
  try {
    await startTemporaryApp(localValues);
    await startBrowser();
    await navigate(`${APP_ORIGIN}/profile`);
    await waitFor(async () => evaluate(`location.origin === ${JSON.stringify(APP_ORIGIN)}
      && location.pathname === '/profile'
      && document.querySelector('#account-email') !== null`), 'the first-use profile sign-in form');

    await fillBrowserInput('#account-email', email);
    await evaluate(`(() => {
      const form = document.querySelector('#account-email')?.closest('form');
      if (!form) return false;
      form.requestSubmit(form.querySelector('button[type="submit"]'));
      return true;
    })()`);
    await waitFor(async () => evaluate(`document.body.innerText.includes('Sign-in link sent. Check your inbox to continue.')`), 'the app to accept the email sign-in request');
    console.log('[browser-first-signup-smoke] PASS email form accepted a new local account.');

    await waitForMailpitMessage();
    const newUser = await waitFor(async () => findDisposableUser(), 'the new local Auth user to appear');
    userId = newUser.id;
    const { data: beforeProfile, error: beforeProfileError } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
    assert.ifError(beforeProfileError);
    assert.equal(beforeProfile, null, 'The new account must not already have a profile before first-use setup.');

    const magicLink = await readMagicLinkFromMailpit();
    await navigate(magicLink);
    await waitForNewProfileForm();
    console.log('[browser-first-signup-smoke] PASS browser opened the Mailpit magic link and returned to the new account.');

    await saveFirstProfile(handle, displayName, bio);
    const { data: savedProfile, error: savedProfileError } = await admin.from('profiles')
      .select('id, username, display_name, bio')
      .eq('id', userId)
      .maybeSingle();
    assert.ifError(savedProfileError);
    assert.deepEqual(savedProfile, { id: userId, username: handle, display_name: displayName, bio });

    const { data: confirmedUser, error: confirmedUserError } = await admin.auth.admin.getUserById(userId);
    assert.ifError(confirmedUserError);
    assert.equal(confirmedUser.user.id, userId);
    assert.equal(confirmedUser.user.email?.toLowerCase(), email.toLowerCase());
    assert.equal(blockedExternalOrigins.size, 0, `Unexpected browser origin was blocked: ${[...blockedExternalOrigins].join(', ')}`);
    assert.equal(firewallFailure, false, 'The isolated browser network guard must remain active.');
    assert.deepEqual(consoleErrors, [], 'The first-use browser flow must not produce console errors.');
    assert.deepEqual(exceptions, [], 'The first-use browser flow must not throw page exceptions.');
    console.log('[browser-first-signup-smoke] PASS first-use profile was saved to local Supabase and confirmed by an independent admin read.');
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
  console.log('[browser-first-signup-smoke] PASS exact disposable Auth/profile cleanup completed; only loopback Supabase/Mailpit were used, and ports 4004 and hosted Supabase were untouched.');
}).catch((error) => {
  active.abort(error);
  console.error(`[browser-first-signup-smoke] FAIL: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});
