#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_APP_URL = 'http://127.0.0.1:4004';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MOBILE_VIEWPORTS = [360, 390, 430].map((width) => ({ name: `mobile-${width}`, width, height: 844, deviceScaleFactor: 1, mobile: true }));
const DESKTOP_VIEWPORT = { name: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const FLOW_VIEWPORTS = [...MOBILE_VIEWPORTS, DESKTOP_VIEWPORT];
let activeViewport = MOBILE_VIEWPORTS[1];
const STEP_TIMEOUT_MS = 20_000;
const LABELS = {
  homeDemo: 'Try a demo drop',
  choosePhoto: 'Try a photo',
  chooseGif: 'Try a GIF',
  reveal: 'Reveal demo fragments',
  open: 'Open demo drop',
  senderCopy: 'See your sender copy',
  reaction: 'React with heart hands',
};
const REACTION_BUTTON_LABELS = [
  'React with a purple heart',
  'React with fire',
  'React with a face with tears of joy',
  'React with a face holding back tears',
  'React with heart hands',
];

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
    ? `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, disabled: Boolean(node.disabled), text: (node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim() }; })()`
    : `(() => { const normalize = value => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase(); const node = [...document.querySelectorAll('a,button,[role="button"]')].find(item => normalize(item.innerText || item.textContent).includes(${JSON.stringify(text.toLocaleLowerCase())})); if (!node) return null; node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, disabled: Boolean(node.disabled), text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() }; })()`;
  const target = await evaluate(cdp, expression);
  assert.ok(target, `Could not find the ${text || selector} control.`);
  assert.equal(target.disabled, false, `The ${text || selector} control is disabled.`);
  assert.ok(target.x >= 0 && target.x <= target.viewportWidth && target.y >= 0 && target.y <= target.viewportHeight, `The ${text || selector} control is outside the ${target.viewportWidth}×${target.viewportHeight} viewport at (${target.x}, ${target.y}).`);

  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: target.x, y: target.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } catch (error) {
    throw new Error(`Could not touch ${text || selector} at ${target.viewportWidth}×${target.viewportHeight}: ${error.message}`);
  }
  return target.text;
}

async function setViewport(cdp, viewport) {
  activeViewport = viewport;
  const { name: _name, ...metrics } = viewport;
  await cdp.send('Emulation.setDeviceMetricsOverride', metrics);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile, maxTouchPoints: 1 });
  await sleep(150, interrupted.signal);
}

async function assertNoHorizontalOverflow(cdp, step, expectedWidth = activeViewport.width) {
  const dimensions = await evaluate(cdp, `({
    viewportWidth: window.innerWidth,
    layoutWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body ? document.body.scrollWidth : 0,
    viewportHeight: document.documentElement.clientHeight
  })`);
  assert.ok(dimensions, `${step}: page dimensions were unavailable.`);
  assert.equal(dimensions.viewportWidth, expectedWidth, `${step}: the browser viewport is not ${expectedWidth}px wide.`);
  assert.ok(
    Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= dimensions.layoutWidth,
    `${step}: horizontal overflow detected (layout ${dimensions.layoutWidth}px, document ${dimensions.documentWidth}px, body ${dimensions.bodyWidth}px).`,
  );
}

async function assertResponsiveWidths(cdp, step) {
  const previousViewport = activeViewport;
  for (const viewport of FLOW_VIEWPORTS) {
    await setViewport(cdp, viewport);
    const label = viewport.mobile ? `${viewport.width}px` : `${viewport.width}×${viewport.height} desktop`;
    await assertNoHorizontalOverflow(cdp, `${step} at ${label}`, viewport.width);
  }
  await setViewport(cdp, previousViewport);
}

