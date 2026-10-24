#!/usr/bin/env node

// Local-only first-use claim journey: Docker Supabase -> email link -> profile UI -> explicit claim.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative, sep, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_PORT = 5004;
const SUPABASE_PORT = 54321;
const MAILPIT_PORT = 54324;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const SUPABASE_ORIGIN = `http://127.0.0.1:${SUPABASE_PORT}`;
const MAILPIT_ORIGIN = `http://127.0.0.1:${MAILPIT_PORT}`;
const STEP_TIMEOUT_MS = 30_000;
const localOnlyFetch = (input, init = {}) => fetch(input, { ...init, redirect: 'error' });

const localEnvText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => {
  throw new Error('Create .env.local from the local Supabase CLI output before running this local-only check.');
});
const localEnv = Object.fromEntries(localEnvText.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^(["'])(.*)\1$/, '$2')]] : [];
}));
const supabaseUrl = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('.env.local is missing local Supabase settings.');
const parsedSupabaseUrl = new URL(supabaseUrl);
assert.equal(parsedSupabaseUrl.protocol, 'http:', 'The browser smoke must use local HTTP Supabase.');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(parsedSupabaseUrl.hostname), 'The Supabase URL must be loopback.');
if (parsedSupabaseUrl.username || parsedSupabaseUrl.password || parsedSupabaseUrl.search || parsedSupabaseUrl.hash) {
  throw new Error('The local Supabase URL must not contain credentials, query parameters, or fragments.');
}
assert.equal(parsedSupabaseUrl.origin, SUPABASE_ORIGIN, 'The local Supabase URL must point to the Drop Docker API on port 54321.');
assert.equal(parsedSupabaseUrl.pathname, '/', 'The local Supabase URL must be an origin only.');

const admin = createClient(SUPABASE_ORIGIN, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { fetch: localOnlyFetch },
});

