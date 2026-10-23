#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:4004';
const VIEWPORT_WIDTHS = [360, 390, 430];
const FLOW_VIEWPORT_WIDTH = 390;
const VIEWPORT = { width: FLOW_VIEWPORT_WIDTH, height: 844, deviceScaleFactor: 1, mobile: true };
const STEP_TIMEOUT_MS = 20_000;
const LABELS = {
  homeDemo: 'Try a demo drop',
  chooseGif: 'Try a GIF drop',
  reveal: 'Reveal demo fragments',
  open: 'Open demo drop',
  senderCopy: 'See your sender copy',
  reaction: 'React 🫶',
};

const interrupted = new AbortController();
const onSignal = (signal) => interrupted.abort(new Error(`Received ${signal}; stopping the smoke check.`));
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

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
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
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
        this.signal.removeEventListener('abort', pending.onAbort);
        pending.reject(new Error(`DevTools connection closed during ${pending.method}.`));
        this.pending.delete(id);
      }
    });

    socket.addEventListener('error', () => {
      // The close event includes the useful failure context for pending commands.
    });
  }

  static async connect(url, signal) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools.')), 5_000);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Error('Interrupted while connecting to Chrome DevTools.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Could not connect to Chrome DevTools.'));
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
      return Promise.reject(new Error(`DevTools connection is closed before ${method}.`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
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
      this.pending.set(id, { resolve, reject, timer, onAbort, method });
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

function parseAppUrl(rawValue) {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`Invalid app URL: ${rawValue}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('The browser smoke check only accepts an HTTP app URL on this machine (127.0.0.1, localhost, or ::1).');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Pass only the app origin, such as http://127.0.0.1:4004, without credentials, a path, query, or fragment.');
  }
  url.pathname = '/';
  return url;
}

function findChromeExecutable() {
  const candidates = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
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
      } catch {
        // Try the next installed browser path.
      }
    } else {
      try {
        return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      } catch {
        // Try the next executable name on PATH.
      }
    }
  }
  throw new Error('No installed Chrome, Edge, or Chromium executable was found. Install nothing for this check; point the project owner to an existing browser first.');
}

function sleep(ms, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Interrupted.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Interrupted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function waitForDevTools(profileDir, child, getSpawnError, signal) {
  const activePortFile = join(profileDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (signal.aborted) throw signal.reason;
    if (getSpawnError()) throw new Error(`Chrome could not start: ${getSpawnError().message}`);
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (code ${child.exitCode}).`);
    try {
      const [portLine, browserPath] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portLine);
      assert(Number.isInteger(port) && port > 0 && port <= 65_535, 'Chrome wrote an invalid DevTools port.');
      assert(/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(browserPath), 'Chrome wrote an invalid browser DevTools path.');
      return { port, browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}` };
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error;
    }
    await sleep(100, signal);
  }
  throw new Error('Chrome did not publish DevToolsActivePort within 15 seconds.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Chrome DevTools HTTP endpoint returned ${response.status}.`);
  return response.json();
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    throw new Error(`Page inspection failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'JavaScript evaluation error'}`);
  }
  return result.result?.value;
}

async function waitUntil(cdp, description, predicate, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (interrupted.signal.aborted) throw interrupted.signal.reason;
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200, interrupted.signal);
  }
  const snapshot = await evaluate(cdp, `({ pathname: location.pathname, readyState: document.readyState, title: document.title, bodyText: document.body?.innerText.slice(0, 500) || '' })`).catch(() => null);
  throw new Error(`Timed out waiting for ${description}${lastError ? ` (${lastError.message})` : ''}${snapshot ? `; page=${JSON.stringify(snapshot)}` : ''}.`);
}

async function tapControl(cdp, { text, selector }) {
  const expression = selector
    ? `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: Boolean(node.disabled), text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() }; })()`
    : `(() => { const normalize = value => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase(); const node = [...document.querySelectorAll('a,button,[role="button"]')].find(item => normalize(item.innerText || item.textContent) === ${JSON.stringify(text.toLocaleLowerCase())}); if (!node) return null; node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: Boolean(node.disabled), text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() }; })()`;
  const target = await evaluate(cdp, expression);
  assert.ok(target, `Could not find the ${text || selector} control.`);
  assert.equal(target.disabled, false, `The ${text || selector} control is disabled.`);
  assert.ok(target.x >= 0 && target.x <= VIEWPORT.width && target.y >= 0 && target.y <= VIEWPORT.height, `The ${text || selector} control is outside the ${VIEWPORT.width}×${VIEWPORT.height} viewport at (${target.x}, ${target.y}).`);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: target.x, y: target.y, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return target.text;
}