async function focusControlWithKeyboard(cdp, { name, selector, expectedTag, expectedHref } = {}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const target = await evaluate(cdp, `(() => {
      const active = document.activeElement;
      const label = (active?.getAttribute('aria-label') || active?.innerText || active?.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      const matched = ${selector ? `Boolean(active?.matches(${JSON.stringify(selector)}))` : `Boolean(active?.matches('a,button,[role="button"]')) && label.includes(${JSON.stringify(name.toLocaleLowerCase())})`};
      return matched ? {
        tag: active.tagName,
        href: active.getAttribute('href'),
        label,
        focusVisible: active.matches(':focus-visible'),
      } : null;
    })()`);
    if (target) {
      if (expectedTag) assert.equal(target.tag, expectedTag, `${name || selector} should have the expected semantic element.`);
      if (expectedHref) assert.equal(target.href, expectedHref, `${name || selector} should lead to the expected route.`);
      assert.equal(target.focusVisible, true, `${name || selector} should show its keyboard focus indicator.`);
      return;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  }
  throw new Error(`Could not reach ${name || selector} with the keyboard.`);
}

async function activateFocusedControl(cdp, key) {
  const code = key === ' ' ? 'Space' : key;
  const keyCode = key === 'Enter' ? 13 : 32;
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

function normalizedVisibleText(text) {
  return `document.body?.innerText.replace(/\\s+/g, ' ').toLocaleLowerCase().includes(${JSON.stringify(text.toLocaleLowerCase())}) || false`;
}

function screenshotDirectoryFromEnv() {
  const configured = process.env.DROP_BROWSER_SCREENSHOT_DIR;
  if (!configured) return null;
  const directory = resolve(configured);
  const pathFromProject = relative(PROJECT_ROOT, directory);
  const isInsideProject = pathFromProject === '' || (pathFromProject !== '..' && !pathFromProject.startsWith(`..${sep}`) && !isAbsolute(pathFromProject));
  assert.equal(isInsideProject, false, 'Set DROP_BROWSER_SCREENSHOT_DIR outside the repository.');
  return directory;
}

async function captureScreenshot(cdp, directory, name) {
  if (!directory) return;
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const path = join(directory, `${name}.png`);
  await writeFile(path, Buffer.from(result.data, 'base64'), { flag: 'wx' });
  console.log(`[browser-demo-smoke] Screenshot: ${path}`);
}

async function assertNoFrameworkOverlay(cdp, step) {
  const overlayText = await evaluate(cdp, `(() => {
    const text = document.body?.innerText || '';
    const match = text.match(/(?:Unhandled Runtime Error|Application error: a client-side exception|Build Error|Internal Server Error)/i);
    return match?.[0] || '';
  })()`);
  assert.equal(overlayText, '', `${step}: framework error overlay text was visible (${overlayText}).`);
}

async function activateFlowControl(cdp, { keyboard, name, selector, expectedTag, expectedHref }) {
  if (keyboard) {
    await focusControlWithKeyboard(cdp, { name, selector, expectedTag, expectedHref });
    await activateFocusedControl(cdp, expectedTag === 'BUTTON' || selector ? ' ' : 'Enter');
  } else {
    await tapControl(cdp, { text: name, selector });
  }
}

async function runDemoFlow(cdp, {
  appUrl,
  viewport,
  payload,
  keyboard,
  screenshotDir,
  screenshotSteps = new Set(),
  checkResponsive = false,
  getPageLoadEvents,
}) {
  const prefix = viewport.name;
  const capture = async (step) => {
    if (screenshotSteps.has(step)) await captureScreenshot(cdp, screenshotDir, `${prefix}-${step}`);
  };
  const checkWidth = async (step) => {
    if (checkResponsive && ['Home', 'Demo chooser'].includes(step)) await assertResponsiveWidths(cdp, step);
    else await assertNoHorizontalOverflow(cdp, step, viewport.width);
  };

  await setViewport(cdp, viewport);
  await cdp.send('Page.navigate', { url: appUrl.href });
  await waitUntil(cdp, `Home with “${LABELS.homeDemo}”`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(LABELS.homeDemo)} && location.pathname === '/'`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Home');
  await checkWidth('Home');
  await capture('home');
  await activateFlowControl(cdp, { keyboard, name: LABELS.homeDemo, expectedTag: 'A', expectedHref: '/demo' });

  const optionLabel = payload === 'gif' ? LABELS.chooseGif : LABELS.choosePhoto;
  await waitUntil(cdp, `the demo chooser with “${optionLabel}”`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(optionLabel)} && location.pathname === '/demo'`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Demo chooser');
  await checkWidth('Demo chooser');
  await capture('chooser');
  await activateFlowControl(cdp, { keyboard, name: optionLabel, expectedTag: 'BUTTON' });

  await waitUntil(cdp, 'the recipient demo route', async () => (
    await evaluate(cdp, `${normalizedVisibleText('See your drop as the recipient.')} && /^\\/letter\\/[^/]+$/.test(location.pathname)`)
  ));
  const recipientPath = await evaluate(cdp, 'location.pathname');
  await assertNoFrameworkOverlay(cdp, 'Recipient preview');
  await assertNoHorizontalOverflow(cdp, 'Recipient preview', viewport.width);
  await capture('recipient');
  await activateFlowControl(cdp, { keyboard, name: LABELS.reveal, expectedTag: 'BUTTON' });

  await waitUntil(cdp, `“${LABELS.open}”`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(LABELS.open)} && !document.querySelector('#letter-fragments')?.innerText.includes('confidential fragment')`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Fragments revealed');
  await assertNoHorizontalOverflow(cdp, 'Fragments revealed', viewport.width);
  await capture('fragments-revealed');
  await activateFlowControl(cdp, { keyboard, name: LABELS.open, expectedTag: 'BUTTON' });

  const payloadLabel = payload === 'gif' ? 'GIF' : 'Photo';
  await waitUntil(cdp, `the opened ${payloadLabel.toLowerCase()} and reaction controls`, async () => (
    await evaluate(cdp, `Boolean(document.querySelector('#letter-body img')?.complete && document.querySelector('#letter-body img')?.naturalWidth > 0) && document.querySelector('#letter-body')?.innerText.toLocaleLowerCase().includes(${JSON.stringify(payloadLabel.toLocaleLowerCase())}) && Boolean(document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)}))`)
  ));
  const reactionLabels = await evaluate(cdp, `Array.from(document.querySelectorAll('section[aria-labelledby="drop-reaction-heading"] button')).map(button => button.getAttribute('aria-label'))`);
  assert.deepEqual(reactionLabels, REACTION_BUTTON_LABELS, 'Every reaction button should expose a descriptive spoken name.');
  await assertNoFrameworkOverlay(cdp, `Opened ${payloadLabel} drop`);
  await assertNoHorizontalOverflow(cdp, `Opened ${payloadLabel} drop`, viewport.width);
  await activateFlowControl(cdp, { keyboard, selector: `[aria-label="${LABELS.reaction}"]`, expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'the saved reaction state', async () => (
    await evaluate(cdp, `document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)})?.getAttribute('aria-pressed') === 'true' && ${normalizedVisibleText('Saved on this device. Open the sender view to see it.')}`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Reaction saved');
  await assertNoHorizontalOverflow(cdp, 'Reaction saved', viewport.width);
  await capture('reaction-saved');

  const previousLoadEvents = getPageLoadEvents();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'a fresh document load after reload', async () => getPageLoadEvents() > previousLoadEvents);
  await waitUntil(cdp, 'the recipient demo after reload', async () => (
    await evaluate(cdp, `${normalizedVisibleText('See your drop as the recipient.')} && location.pathname === ${JSON.stringify(recipientPath)}`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Recipient demo after reload');
  await assertNoHorizontalOverflow(cdp, 'Recipient demo after reload', viewport.width);
  await activateFlowControl(cdp, { keyboard, name: LABELS.reveal, expectedTag: 'BUTTON' });
  await waitUntil(cdp, `“${LABELS.open}” after reload`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(LABELS.open)} && !document.querySelector('#letter-fragments')?.innerText.includes('confidential fragment')`)
  ));
  await activateFlowControl(cdp, { keyboard, name: LABELS.open, expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'the persisted reaction after reload', async () => (
    await evaluate(cdp, `document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)})?.getAttribute('aria-pressed') === 'true'`)
  ));
  await assertNoHorizontalOverflow(cdp, 'Reaction persisted after reload', viewport.width);
  await activateFlowControl(cdp, { keyboard, name: 'See your sender copy', expectedTag: 'A' });

  await waitUntil(cdp, 'sender copy with the saved reaction', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Your demo copy.')} && ${normalizedVisibleText('They reacted 🫶')} && new URL(location.href).searchParams.get('view') === 'sender'`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Sender copy');
  await assertNoHorizontalOverflow(cdp, 'Sender copy', viewport.width);
  await capture('sender-copy');
  assert.equal(await evaluate(cdp, 'location.pathname'), recipientPath, 'Sender copy should keep the same demo drop.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/browser-demo-smoke.mjs [http://127.0.0.1:4004]');
    return;
  }

  const appUrl = parseAppUrl(process.argv[2] || DEFAULT_APP_URL);
  if (typeof WebSocket !== 'function') throw new Error('This smoke check needs a Node runtime with the built-in WebSocket API.');
  const screenshotDir = screenshotDirectoryFromEnv();
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const chromeExecutable = findChromeExecutable();
  const profileDir = await mkdtemp(join(tmpdir(), 'drop-browser-demo-'));
  let chrome;
  let spawnError;
  let browserCdp;
  let pageCdp;
  let firewallFailure;
  const blockedOrigins = new Set();
  const forbiddenRequests = [];
  const pageExceptions = [];
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
    pageCdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      pageExceptions.push(exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown browser exception');
    });

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
      pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
    ]);
    await setViewport(pageCdp, MOBILE_VIEWPORTS[1]);

    console.log(`[browser-demo-smoke] Chrome: ${chromeExecutable}`);
    console.log(`[browser-demo-smoke] App: ${appUrl.origin}; full-flow viewports: ${FLOW_VIEWPORTS.map(({ name }) => name).join(', ')}.`);

    const screenshotSteps = new Set(['home', 'chooser', 'recipient', 'fragments-revealed', 'reaction-saved', 'sender-copy']);
    for (const viewport of FLOW_VIEWPORTS) {
      const keyboard = viewport.width !== 360;
      await runDemoFlow(pageCdp, {
        appUrl,
        viewport,
        payload: 'gif',
        keyboard,
        screenshotDir: viewport.width === 390 || !viewport.mobile ? screenshotDir : null,
        screenshotSteps: screenshotDir && (viewport.width === 390 || !viewport.mobile) ? screenshotSteps : new Set(),
        checkResponsive: viewport.width === 360,
        getPageLoadEvents: () => pageLoadEvents,
      });
      console.log(`[browser-demo-smoke] PASS ${keyboard ? 'keyboard' : 'touch'} GIF flow at ${viewport.width}×${viewport.height}${viewport.mobile ? '' : ' desktop'}.`);
    }

    await runDemoFlow(pageCdp, {
      appUrl,
      viewport: MOBILE_VIEWPORTS[1],
      payload: 'photo',
      keyboard: true,
      screenshotDir: null,
      getPageLoadEvents: () => pageLoadEvents,
    });
    assert.deepEqual(forbiddenRequests, [], `The local demo made forbidden auth, RPC, or Storage write requests: ${JSON.stringify(forbiddenRequests)}.`);
    assert.deepEqual(pageExceptions, [], `The browser reported JavaScript exceptions: ${JSON.stringify(pageExceptions)}.`);
    if (firewallFailure) throw new Error(`The browser network gate failed: ${firewallFailure.message}`);

    console.log('[browser-demo-smoke] PASS photo flow at 390×844, including saved reaction, reload persistence, and sender copy.');
    console.log('[browser-demo-smoke] PASS no horizontal overflow on Home and demo chooser at 360, 390, 430px and 1440×900.');
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
  console.error(`[browser-demo-smoke] FAIL: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});