let temporaryRoot;
let appProcess;
let browserProcess;
let browserCdp;
let recipientPage;
let emailMessageId;
let letterId;
let senderId;
let recipientId;
const testAccounts = [];
let appSpawnError;
let browserSpawnError;
let blockedOrigin = null;
const abortController = new AbortController();
const onSignal = (signal) => abortController.abort(new Error(`Received ${signal}; stopping the local claim smoke.`));
process.once('SIGINT', () => onSignal('SIGINT'));
process.once('SIGTERM', () => onSignal('SIGTERM'));

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method} failed in Chrome DevTools.`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {}, message.sessionId || null);
    });
    socket.addEventListener('close', () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Chrome DevTools closed during ${pending.method}.`));
        this.pending.delete(id);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools.')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Chrome DevTools.')); }, { once: true });
    });
    return new CdpConnection(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId = null, timeoutMs = 10_000) {
    const id = ++this.nextId;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Chrome DevTools ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Could not send Chrome DevTools ${method}.`));
      }
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}

function dockerInfo(containerName, expectedImage) {
  let line;
  try {
    line = execFileSync('docker', ['--context', 'rancher-desktop',
      'inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.Config.Image}}', containerName,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`Could not inspect the required local Docker container ${containerName}.`);
  }
  const [status, health, project, image] = line.split('|');
  assert.equal(status, 'running', `${containerName} must be running.`);
  assert.equal(health, 'healthy', `${containerName} must be healthy.`);
  assert.equal(project, 'drop', `${containerName} must belong to the local Drop compose project.`);
  assert.equal(image, expectedImage, `${containerName} must use the expected Supabase image.`);
  return image;
}

async function verifyLocalDockerStack() {
  let context;
  try { context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {
    throw new Error('Docker is not accessible; start the local Rancher Desktop Docker service first.');
  }
  assert.equal(context, 'rancher-desktop', 'The check only accepts the verified local Rancher Desktop context.');
  let contextDetails;
  try {
    contextDetails = JSON.parse(execFileSync('docker', ['--context', 'rancher-desktop', 'context', 'inspect', context], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('Could not inspect the active Rancher Desktop Docker endpoint.');
  }
  const dockerEndpoint = contextDetails[0]?.Endpoints?.docker?.Host;
  if (typeof dockerEndpoint !== 'string') throw new Error('The active Docker context has no inspectable endpoint.');
  if (process.platform === 'win32') {
    if (!/^npipe:\/{4}\.\/pipe\/[a-z0-9._-]+$/i.test(dockerEndpoint)) {
      throw new Error('The Rancher Desktop Docker endpoint must use a local Windows named pipe.');
    }
  } else {
    let endpointUrl;
    try { endpointUrl = new URL(dockerEndpoint); } catch {
      throw new Error('The Rancher Desktop Docker endpoint is not a local Unix socket.');
    }
    if (endpointUrl.protocol !== 'unix:' || endpointUrl.host !== '' || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) {
      throw new Error('The Rancher Desktop Docker endpoint must use a local Unix socket.');
    }
    const socketPath = resolve(decodeURIComponent(endpointUrl.pathname));
    const expectedSocketPath = resolve(homedir(), '.rd', 'docker.sock');
    if (socketPath !== expectedSocketPath) {
      throw new Error('The active Docker endpoint must be Rancher Desktop’s local socket.');
    }
    let socketInfo;
    try { socketInfo = await lstat(socketPath); } catch {
      throw new Error('The Rancher Desktop local Docker socket is unavailable.');
    }
    assert.ok(socketInfo.isSocket(), 'The Rancher Desktop Docker endpoint must resolve to a local socket.');
  }
  dockerInfo('supabase_kong_drop', 'public.ecr.aws/supabase/kong:2.8.1');
  const authImage = dockerInfo('supabase_auth_drop', 'public.ecr.aws/supabase/gotrue:v2.197.0');
  dockerInfo('supabase_db_drop', 'public.ecr.aws/supabase/postgres:17.11.0.004');
  dockerInfo('supabase_inbucket_drop', 'public.ecr.aws/supabase/mailpit:v1.31.3');
  let publishedPorts;
  try {
    publishedPorts = execFileSync('docker', ['--context', 'rancher-desktop', 'port', 'supabase_kong_drop', '8000/tcp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Could not verify the local Drop Supabase Docker port mapping.');
  }
  assert.ok(publishedPorts.split(/\r?\n/).some((line) => line.trim().endsWith(`:${SUPABASE_PORT}`)), 'Local Drop Kong must publish port 54321.');
  let mailPorts;
  try {
    mailPorts = execFileSync('docker', ['--context', 'rancher-desktop', 'port', 'supabase_inbucket_drop', '8025/tcp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Could not verify the local Drop email sink Docker port mapping.');
  }
  assert.ok(mailPorts.split(/\r?\n/).some((line) => line.trim().endsWith(`:${MAILPIT_PORT}`)), 'The local Drop email sink must publish port 54324.');
  const healthResponse = await localOnlyFetch(`${SUPABASE_ORIGIN}/auth/v1/health`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(healthResponse.ok, true, 'The local Drop Auth health endpoint must respond.');
  const health = await healthResponse.json();
  assert.equal(health.name, 'GoTrue', 'The published local API must respond with GoTrue health.');
  assert.equal(health.version, authImage.split(':').at(-1), 'The local health response must match the verified Docker Auth image.');
  console.log('[local-claim-browser-smoke] Verified healthy local Drop Supabase Docker stack.');
}

function findBrowserExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')]
      : ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/') || candidate.includes('\\')) {
        execFileSync(process.platform === 'win32' ? 'where.exe' : 'test', process.platform === 'win32' ? [candidate] : ['-x', candidate], { stdio: 'ignore' });
        return candidate;
      }
      return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    } catch { /* Try another installed browser. */ }
  }
  throw new Error('No installed Chrome, Edge, or Chromium executable is available for the local check.');
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') throw new Error(`Drop test port ${port} is already in use; its owner was left untouched.`);
    throw error;
  });
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function createIsolatedProject() {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'drop-claim-browser-'));
  const projectRoot = join(temporaryRoot, 'app');
  await cp(ROOT, projectRoot, {
    recursive: true,
    filter(source) {
      const path = relative(ROOT, source);
      if (!path) return true;
      const parts = path.split(sep);
      const name = parts.at(-1);
      return !parts.some((part) => ['.git', '.next', '.vercel', 'node_modules'].includes(part))
        && !(parts[0] === 'supabase' && parts[1] === '.temp')
        && !(name.startsWith('.env') && name !== '.env.example');
    },
  });
  await symlink(join(ROOT, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  return projectRoot;
}

function spawnOwned(command, args, options) {
  return spawn(command, args, { ...options, detached: process.platform !== 'win32', stdio: 'ignore' });
}

function killOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch { /* The owned process has already exited. */ }
}

function waitForOwnedExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    let settled = false;
    let timer;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  killOwned(child);
  const stopped = await waitForOwnedExit(child, 5_000);
  if (stopped) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* The owned process has already exited. */ }
  await waitForOwnedExit(child, 2_000);
}

async function waitForApp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (abortController.signal.aborted) throw abortController.signal.reason;
    if (appSpawnError) throw new Error('The isolated local Drop app failed to start.');
    if (appProcess.exitCode !== null) throw new Error('The isolated local Drop app exited before becoming ready.');
    try {
      const response = await localOnlyFetch(`${APP_ORIGIN}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* Wait for local Next.js to be ready. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('The isolated local Drop app did not become ready within 60 seconds.');
}