async function setViewportWidth(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width });
  await sleep(150, interrupted.signal);
}

async function assertNoHorizontalOverflow(cdp, step, expectedWidth = FLOW_VIEWPORT_WIDTH) {
  const dimensions = await evaluate(cdp, `({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body ? document.body.scrollWidth : 0,
    viewportHeight: document.documentElement.clientHeight
  })`);
  assert.ok(dimensions, `${step}: page dimensions were unavailable.`);
  assert.equal(dimensions.viewportWidth, expectedWidth, `${step}: the mobile viewport is not ${expectedWidth}px wide.`);
  assert.ok(
    Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= dimensions.viewportWidth,
    `${step}: horizontal overflow detected (viewport ${dimensions.viewportWidth}px, document ${dimensions.documentWidth}px, body ${dimensions.bodyWidth}px).`,
  );
}

async function assertPhoneWidths(cdp, step) {
  for (const width of VIEWPORT_WIDTHS) {
    await setViewportWidth(cdp, width);
    await assertNoHorizontalOverflow(cdp, `${step} at ${width}px`, width);
  }
  await setViewportWidth(cdp, FLOW_VIEWPORT_WIDTH);
}

async function focusControlWithKeyboard(cdp, text) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const target = await evaluate(cdp, `(() => {
      const active = document.activeElement;
      const name = (active?.innerText || active?.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      return name === ${JSON.stringify(text.toLocaleLowerCase())} ? {
        tag: active.tagName,
        href: active.getAttribute('href'),
        focusVisible: active.matches(':focus-visible'),
      } : null;
    })()`);
    if (target) {
      assert.equal(target.tag, 'A', `${text} should be a link available to keyboard users.`);
      assert.equal(target.href, '/demo', `${text} should lead to the demo chooser.`);
      assert.equal(target.focusVisible, true, `${text} should show its keyboard focus indicator.`);
      return;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  }
  throw new Error(`Could not reach ${text} with the keyboard.`);
}

async function activateFocusedControl(cdp, key) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 32, nativeVirtualKeyCode: key === 'Enter' ? 13 : 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 32, nativeVirtualKeyCode: key === 'Enter' ? 13 : 32 });
}

function normalizedVisibleText(text) {
  return `document.body?.innerText.replace(/\\s+/g, ' ').toLocaleLowerCase().includes(${JSON.stringify(text.toLocaleLowerCase())}) || false`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/browser-demo-smoke.mjs [http://127.0.0.1:4004]');
    return;
  }

  const appUrl = parseAppUrl(process.argv[2] || DEFAULT_APP_URL);
  if (typeof WebSocket !== 'function') throw new Error('This smoke check needs a Node runtime with the built-in WebSocket API.');
  const chromeExecutable = findChromeExecutable();
  const profileDir = await mkdtemp(join(tmpdir(), 'drop-browser-demo-'));
  let chrome;
  let spawnError;
  let browserCdp;
  let pageCdp;
  let firewallFailure;
  const blockedOrigins = new Set();
  const forbiddenRequests = [];
  let blockedRequestCount = 0;
  let browserStderr = '';
  let pageTargetId;
  let pageLoadEvents = 0;
  let chromeStopped = false;

  try {
    const hostnameForResolver = appUrl.hostname.replace(/^\[|\]$/g, '');
    const resolverRule = `MAP * ~NOTFOUND, EXCLUDE ${hostnameForResolver}`;
    chrome = spawn(chromeExecutable, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
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
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    chrome.on('error', (error) => { spawnError = error; });
    chrome.stderr.on('data', (chunk) => {
      browserStderr = `${browserStderr}${chunk.toString('utf8')}`.slice(-8_000);
    });

    const devTools = await waitForDevTools(profileDir, chrome, () => spawnError, interrupted.signal);
    const versionInfo = await requestJson(`http://127.0.0.1:${devTools.port}/json/version`);
    assert.equal(typeof versionInfo.webSocketDebuggerUrl, 'string', 'Chrome did not expose its DevTools WebSocket URL.');
    browserCdp = await CdpConnection.connect(devTools.browserWebSocketUrl, interrupted.signal);

    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    pageTargetId = target.id;
    assert.equal(typeof target.webSocketDebuggerUrl, 'string', 'Chrome did not create an isolated page target.');
    pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, interrupted.signal);
    pageCdp.on('Page.loadEventFired', () => { pageLoadEvents += 1; });

    pageCdp.on('Network.requestWillBeSent', ({ request }) => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url);
      } catch {
        return;
      }
      const method = (request.method || 'GET').toUpperCase();
      const path = requestUrl.pathname;
      if (/\/auth\/v1\//i.test(path)
        || /\/rest\/v1\/rpc\//i.test(path)
        || (/\/storage\/v1\//i.test(path) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))) {
        forbiddenRequests.push({ method, path });
      }
    });

    pageCdp.on('Fetch.requestPaused', ({ requestId, request }) => {
      let requestOrigin = 'invalid-origin';
      try {
        requestOrigin = new URL(request.url).origin;
      } catch {
        // Invalid and opaque origins are rejected below.
      }
      const allowed = requestOrigin === appUrl.origin;
      if (!allowed) {
        blockedRequestCount += 1;
        blockedOrigins.add(requestOrigin);
      }
      const decision = allowed
        ? pageCdp.send('Fetch.continueRequest', { requestId })
        : pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      void decision.catch((error) => { firewallFailure = error; });
    });

    await Promise.all([
      pageCdp.send('Page.enable'),
      pageCdp.send('Runtime.enable'),
      pageCdp.send('DOM.enable'),
      pageCdp.send('Network.enable'),
      pageCdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT),
      pageCdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }),
      pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
    ]);

    console.log(`[browser-demo-smoke] Chrome: ${chromeExecutable}`);
    console.log(`[browser-demo-smoke] App: ${appUrl.origin}; phone widths: ${VIEWPORT_WIDTHS.join(', ')}×${VIEWPORT.height}`);
    await pageCdp.send('Page.navigate', { url: appUrl.href });

    await waitUntil(pageCdp, `Home with “${LABELS.homeDemo}”`, async () => (
      await evaluate(pageCdp, `${normalizedVisibleText(LABELS.homeDemo)} && location.pathname === '/'`)
    ));
    await assertPhoneWidths(pageCdp, 'Home');
    await focusControlWithKeyboard(pageCdp, LABELS.homeDemo);
    await activateFocusedControl(pageCdp, 'Enter');

    await waitUntil(pageCdp, `the demo chooser with “${LABELS.chooseGif}”`, async () => (
      await evaluate(pageCdp, `${normalizedVisibleText(LABELS.chooseGif)} && location.pathname === '/demo'`)
    ));
    await assertPhoneWidths(pageCdp, 'Demo chooser');
    await tapControl(pageCdp, { text: LABELS.chooseGif });

    await waitUntil(pageCdp, 'the recipient demo route', async () => (
      await evaluate(pageCdp, `${normalizedVisibleText('See your drop as the recipient.')} && /^\\/letter\\/[^/]+$/.test(location.pathname)`)
    ));
    const recipientPath = await evaluate(pageCdp, 'location.pathname');
    await assertNoHorizontalOverflow(pageCdp, 'Recipient preview');
    await tapControl(pageCdp, { text: LABELS.reveal });
    await waitUntil(pageCdp, `“${LABELS.open}”`, async () => (
      await evaluate(pageCdp, `${normalizedVisibleText(LABELS.open)} && !document.querySelector('#letter-fragments')?.innerText.includes('confidential fragment')`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Fragments revealed');
    await tapControl(pageCdp, { text: LABELS.open });
    await waitUntil(pageCdp, 'the opened GIF and reaction controls', async () => (
      await evaluate(pageCdp, `Boolean(document.querySelector('#letter-body img')?.complete && document.querySelector('#letter-body img')?.naturalWidth > 0) && document.querySelector('#letter-body')?.innerText.includes('GIF') && Boolean(document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)}))`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Opened GIF drop');

    await tapControl(pageCdp, { selector: `[aria-label="${LABELS.reaction}"]` });
    await waitUntil(pageCdp, 'the saved reaction state', async () => (
      await evaluate(pageCdp, `document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)})?.getAttribute('aria-pressed') === 'true' && ${normalizedVisibleText('Saved on this device. Open the sender view to see it.')}`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Reaction saved');

    const previousLoadEvents = pageLoadEvents;
    await pageCdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(pageCdp, 'a fresh document load after reload', async () => pageLoadEvents > previousLoadEvents);
    await waitUntil(pageCdp, 'the recipient demo after reload', async () => (
      await evaluate(pageCdp, `${normalizedVisibleText('See your drop as the recipient.')} && location.pathname === ${JSON.stringify(recipientPath)}`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Recipient demo after reload');
    await tapControl(pageCdp, { text: LABELS.reveal });
    await waitUntil(pageCdp, `“${LABELS.open}” after reload`, async () => (
      await evaluate(pageCdp, `${normalizedVisibleText(LABELS.open)} && !document.querySelector('#letter-fragments')?.innerText.includes('confidential fragment')`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Fragments revealed after reload');
    await tapControl(pageCdp, { text: LABELS.open });
    await waitUntil(pageCdp, 'the persisted reaction after reload', async () => (
      await evaluate(pageCdp, `document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)})?.getAttribute('aria-pressed') === 'true'`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Reaction persisted after reload');
    await tapControl(pageCdp, { text: LABELS.senderCopy });

    await waitUntil(pageCdp, 'sender copy with the saved reaction', async () => (
      await evaluate(pageCdp, `${normalizedVisibleText('Your demo copy.')} && ${normalizedVisibleText('They reacted 🫶')} && new URL(location.href).searchParams.get('view') === 'sender'`)
    ));
    await assertNoHorizontalOverflow(pageCdp, 'Sender copy');
    assert.equal(await evaluate(pageCdp, 'location.pathname'), recipientPath, 'Sender copy should keep the same demo drop.');
    assert.deepEqual(forbiddenRequests, [], `The local demo made forbidden auth, RPC, or Storage write requests: ${JSON.stringify(forbiddenRequests)}.`);
    if (firewallFailure) throw new Error(`The browser network gate failed: ${firewallFailure.message}`);

    console.log('[browser-demo-smoke] PASS keyboard Home → demo chooser → GIF recipient → reveal/open → reaction → reload persistence → sender copy.');
    console.log(`[browser-demo-smoke] PASS no horizontal overflow on Home and demo chooser at ${VIEWPORT_WIDTHS.join(', ')}px; full flow at ${FLOW_VIEWPORT_WIDTH}px.`);
    console.log('[browser-demo-smoke] PASS no Auth, RPC, or Storage write request during the local demo.');
    console.log(`[browser-demo-smoke] Blocked cross-origin requests: ${blockedRequestCount}${blockedOrigins.size ? ` (${[...blockedOrigins].sort().join(', ')})` : ''}.`);
  } finally {
    pageCdp?.close();
    if (browserCdp && !browserCdp.closed) {
      if (pageTargetId) await browserCdp.send('Target.closeTarget', { targetId: pageTargetId }, 1_000).catch(() => undefined);
      await browserCdp.send('Browser.close', {}, 2_000).catch(() => undefined);
    }
    browserCdp?.close();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null && chrome.pid) {
      chromeStopped = await waitForExit(chrome, 4_000);
      if (!chromeStopped) {
        try {
          if (process.platform === 'win32') chrome.kill('SIGTERM');
          else process.kill(-chrome.pid, 'SIGTERM');
        } catch {
          // The owned process may have exited between the status check and signal.
        }
        chromeStopped = await waitForExit(chrome, 3_000);
        if (!chromeStopped) {
          try {
            if (process.platform === 'win32') chrome.kill('SIGKILL');
            else process.kill(-chrome.pid, 'SIGKILL');
          } catch {
            // The owned process may have exited between the status check and signal.
          }
          chromeStopped = await waitForExit(chrome, 2_000);
        }
      }
    } else {
      chromeStopped = true;
    }
    if (chromeStopped) {
      await rm(profileDir, { recursive: true, force: true }).catch((error) => {
        console.error(`[browser-demo-smoke] Could not remove its temporary Chrome profile ${profileDir}: ${error.message}`);
        process.exitCode = 1;
      });
    } else {
      console.error(`[browser-demo-smoke] Could not stop the Chrome child; its temporary profile is preserved at ${profileDir}.`);
      process.exitCode = 1;
    }
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    if (spawnError && browserStderr.trim()) {
      console.error(`[browser-demo-smoke] Chrome diagnostic: ${browserStderr.trim().split(/\r?\n/).slice(-8).join('\n')}`);
    }
  }
}

main().catch((error) => {
  console.error(`[browser-demo-smoke] FAIL: ${error?.message || error}`);
  process.exitCode = 1;
});