async function waitForDevTools(profileDirectory) {
  const activePortFile = join(profileDirectory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (abortController.signal.aborted) throw abortController.signal.reason;
    if (browserSpawnError) throw new Error('The isolated browser could not start.');
    if (browserProcess.exitCode !== null) throw new Error('The isolated browser exited before DevTools became ready.');
    try {
      const [portLine, pathLine] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portLine);
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Chrome published an invalid DevTools port.');
      assert.ok(/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(pathLine), 'Chrome published an invalid DevTools browser path.');
      return `ws://127.0.0.1:${port}${pathLine}`;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Chrome did not publish DevToolsActivePort within 15 seconds.');
}

async function evaluate(sessionId, expression) {
  const result = await browserCdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  }, sessionId);
  if (result.exceptionDetails) throw new Error('A local page interaction failed in Chrome.');
  return result.result?.value;
}

function attachRequestGate(sessionId) {
  browserCdp.on('Fetch.requestPaused', (event, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    void (async () => {
      const url = new URL(event.request.url);
      const allowed = url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:'
        || url.origin === APP_ORIGIN || url.origin === SUPABASE_ORIGIN;
      if (!allowed) {
        blockedOrigin = url.origin || url.protocol;
        await browserCdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, sessionId);
        return;
      }
      await browserCdp.send('Fetch.continueRequest', { requestId: event.requestId }, sessionId);
    })().catch(() => { blockedOrigin = 'request-gate-error'; });
  });
}

function assertRequestGate() {
  assert.equal(blockedOrigin, null, `The isolated browser attempted a non-local request (${blockedOrigin || 'unknown'}).`);
}

async function attachPage(url = 'about:blank') {
  const { targetId } = await browserCdp.send('Target.createTarget', { url });
  assert.ok(targetId, 'Chrome did not create an isolated test tab.');
  const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: true });
  assert.ok(sessionId, 'Chrome did not attach the test tab.');
  await browserCdp.send('Page.enable', {}, sessionId);
  await browserCdp.send('Runtime.enable', {}, sessionId);
  await browserCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
  attachRequestGate(sessionId);
  return sessionId;
}

async function waitUntil(sessionId, predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertRequestGate();
    if (abortController.signal.aborted) throw abortController.signal.reason;
    if (await evaluate(sessionId, predicate).catch(() => false)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  const snapshot = await evaluate(sessionId, `(() => {
    const text = document.body?.innerText || '';
    return {
      path: location.pathname,
      ready: document.readyState,
      signInVisible: text.includes('Sign in or create your account'),
      chooseHandleVisible: text.includes('Choose a Drop handle'),
      emailFormVisible: Boolean(document.querySelector('#account-email')),
      profileFormVisible: Boolean(document.querySelector('#username')),
      usernameValue: document.querySelector('#username')?.value || '',
      claimButtonVisible: [...document.querySelectorAll('button')].some((button) => button.innerText.includes('Claim this drop')),
      saveButton: [...document.querySelectorAll('form button[type="submit"]')].map((button) => ({ text: button.innerText.replace(/\\s+/g, ' ').trim(), disabled: button.disabled })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.innerText.replace(/drop-local-claim-[^\\s]+@example\\.test/gi, '[test email]').slice(0, 120)),
      h1: document.querySelector('h1')?.innerText || '',
      bodyLength: text.length,
      accountStatus: ['Checking your Drop account', 'Checking this invite', 'This browser is blocking', 'Sign-in is not available', 'could not be verified']
        .filter((phrase) => text.includes(phrase)),
      controls: [...document.querySelectorAll('a,button')].map((node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 8),
      chooseHandleTarget: (() => {
        const link = [...document.querySelectorAll('a')].find((node) => (node.innerText || '').trim().toLowerCase() === 'choose a drop handle');
        if (!link) return null;
        const href = new URL(link.href);
        return { path: href.pathname, invite: href.searchParams.get('invite'), nextIsClaim: href.searchParams.get('next')?.startsWith('/claim?handoff=') || false };
      })(),
      handoffQueryPresent: new URL(location.href).searchParams.has('handoff'),
      hasValidClaimSessionToken: /^[a-f0-9]{64}$/.test(sessionStorage.getItem('drop:claim-token:v1') || ''),
      hasClaimHandoffSession: Boolean(sessionStorage.getItem('drop:claim-handoff-id:v1')),
      hasStoredClaimHandoff: Object.keys(localStorage).some((key) => key.startsWith('drop:claim-handoff:v1:')),
      inviteCodeMissing: text.includes('This browser does not have the invite code'),
      handoffStorageBlocked: text.includes('blocking the storage needed to keep your invite'),
      appErrorVisible: /Application error|Internal Server Error|Unhandled Runtime Error/i.test(text),
    };
  })()`).catch(() => null);
  throw new Error(`Timed out waiting for ${description}${snapshot ? `; page state=${JSON.stringify(snapshot)}` : ''}.`);
}

async function clickText(sessionId, label) {
  const point = await evaluate(sessionId, `(() => {
    const target = [...document.querySelectorAll('button,a,[role="button"]')]
      .find((node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
    if (!target || target.disabled) return null;
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `Could not find the enabled “${label}” control.`);
  await browserCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId);
  await browserCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
  await browserCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
}

async function fillInput(sessionId, selector, value) {
  const focused = await evaluate(sessionId, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.focus(); node.select?.(); return document.activeElement === node; })()`);
  assert.equal(focused, true, `Could not focus ${selector}.`);
  await browserCdp.send('Input.insertText', { text: value }, sessionId);
}

async function createConfirmedUser(label) {
  const email = `drop-local-claim-${label}-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const account = { label, email, marker: randomUUID(), id: null };
  testAccounts.push(account);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { drop_local_claim_smoke_id: account.marker },
  });
  const id = data?.user?.id;
  if (id) account.id = id;
  if (error || !id) throw new Error(`Could not create disposable local ${label} account.`);
  if (label === 'sender') senderId = id;
  if (label === 'recipient') recipientId = id;
  return { id, email, password };
}

async function recoverTestAccountId(account) {
  if (account.id) return account.id;
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not search for an unconfirmed disposable account during cleanup.');
    const match = (data.users || []).find((user) => user.email?.toLowerCase() === account.email.toLowerCase()
      && user.user_metadata?.drop_local_claim_smoke_id === account.marker);
    if (match) return match.id;
    if ((data.users || []).length < 1000) return null;
  }
  throw new Error('Could not locate the disposable account within the cleanup search limit.');
}

async function localMagicLink(email) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (abortController.signal.aborted) throw abortController.signal.reason;
    const listResponse = await localOnlyFetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=50`, { signal: AbortSignal.timeout(4_000) });
    if (!listResponse.ok) throw new Error('The local email sink did not return its message list.');
    const list = await listResponse.json();
    const message = (list.messages || []).find((item) => (item.To || []).some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()));
    if (message?.ID) {
      emailMessageId = message.ID;
      const response = await localOnlyFetch(`${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent(message.ID)}`, { signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error('The local email sink could not open the disposable sign-in message.');
      const detail = await response.json();
      const html = String(detail.HTML || '').replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&quot;/g, '"');
      const text = String(detail.Text || '');
      const candidates = [
        ...[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
        ...(text.match(/https?:\/\/[^\s<>"']+/g) || []),
      ];
      for (const candidate of candidates) {
        try {
          const link = new URL(candidate);
          if (link.origin === SUPABASE_ORIGIN && link.pathname === '/auth/v1/verify') return link.href;
        } catch { /* Ignore email markup that is not a URL. */ }
      }
      throw new Error('The local sign-in message did not contain the expected Supabase verification link.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error('The local email sink did not receive the disposable sign-in email.');
}

async function getRecipientClientFromBrowser() {
  const session = await evaluate(recipientPage, `(() => {
    for (const key of Object.keys(localStorage)) {
      if (!/^sb-.*-auth-token$/.test(key)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        if (value.access_token && value.refresh_token) return { accessToken: value.access_token, refreshToken: value.refresh_token };
      } catch { /* Ignore unrelated local storage entries. */ }
    }
    return null;
  })()`);
  assert.ok(session?.accessToken && session?.refreshToken, 'The local browser session was not saved after email sign-in.');
  const recipientClient = createClient(SUPABASE_ORIGIN, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: localOnlyFetch,
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  });
  const { data, error } = await recipientClient.auth.getUser();
  if (error || data.user?.id !== recipientId) throw new Error('The browser session does not belong to the disposable recipient.');
  return recipientClient;
}

async function cleanup() {
  const failures = [];
  browserCdp?.close();
  await stopOwned(browserProcess);
  await stopOwned(appProcess);
  if (emailMessageId) {
    try {
      await localOnlyFetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: [emailMessageId] }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch { /* Verify the exact message state even if its deletion response was interrupted. */ }
    try {
      const verification = await localOnlyFetch(`${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent(emailMessageId)}`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (verification.status !== 404) failures.push('the test email still exists or could not be verified');
    } catch { failures.push('the test email was not removed'); }
  }
  if (letterId) {
    try {
      try { await admin.from('letters').delete().eq('id', letterId); } catch { /* Verify exact state after an interrupted delete response. */ }
      const { data, error: verificationError } = await admin.from('letters').select('id').eq('id', letterId).maybeSingle();
      if (verificationError) failures.push('the test drop removal could not be verified');
      if (data) failures.push('the test drop still exists');
    } catch { failures.push('the test drop was not removed'); }
  }
  for (const account of [...testAccounts].reverse()) {
    try {
      const id = await recoverTestAccountId(account);
      if (!id) continue;
      try { await admin.auth.admin.deleteUser(id); } catch { /* Verify exact state after an interrupted delete response. */ }
      const { data, error: verificationError } = await admin.auth.admin.getUserById(id);
      if (verificationError) {
        const isExpectedMissingUser = verificationError.status === 404
          && /user not found/i.test(verificationError.message || '');
        if (!isExpectedMissingUser || data?.user) failures.push('the disposable test account removal could not be verified');
      } else if (data?.user) {
        failures.push('a disposable test account still exists');
      } else {
        failures.push('the disposable test account removal returned no not-found confirmation');
      }
    } catch { failures.push('a disposable test account was not removed'); }
  }
  if (temporaryRoot) {
    try { await rm(temporaryRoot, { recursive: true, force: true }); } catch { failures.push('temporary test files were not removed'); }
  }
  if (failures.length) throw new Error(`Cleanup incomplete: ${[...new Set(failures)].join('; ')}.`);
}

async function run() {
  await verifyLocalDockerStack();
  await assertPortFree(APP_PORT);
  const projectRoot = await createIsolatedProject();
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(SUPABASE|SERVICE_ROLE|ACCESS_TOKEN|SECRET|PASSWORD)/i.test(name)));
  childEnv.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
  childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  childEnv.WATCHPACK_POLLING = 'true';
  const nextBinary = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  appProcess = spawnOwned(process.execPath, [nextBinary, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(APP_PORT)], {
    cwd: projectRoot,
    env: childEnv,
  });
  appProcess.on('error', (error) => { appSpawnError = error; });
  await waitForApp();

  const sender = await createConfirmedUser('sender');
  const recipient = await createConfirmedUser('recipient');
  const senderClient = createClient(SUPABASE_ORIGIN, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: localOnlyFetch },
  });
  const { data: senderSession, error: senderSignInError } = await senderClient.auth.signInWithPassword({ email: sender.email, password: sender.password });
  if (senderSignInError || !senderSession.session) throw new Error('The disposable local sender could not sign in.');
  const { error: senderProfileError } = await senderClient.from('profiles').insert({
    id: sender.id,
    username: `sender_${sender.id.slice(0, 8)}`,
    display_name: 'Smoke sender',
    bio: '',
  });
  if (senderProfileError) throw new Error('The disposable sender profile could not be created.');

  const token = randomBytes(32).toString('hex');
  letterId = `browser-claim-${randomUUID()}`;
  const subject = 'A little note for you';
  const content = `Private local claim content ${randomUUID()}`;
  const { data: issuedId, error: issueError } = await senderClient.rpc('issue_drop_claim_invite', {
    p_letter_id: letterId,
    p_subject: subject,
    p_content: content,
    p_token: token,
  });
  if (issueError || issuedId !== letterId) throw new Error('The local sender could not issue a disposable text invite.');
  const { data: initialDrop, error: initialDropError } = await admin.from('letters')
    .select('id, recipient_id, status, subject, content')
    .eq('id', letterId)
    .maybeSingle();
  if (initialDropError || initialDrop?.status !== 'claim_pending' || initialDrop.recipient_id !== null) {
    throw new Error('The local test invite did not start in its expected private pending state.');
  }

  const browser = findBrowserExecutable();
  const browserProfile = join(temporaryRoot, 'chrome-profile');
  browserProcess = spawnOwned(browser, [
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${browserProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--no-proxy-server',
    'about:blank',
  ]);
  browserProcess.on('error', (error) => { browserSpawnError = error; });
  const browserWebSocketUrl = await waitForDevTools(browserProfile);
  browserCdp = await CdpConnection.connect(browserWebSocketUrl);

  const originalPage = await attachPage();
  await browserCdp.send('Page.navigate', { url: `${APP_ORIGIN}/claim#token=${token}` }, originalPage);
  await waitUntil(originalPage, `location.pathname === '/claim'`, 'the local private claim route');
  await waitUntil(originalPage, `location.hash === '' && new URL(location.href).searchParams.has('handoff')`, 'the claim token being stored and removed from the address');
  await waitUntil(originalPage, `location.pathname === '/claim' && document.body.innerText.toLowerCase().includes('sign in or create your account')`, 'the signed-out private claim page');
  const scrubbedClaimUrl = await evaluate(originalPage, `({ hash: location.hash, hasHandoff: new URL(location.href).searchParams.has('handoff') })`);
  assert.equal(scrubbedClaimUrl.hash, '', 'The bearer token must be removed from the visible address.');
  assert.equal(scrubbedClaimUrl.hasHandoff, true, 'The private claim handoff must be stored for the email return.');
  await clickText(originalPage, 'Sign in or create your account');
  await waitUntil(originalPage, `location.pathname === '/profile' && Boolean(document.querySelector('#account-email'))`, 'the invite profile sign-in form');
  const profileReturnPath = await evaluate(originalPage, `new URLSearchParams(location.search).get('next')`);
  assert.ok(profileReturnPath?.startsWith('/claim?handoff='), 'The sign-in form must retain the private claim handoff.');
  await fillInput(originalPage, '#account-email', recipient.email);
  await clickText(originalPage, 'Continue with email');
  await waitUntil(originalPage, `document.body.innerText.includes('Sign-in link sent. Check your inbox to continue.')`, 'the local email-link confirmation');

  const magicLink = await localMagicLink(recipient.email);
  const magicUrl = new URL(magicLink);
  assert.equal(magicUrl.origin, SUPABASE_ORIGIN, 'The email verification endpoint must be the local Drop Auth service.');
  assert.equal(magicUrl.pathname, '/auth/v1/verify', 'The email must use Supabase Auth verification.');
  const callbackUrl = new URL(magicUrl.searchParams.get('redirect_to') || '');
  assert.equal(callbackUrl.origin, APP_ORIGIN, 'The email redirect must stay on the isolated local Drop app.');
  assert.equal(callbackUrl.pathname, '/auth/callback', 'The email must return through the Drop auth callback.');
  assert.equal(callbackUrl.searchParams.get('invite'), '1', 'The email return must retain private-claim context.');
  assert.equal(callbackUrl.searchParams.get('next'), profileReturnPath, 'The email must preserve the claim handoff through sign-in.');

  recipientPage = originalPage;
  await browserCdp.send('Page.navigate', { url: magicLink }, recipientPage);
  await waitUntil(recipientPage, `location.pathname === '/claim' && document.body.innerText.includes('Choose a Drop handle')`, 'the signed-in recipient claim handoff');
  assert.equal(await evaluate(recipientPage, `document.body.innerText.includes(${JSON.stringify(content)})`), false, 'The private drop content must remain hidden before profile setup and claim.');
  await clickText(recipientPage, 'Choose a Drop handle');
  await waitUntil(recipientPage, `location.pathname === '/profile' && Boolean(document.querySelector('#username')) && Boolean(document.querySelector('details'))`, 'first-use handle setup');
  const optionalInitialState = await evaluate(recipientPage, `(() => ({
    title: document.body.innerText.includes('Set your handle, then claim.'),
    required: document.querySelector('#username')?.required === true,
    optionalOpen: document.querySelector('form details')?.open === true,
    displayName: document.querySelector('#display-name')?.value,
    displayNameRequired: document.querySelector('#display-name')?.required === true,
    bio: document.querySelector('#bio')?.value,
    bioRequired: document.querySelector('#bio')?.required === true,
  }))()`);
  assert.equal(optionalInitialState.title, true, 'The first-use screen should explain handle setup.');
  assert.equal(optionalInitialState.required, true, 'The claim handle should have native required semantics.');
  assert.equal(optionalInitialState.optionalOpen, false, 'Optional profile details should stay collapsed.');
  assert.equal(typeof optionalInitialState.displayName, 'string', 'The optional display name should remain editable.');
  assert.equal(optionalInitialState.displayNameRequired, false, 'The display name must not be required.');
  assert.equal(optionalInitialState.bio, '', 'The bio should remain optional and blank.');
  assert.equal(optionalInitialState.bioRequired, false, 'The bio must not be required.');

  const handle = `claim_${recipient.id.slice(0, 8)}`;
  await fillInput(recipientPage, '#username', handle);
  await clickText(recipientPage, 'Save & sync handle');
  await waitUntil(recipientPage, `location.pathname === '/claim' && document.body.innerText.toLowerCase().includes('your drop profile is ready') && [...document.querySelectorAll('button')].some((button) => button.innerText.toLowerCase().includes('claim this drop') && !button.disabled)`, 'the synced profile returning to the explicit claim step');
  const { data: savedProfile, error: profileReadError } = await admin.from('profiles')
    .select('id, username, display_name, bio')
    .eq('id', recipient.id)
    .maybeSingle();
  if (profileReadError) throw new Error('Could not verify the disposable recipient profile.');
  assert.ok(savedProfile
    && savedProfile.id === recipient.id
    && savedProfile.username === handle
    && savedProfile.display_name === optionalInitialState.displayName
    && savedProfile.bio === optionalInitialState.bio,
  'The rendered first-use profile form must sync while its optional details remain untouched.');
  const { data: beforeClaim, error: beforeClaimError } = await admin.from('letters')
    .select('id, recipient_id, status, content')
    .eq('id', letterId)
    .maybeSingle();
  if (beforeClaimError) throw new Error('Could not verify the pending claim state.');
  assert.equal(beforeClaim?.recipient_id, null, 'Profile setup alone must not attach the pending drop.');
  assert.equal(beforeClaim?.status, 'claim_pending', 'Profile setup alone must not claim the pending drop.');
  assert.equal(await evaluate(recipientPage, `document.body.innerText.includes(${JSON.stringify(content)})`), false, 'The UI must keep the drop content sealed before the explicit claim click.');
  const recipientClient = await getRecipientClientFromBrowser();
  const { data: unreadableBeforeClaim, error: unreadableBeforeClaimError } = await recipientClient.from('letters')
    .select('id, content')
    .eq('id', letterId)
    .maybeSingle();
  if (unreadableBeforeClaimError) throw new Error('The recipient access check failed before claim.');
  assert.equal(unreadableBeforeClaim, null, 'RLS must keep the drop unreadable after profile setup but before claim.');

  await clickText(recipientPage, 'Claim this drop');
  await waitUntil(recipientPage, `location.pathname === ${JSON.stringify(`/letter/${encodeURIComponent(letterId)}`)} && document.body.innerText.includes('Something made its way to you.')`, 'the explicit claim completing');
  assert.equal(await evaluate(recipientPage, `document.body.innerText.includes(${JSON.stringify(content)})`), false, 'The private body remains sealed until the recipient opens it.');
  const { data: afterClaim, error: afterClaimError } = await admin.from('letters')
    .select('id, recipient_id, status, content')
    .eq('id', letterId)
    .maybeSingle();
  if (afterClaimError) throw new Error('Could not verify the claimed drop state.');
  assert.equal(afterClaim?.recipient_id, recipient.id, 'Only the signed-in browser recipient should receive the drop.');
  assert.equal(afterClaim?.status, 'delivered', 'The explicit claim should deliver the drop.');
  const { data: readableAfterClaim, error: readableAfterClaimError } = await recipientClient.from('letters')
    .select('id, content')
    .eq('id', letterId)
    .maybeSingle();
  if (readableAfterClaimError) throw new Error('The recipient access check failed after claim.');
  assert.equal(readableAfterClaim?.content, content, 'RLS should release the drop to the recipient after claim.');
  await clickText(recipientPage, 'Reveal fragments');
  await waitUntil(recipientPage, `document.body.innerText.toLowerCase().includes('open received drop')`, 'the claimed drop reveal action');
  await clickText(recipientPage, 'Open received drop');
  await waitUntil(recipientPage, `document.querySelector('#letter-body')?.innerText.includes(${JSON.stringify(content)})`, 'the recipient opening the claimed drop');
  assertRequestGate();
  console.log('[local-claim-browser-smoke] Passed: email sign-in, required-handle sync with untouched optional details, sealed pre-claim state, explicit claim, and post-claim open.');
}

try {
  await run();
} catch (error) {
  abortController.abort();
  process.exitCode = 1;
  const safeMessage = error instanceof Error ? error.message.replace(/https?:\/\/[^\s"']+/g, '[local URL omitted]') : 'unknown failure';
  console.error(`[local-claim-browser-smoke] Failed: ${safeMessage}`);
} finally {
  try {
    await cleanup();
    console.log('[local-claim-browser-smoke] Removed the test-owned mail, drop, accounts, processes, and temporary files.');
  } catch (error) {
    process.exitCode = 1;
    console.error(`[local-claim-browser-smoke] ${error instanceof Error ? error.message : 'Cleanup failed.'}`);
  }
}
