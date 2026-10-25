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
// Keep just above .page-enter's 380ms duration in app/globals.css.
const PAGE_ENTER_SETTLE_MS = 420;
const LABELS = {
  homeDemo: 'Try a demo drop',
  homeSendAccountDisclosure: 'Demo stays on this device · a Drop account is needed to send.',
  choosePhoto: 'Try a photo',
  chooseGif: 'Try a GIF',
  reveal: 'Reveal demo fragments',
  open: 'Open demo drop',
  senderCopy: 'See your sender copy',
  makeForFriend: 'Make one for a friend',
  reaction: 'React with heart hands',
};
const REACTION_BUTTON_LABELS = [
  'React with a purple heart',
  'React with fire',
  'React with a face with tears of joy',
  'React with a face holding back tears',
  'React with heart hands',
];
const CLAIM_RECOVERY_DRAFT = {
  id: '8e1e470c-6f99-47bb-b4c8-2abd9d7dc2f8',
  recipient: 'new.friend',
  subject: 'A note waiting to be claimed',
  content: 'A little note for a friend.',
  fontSize: 18,
  alignment: 'left',
  address: { name: 'A new friend', street: '', city: '', postcode: '', country: '' },
  sealId: 'fern',
  sealColor: '#991b1b',
  sealMonogram: 'D',
  payloadKind: 'text',
  deliveryMode: 'instant',
  status: 'claim_pending',
  updatedAt: '2026-10-24T00:00:00.000Z',
  dispatchedAt: '2026-10-24T00:00:00.000Z',
};
const CLAIM_DETAILS_PATH = `/letter/${encodeURIComponent(CLAIM_RECOVERY_DRAFT.id)}`;
const PROMPT_ACTIVE_DRAFT = {
  id: 'draft-empty-photo-in-progress',
  recipient: '@close.friend',
  subject: 'Keep this attachment',
  content: '',
  fontSize: 18,
  alignment: 'left',
  address: { name: '', street: '', city: '', postcode: '', country: '' },
  sealId: 'fern',
  sealColor: '#991b1b',
  sealMonogram: '',
  payloadKind: 'image',
  deliveryMode: 'instant',
  mediaUploadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'draft',
  updatedAt: '2026-10-24T00:00:00.000Z',
};
const DROP_BACK_RECEIVED_FIXTURE = {
  id: 'drop-back-received-fixture',
  recipient: 'test.recipient',
  sender: 'A friend',
  senderUsername: 'friend.handle',
  direction: 'received',
  date: 'Today',
  status: 'delivered',
  excerpt: 'A tiny note for your day.',
  subject: 'A little hello',
  payloadKind: 'text',
  deliveryMode: 'instant',
  localDemo: true,
};
const SHARE_TARGET_CAPTION = 'A little memory from our group chat ✨';
const SHARE_TARGET_FILENAME = 'drop-share-smoke.png';
const SHARE_IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_TARGET_REPLAY_EDITS = {
  content: 'I edited this caption after saving the shared photo.',
  subject: 'A name added after the import',
  recipient: '@replay.friend',
};
const SHARE_TARGET_PREVIOUS_DRAFT = {
  ...PROMPT_ACTIVE_DRAFT,
  id: 'draft-share-target-preserved',
  subject: 'Keep this earlier photo note',
  content: 'The earlier note should stay with its photo.',
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
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(1_500) });
    } catch (error) {
      lastError = error;
      if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), 500)));
      continue;
    }
    if (!response.ok) throw new Error(`Chrome DevTools HTTP endpoint returned ${response.status}.`);
    return response.json();
  }
  throw new Error(`Could not reach Chrome DevTools at ${new URL(url).pathname}: ${lastError?.message || lastError || 'unknown error'}`);
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
  const snapshot = await evaluate(cdp, `(() => {
    const page = document.querySelector('main.page-enter');
    return {
      pathname: location.pathname,
      readyState: document.readyState,
      title: document.title,
      bodyText: document.body?.innerText.slice(0, 500) || '',
      pageEnter: page ? {
        animation: getComputedStyle(page).animation,
        animations: page.getAnimations().map((animation) => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          playbackRate: animation.playbackRate,
          timing: animation.effect?.getTiming(),
        })),
      } : null,
    };
  })()`).catch(() => null);
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
  return `(document.body?.innerText.replace(/\\s+/g, ' ').toLocaleLowerCase().includes(${JSON.stringify(text.toLocaleLowerCase())}) || false)`;
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

async function waitForPageShell(cdp, step) {
  await waitUntil(cdp, `${step} page shell`, async () => (
    await evaluate(cdp, 'Boolean(document.querySelector("main.page-enter"))')
  ));
  await sleep(PAGE_ENTER_SETTLE_MS, interrupted.signal);
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
  verifyFreshDraft = false,
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
  await waitUntil(cdp, `Home with “${LABELS.homeDemo}” and account disclosure`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(LABELS.homeDemo)} && ${normalizedVisibleText(LABELS.homeSendAccountDisclosure)} && location.pathname === '/'`)
  ));
  await waitForPageShell(cdp, 'Home');
  if (verifyFreshDraft) {
    const seeded = await evaluate(cdp, `(async () => {
      const draft = ${JSON.stringify(PROMPT_ACTIVE_DRAFT)};
      localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify(draft));
      localStorage.setItem('dear-exe:letter-drafts:v1', JSON.stringify([draft]));
      const response = await fetch('/demo-cat.png');
      if (!response.ok) throw new Error('Could not load the local photo fixture.');
      const blob = await response.blob();
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('dear-exe-draft-media', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('attachments');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('attachments', 'readwrite');
          transaction.objectStore('attachments').put({ blob, name: 'demo-cat.png', type: blob.type, lastModified: 1 }, draft.id);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
      return localStorage.getItem('dear-exe:active-letter:v1') === JSON.stringify(draft);
    })()`);
    assert.equal(seeded, true, 'The in-progress media draft and its local attachment should be saved before the demo starts.');
  }
  await assertNoFrameworkOverlay(cdp, 'Home');
  await checkWidth('Home');
  await capture('home');
  await activateFlowControl(cdp, { keyboard, name: LABELS.homeDemo, expectedTag: 'A', expectedHref: '/demo' });

  const optionLabel = payload === 'gif' ? LABELS.chooseGif : LABELS.choosePhoto;
  await waitUntil(cdp, `the demo chooser with “${optionLabel}”`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(optionLabel)} && location.pathname === '/demo'`)
  ));
  await waitForPageShell(cdp, 'Demo chooser');
  await assertNoFrameworkOverlay(cdp, 'Demo chooser');
  await checkWidth('Demo chooser');
  await capture('chooser');
  await activateFlowControl(cdp, { keyboard, name: optionLabel, expectedTag: 'BUTTON' });

  await waitUntil(cdp, 'the recipient demo route', async () => (
    await evaluate(cdp, `${normalizedVisibleText('See your drop as the recipient.')} && /^\\/letter\\/[^/]+$/.test(location.pathname)`)
  ));
  await waitForPageShell(cdp, 'Recipient preview');
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
  if (verifyFreshDraft) {
    await activateFlowControl(cdp, { keyboard, name: 'Skip to sender copy', expectedTag: 'A' });
  } else {
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
    await activateFlowControl(cdp, { keyboard: true, name: LABELS.reveal, expectedTag: 'BUTTON' });
    await waitUntil(cdp, `“${LABELS.open}” after reload`, async () => (
      await evaluate(cdp, `${normalizedVisibleText(LABELS.open)} && !document.querySelector('#letter-fragments')?.innerText.includes('confidential fragment')`)
    ));
    await activateFlowControl(cdp, { keyboard: true, name: LABELS.open, expectedTag: 'BUTTON' });
    await waitUntil(cdp, 'the persisted reaction after reload', async () => (
      await evaluate(cdp, `document.querySelector(${JSON.stringify(`[aria-label="${LABELS.reaction}"]`)})?.getAttribute('aria-pressed') === 'true'`)
    ));
    await assertNoHorizontalOverflow(cdp, 'Reaction persisted after reload', viewport.width);
    await activateFlowControl(cdp, { keyboard: true, name: 'See your sender copy', expectedTag: 'A' });
  }

  await waitUntil(cdp, `sender copy${verifyFreshDraft ? '' : ' with the saved reaction'}`, async () => (
    await evaluate(cdp, `${normalizedVisibleText('Your demo copy.')} && ${verifyFreshDraft ? normalizedVisibleText('Same-device demo · nothing was sent or shared.') : normalizedVisibleText('They reacted 🫶')} && new URL(location.href).searchParams.get('view') === 'sender'`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Sender copy');
  await assertNoHorizontalOverflow(cdp, 'Sender copy', viewport.width);
  await capture('sender-copy');
  assert.equal(await evaluate(cdp, 'location.pathname'), recipientPath, 'Sender copy should keep the same demo drop.');

  if (verifyFreshDraft) {
    const demoId = await evaluate(cdp, `decodeURIComponent(location.pathname.split('/').pop() || '')`);
    await waitUntil(cdp, `the “${LABELS.makeForFriend}” action`, async () => (
      await evaluate(cdp, `${normalizedVisibleText(LABELS.makeForFriend)} && new URL(location.href).searchParams.get('view') === 'sender'`)
    ));
    const friendActionScroll = await evaluate(cdp, `(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => (node.innerText || node.textContent || '').toLocaleLowerCase().includes(${JSON.stringify(LABELS.makeForFriend.toLocaleLowerCase())}));
      if (!button) return null;
      button.scrollIntoView({ block: 'center', behavior: 'instant' });
      const bounds = button.getBoundingClientRect();
      return { scrollY: window.scrollY, top: bounds.top, bottom: bounds.bottom, height: window.innerHeight };
    })()`);
    assert.ok(friendActionScroll && friendActionScroll.top >= 0 && friendActionScroll.bottom <= friendActionScroll.height, `The “${LABELS.makeForFriend}” action should be scrolled into view for the screenshot; found ${JSON.stringify(friendActionScroll)}.`);
    await waitForPageShell(cdp, 'Sender copy');
    await captureScreenshot(cdp, screenshotDir, `${viewport.name}-friend-draft-cta`);
    await activateFlowControl(cdp, { keyboard, name: LABELS.makeForFriend, expectedTag: 'BUTTON' });
    await waitUntil(cdp, 'a fresh editable composer opened from the demo', async () => (
      await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content'))`)
    ));
    await waitForPageShell(cdp, 'Fresh draft from demo');
    const state = await evaluate(cdp, `(() => {
      const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
      const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
      const history = JSON.parse(localStorage.getItem('dear-exe:letter-history:v1') || '[]');
      const editor = document.querySelector('#drop-content');
      const url = new URL(location.href);
      return {
        path: location.pathname,
        routeId: url.searchParams.get('letter'),
        active,
        preserved: drafts.find((draft) => draft.id === ${JSON.stringify(PROMPT_ACTIVE_DRAFT.id)}) || null,
        demo: history.find((letter) => letter.id === ${JSON.stringify(demoId)}) || null,
        editorValue: editor?.value ?? null,
        editorEditable: Boolean(editor && !editor.disabled && !editor.readOnly),
        scrollY: window.scrollY,
      };
    })()`);
    assert.equal(state.path, '/compose');
    assert.equal(state.routeId, state.active?.id, 'The composer should open the new draft by its ID.');
    assert.equal(state.active?.status, 'draft');
    assert.equal(state.active?.recipient, '');
    assert.equal(state.active?.subject, '');
    assert.equal(state.active?.content, '', 'The new draft must not contain demo text.');
    assert.equal(state.active?.payloadKind, 'text', 'The new draft should start as a text drop.');
    assert.equal(state.active?.localDemo, undefined, 'The new draft must not carry demo identity.');
    assert.equal(state.active?.reaction, undefined, 'The new draft must not carry the demo reaction.');
    assert.equal(state.active?.mediaPath, undefined);
    assert.equal(state.active?.mediaMimeType, undefined);
    assert.equal(state.active?.mediaSizeBytes, undefined);
    assert.equal(state.active?.mediaUploadId, undefined);
    assert.equal(state.editorValue, '', 'The composer should be blank and ready for the sender’s own words.');
    assert.equal(state.editorEditable, true);
    assert.ok(state.scrollY <= 16, `The new composer should start at the top; found scrollY=${state.scrollY}.`);
    assert.equal(state.preserved?.payloadKind, 'image', 'The existing media draft should remain recoverable.');
    assert.equal(state.preserved?.mediaUploadId, PROMPT_ACTIVE_DRAFT.mediaUploadId);
    assert.equal(state.demo?.localDemo, true, 'The completed same-device demo should remain in local history.');
    const preservedAttachment = await evaluate(cdp, `(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('dear-exe-draft-media', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction('attachments', 'readonly');
          const request = transaction.objectStore('attachments').get(${JSON.stringify(PROMPT_ACTIVE_DRAFT.id)});
          request.onsuccess = () => resolve({ name: request.result?.name || null, size: request.result?.blob?.size || 0 });
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    })()`);
    assert.equal(preservedAttachment.name, 'demo-cat.png', 'The original media attachment should still be available after the fresh draft opens.');
    assert.ok(preservedAttachment.size > 0, 'The original local attachment bytes should remain intact.');
    await assertNoFrameworkOverlay(cdp, 'Fresh draft from demo');
    await assertNoHorizontalOverflow(cdp, 'Fresh draft from demo', viewport.width);
    await captureScreenshot(cdp, screenshotDir, `${viewport.name}-friend-draft-composer`);
  }
}

async function runDropBackFlow(cdp, { appUrl, screenshotDir }) {
  const viewport = MOBILE_VIEWPORTS[1];
  await setViewport(cdp, viewport);
  await cdp.send('Page.navigate', { url: appUrl.href });
  await waitUntil(cdp, `Home with “${LABELS.homeDemo}” before seeding Drop back`, async () => (
    await evaluate(cdp, `${normalizedVisibleText(LABELS.homeDemo)} && location.pathname === '/'`)
  ));

  const seeded = await evaluate(cdp, `(async () => {
    const draft = ${JSON.stringify(PROMPT_ACTIVE_DRAFT)};
    const letter = ${JSON.stringify(DROP_BACK_RECEIVED_FIXTURE)};
    localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify(draft));
    localStorage.setItem('dear-exe:letter-drafts:v1', JSON.stringify([draft]));
    localStorage.setItem('dear-exe:letter-history:v1', JSON.stringify([letter]));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('attachments');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const blob = new Blob([new Uint8Array([1, 4, 9, 16, 25])], { type: 'image/png' });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readwrite');
        transaction.objectStore('attachments').put({ blob, name: 'keep-this-photo.png', type: blob.type, lastModified: 42 }, draft.id);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return localStorage.getItem('dear-exe:active-letter:v1') === JSON.stringify(draft)
      && JSON.parse(localStorage.getItem('dear-exe:letter-history:v1') || '[]')[0]?.id === letter.id;
  })()`);
  assert.equal(seeded, true, 'The existing photo draft and opened received-drop fixture should be saved in this isolated browser profile.');
  const originalAttachment = await readAttachmentSnapshot(cdp, PROMPT_ACTIVE_DRAFT.id);
  assert.ok(originalAttachment.attachment?.size > 0, 'The unfinished photo draft should have saved attachment bytes before Drop back.');

  const receivedPath = `/letter/${encodeURIComponent(DROP_BACK_RECEIVED_FIXTURE.id)}`;
  await cdp.send('Page.navigate', { url: new URL(receivedPath, appUrl).href });
  await waitUntil(cdp, 'the seeded received drop before opening', async () => (
    await evaluate(cdp, `location.pathname === ${JSON.stringify(receivedPath)} && ${normalizedVisibleText('Reveal demo fragments')}`)
  ));
  await activateFlowControl(cdp, { keyboard: true, name: LABELS.reveal, expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'the received drop reveal action', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Open demo drop')}`)
  ));
  await activateFlowControl(cdp, { keyboard: true, name: 'Open demo drop', expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'the optional Drop back action', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Drop back')} && ${normalizedVisibleText('No rush')}`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Received drop before Drop back');
  await assertNoHorizontalOverflow(cdp, 'Received drop before Drop back', viewport.width);
  await captureScreenshot(cdp, screenshotDir, 'drop-back-received');

  const actionTag = await evaluate(cdp, `Array.from(document.querySelectorAll('a,button')).find((node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'drop back')?.tagName || null`);
  assert.ok(actionTag === 'A' || actionTag === 'BUTTON', `The Drop back control should be an actionable link or button; found ${actionTag}.`);
  await activateFlowControl(cdp, { keyboard: true, name: 'Drop back', expectedTag: actionTag });
  await waitUntil(cdp, 'the fresh sender-addressed compose draft', async () => (
    await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content'))`)
  ));
  await waitUntil(cdp, 'the composer recipient prefilled from the received drop', async () => (
    await evaluate(cdp, `document.querySelector('#drop-recipient')?.value === ${JSON.stringify(DROP_BACK_RECEIVED_FIXTURE.senderUsername)}
      && JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null')?.recipient === ${JSON.stringify(`@${DROP_BACK_RECEIVED_FIXTURE.senderUsername}`)}`)
  ));

  const state = await evaluate(cdp, `(() => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    const url = new URL(location.href);
    const editor = document.querySelector('#drop-content');
    const recipient = document.querySelector('#drop-recipient');
    const connectLink = Array.from(document.querySelectorAll('a')).find((node) => /connect to send|account options/i.test(node.innerText || node.textContent || ''));
    return {
      routeDraftId: url.searchParams.get('letter'),
      recipientQuery: url.searchParams.get('recipient'),
      active,
      preserved: drafts.find((draft) => draft.id === ${JSON.stringify(PROMPT_ACTIVE_DRAFT.id)}) || null,
      editorValue: editor?.value ?? null,
      recipientValue: recipient?.value ?? null,
      sendButton: Array.from(document.querySelectorAll('button')).find((node) => /send drop/i.test(node.innerText || node.textContent || ''))?.disabled ?? null,
      connectLink: connectLink?.innerText.trim() || null,
      sendReceiptCount: JSON.parse(localStorage.getItem('dear-exe:letter-history:v1') || '[]').filter((letter) => letter.status !== 'draft').length,
      scrollY: window.scrollY,
    };
  })()`);
  assert.ok(state.routeDraftId, 'Drop back should open a stable draft route ID.');
  assert.equal(state.routeDraftId, state.active?.id, 'The composer route should address the fresh active draft.');
  assert.notEqual(state.active?.id, PROMPT_ACTIVE_DRAFT.id, 'Drop back must not reuse the existing photo draft.');
  assert.equal(state.active?.status, 'draft');
  assert.equal(state.active?.payloadKind, 'text');
  assert.equal(state.active?.content, '');
  assert.equal(state.active?.subject, '');
  assert.equal(state.active?.recipient, '@friend.handle', 'The sender handle should be saved as the prefilled recipient.');
  assert.equal(state.recipientQuery, '@friend.handle');
  assert.equal(state.recipientValue, 'friend.handle');
  assert.equal(state.editorValue, '', 'Drop back should open an editable blank message.');
  assert.deepEqual(state.preserved, PROMPT_ACTIVE_DRAFT, 'The original media draft fields should remain unchanged.');
  assert.equal(state.sendButton, null, 'A signed-out local fixture must not send automatically.');
  assert.ok(state.connectLink, 'The flow should retain the explicit account step before sending.');
  assert.equal(state.sendReceiptCount, 1, 'Opening Drop back should not create a sent drop.');
  assert.ok(state.scrollY <= 16, `The new composer should start at the top; found scrollY=${state.scrollY}.`);

  const finalAttachment = await readAttachmentSnapshot(cdp, PROMPT_ACTIVE_DRAFT.id);
  assert.deepEqual(finalAttachment.keys, originalAttachment.keys, 'Drop back should not add or remove existing attachment records.');
  assert.deepEqual(finalAttachment.attachment, originalAttachment.attachment, 'The original attachment metadata and bytes should remain unchanged.');
  await assertNoFrameworkOverlay(cdp, 'Fresh Drop back composer');
  await assertNoHorizontalOverflow(cdp, 'Fresh Drop back composer', viewport.width);
  await captureScreenshot(cdp, screenshotDir, 'drop-back-fresh-compose');
}

async function readAttachmentSnapshot(cdp, draftId) {
  return evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const store = transaction.objectStore('attachments');
        const keysRequest = store.getAllKeys();
        const attachmentRequest = store.get(${JSON.stringify(draftId)});
        transaction.oncomplete = async () => {
          const value = attachmentRequest.result;
          const bytes = value?.blob ? Array.from(new Uint8Array(await value.blob.arrayBuffer())) : [];
          resolve({
            keys: keysRequest.result.map(String).sort(),
            attachment: value ? {
              name: value.name,
              type: value.type,
              lastModified: value.lastModified,
              size: value.blob?.size || 0,
              bytes,
            } : null,
          });
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  })()`);
}

async function runClaimRecoveryFlow(cdp, {
  appUrl,
  viewport,
  keyboard,
  screenshotDir,
  getPageLoadEvents,
}) {
  await setViewport(cdp, viewport);
  await cdp.send('Page.navigate', { url: new URL('/compose', appUrl).href });
  await waitUntil(cdp, 'Compose before seeding the saved claim fixture', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Send a little moment.')} && location.pathname === '/compose'`)
  ));

  const seeded = await evaluate(cdp, `(() => {
    const draft = ${JSON.stringify(CLAIM_RECOVERY_DRAFT)};
    localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify(draft));
    localStorage.setItem('dear-exe:letter-drafts:v1', JSON.stringify([draft]));
    return localStorage.getItem('dear-exe:active-letter:v1') === JSON.stringify(draft)
      && JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]')[0]?.id === draft.id;
  })()`);
  assert.equal(seeded, true, 'The synthetic pending claim should be saved in this isolated browser profile.');

  const composeUrl = new URL('/compose', appUrl);
  composeUrl.searchParams.set('letter', CLAIM_RECOVERY_DRAFT.id);
  await cdp.send('Page.navigate', { url: composeUrl.href });
  const assertComposeRecovery = async (step) => {
    await waitUntil(cdp, `${step}: recovered saved-drop message`, async () => (
      await evaluate(cdp, `${normalizedVisibleText('Your drop is saved.')} && ${normalizedVisibleText('Open saved drop')} && location.pathname === '/compose'`)
    ));
    const copyControlPresent = await evaluate(cdp, `Array.from(document.querySelectorAll('button,a,[role="button"]')).some(node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'copy private link')`);
    assert.equal(copyControlPresent, false, `${step}: recovery after reload must not show a link that is no longer in memory.`);
    await assertNoFrameworkOverlay(cdp, step);
    await assertNoHorizontalOverflow(cdp, step, viewport.width);
  };

  await assertComposeRecovery('Compose recovered claim');
  const previousLoadEvents = getPageLoadEvents();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'a fresh Compose document load after recovery reload', async () => getPageLoadEvents() > previousLoadEvents);
  await assertComposeRecovery('Compose claim after reload');
  if (screenshotDir && (viewport.width === 390 || !viewport.mobile)) {
    await captureScreenshot(cdp, screenshotDir, `${viewport.name}-claim-compose`);
  }

  const linkHref = await evaluate(cdp, `Array.from(document.querySelectorAll('a')).find(node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase().includes('open saved drop'))?.getAttribute('href') || null`);
  assert.equal(linkHref, CLAIM_DETAILS_PATH, 'Open saved drop should target the exact encoded detail route.');
  await activateFlowControl(cdp, {
    keyboard,
    name: 'Open saved drop',
    expectedTag: 'A',
    expectedHref: CLAIM_DETAILS_PATH,
  });

  await waitUntil(cdp, 'the saved pending claim detail and fresh-link action', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Waiting for them to claim.')} && ${normalizedVisibleText('Share a fresh private link')} && ${normalizedVisibleText('“A note waiting to be claimed” is waiting to be claimed. Open this page to check its status or make a fresh private link.')} && location.pathname === ${JSON.stringify(CLAIM_DETAILS_PATH)}`)
  ));
  const claimsItWasShared = await evaluate(cdp, `${normalizedVisibleText('You sent this drop to Anyone with the link')}`);
  assert.equal(claimsItWasShared, false, 'A saved claim-pending drop must not imply the bearer link was shared.');
  const freshLinkButtonEnabled = await evaluate(cdp, `Array.from(document.querySelectorAll('button')).some(node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'share a fresh private link' && !node.disabled && node.getAttribute('aria-disabled') !== 'true')`);
  assert.equal(freshLinkButtonEnabled, true, 'The saved claim detail should expose an enabled fresh-link button.');
  await assertNoFrameworkOverlay(cdp, 'Saved claim detail');
  await assertNoHorizontalOverflow(cdp, 'Saved claim detail', viewport.width);
  if (screenshotDir && (viewport.width === 390 || !viewport.mobile)) {
    await captureScreenshot(cdp, screenshotDir, `${viewport.name}-claim-detail`);
  }
}

async function runWritingPromptFlow(cdp, { appUrl, viewport, keyboard, screenshotDir }) {
  await setViewport(cdp, viewport);
  await cdp.send('Page.navigate', { url: appUrl.href });
  await waitUntil(cdp, 'Home with the send account disclosure before starting a prompted draft', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Use this thought')} && ${normalizedVisibleText(LABELS.homeSendAccountDisclosure)} && location.pathname === '/'`)
  ));

  const seeded = await evaluate(cdp, `(async () => {
    const draft = ${JSON.stringify(PROMPT_ACTIVE_DRAFT)};
    localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify(draft));
    localStorage.setItem('dear-exe:letter-drafts:v1', JSON.stringify([draft]));
    const response = await fetch('/demo-cat.png');
    if (!response.ok) throw new Error('Could not load the local photo fixture.');
    const blob = await response.blob();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('attachments');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readwrite');
        transaction.objectStore('attachments').put({ blob, name: 'demo-cat.png', type: blob.type, lastModified: 1 }, draft.id);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return localStorage.getItem('dear-exe:active-letter:v1') === JSON.stringify(draft);
  })()`);
  assert.equal(seeded, true, 'The unfinished photo draft and its private attachment should be saved before starting a prompt draft.');
  await assertNoHorizontalOverflow(cdp, 'Home prompt starter', viewport.width);
  const prompt = await evaluate(cdp, `document.querySelector('aside p[aria-live="polite"]')?.innerText || ''`);
  assert.ok(prompt.trim(), 'Home should show the writing thought that will be added to the draft.');
  await activateFlowControl(cdp, { keyboard, name: 'Use this thought', expectedTag: 'BUTTON' });

  await waitUntil(cdp, 'the new composer with an editable text field', async () => (
    await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content'))`)
  ));
  const initialComposerState = await evaluate(cdp, `(() => ({
    url: location.href,
    value: document.querySelector('#drop-content')?.value || '',
    active: JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null'),
  }))()`);
  assert.equal(initialComposerState.value, prompt, `The selected thought should seed the editor; state=${JSON.stringify(initialComposerState)}`);
  assert.equal(initialComposerState.active?.content, prompt, 'The selected thought should be persisted in the new draft.');
  assert.equal(initialComposerState.active?.payloadKind, 'text', 'A prompt draft should stay text-only and not inherit the previous media.');
  await waitUntil(cdp, 'the local save state for the new prompt draft', async () => (
    await evaluate(cdp, normalizedVisibleText('Saved on this device'))
  ));
  await assertNoFrameworkOverlay(cdp, 'Prompt composer');
  await assertNoHorizontalOverflow(cdp, 'Prompt composer', viewport.width);
  const state = await evaluate(cdp, `(() => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    return {
      active,
      preserved: drafts.find(draft => draft.id === ${JSON.stringify(PROMPT_ACTIVE_DRAFT.id)}) || null,
      url: location.href,
      textareaEditable: Boolean(document.querySelector('#drop-content') && !document.querySelector('#drop-content').disabled && !document.querySelector('#drop-content').readOnly),
    };
  })()`);
  assert.equal(state.active.content, prompt, 'The selected thought should be the new draft content.');
  assert.notEqual(state.active.id, PROMPT_ACTIVE_DRAFT.id, 'The prompt should use its own draft.');
  assert.equal(state.preserved?.payloadKind, 'image', 'Starting a prompt must preserve an existing media draft.');
  assert.equal(state.preserved?.mediaUploadId, PROMPT_ACTIVE_DRAFT.mediaUploadId, 'The existing media upload identity must stay with its draft.');
  assert.equal(state.textareaEditable, true, 'The prompt should remain editable in the composer.');
  const url = new URL(state.url);
  assert.equal(url.pathname, '/compose');
  assert.equal(url.searchParams.get('letter'), state.active.id, 'The new route should reopen the prompted draft by its stable ID.');
  assert.equal(url.searchParams.has('prompt'), false, 'Prompt text should not be copied into the URL.');
  assert.equal(state.url.includes('kindness you still remember'), false, 'Prompt text should stay out of browser history.');
  const existingAttachment = await evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').get(${JSON.stringify(PROMPT_ACTIVE_DRAFT.id)});
        request.onsuccess = () => resolve({ name: request.result?.name || null, size: request.result?.blob?.size || 0 });
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.equal(existingAttachment.name, 'demo-cat.png', 'The unfinished media draft attachment should remain in private local storage.');
  assert.ok(existingAttachment.size > 0, 'The unfinished media draft attachment bytes should remain intact.');
  if (screenshotDir && (viewport.width === 390 || !viewport.mobile)) {
    await captureScreenshot(cdp, screenshotDir, `${viewport.name}-prompt-composer`);
  }

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'the saved prompt after reload', async () => (
    await evaluate(cdp, `location.pathname === '/compose'
      && document.readyState === 'complete'
      && document.querySelector('#drop-content')?.value === ${JSON.stringify(prompt)}
      && ${normalizedVisibleText('Saved on this device')}`)
  ));
  await assertNoFrameworkOverlay(cdp, 'Prompt draft after reload');
  await assertNoHorizontalOverflow(cdp, 'Prompt draft after reload', viewport.width);
}

async function runRecipientlessClaimChoiceFlow(cdp, { appUrl, viewport, keyboard }) {
  await setViewport(cdp, viewport);
  const composeUrl = new URL('/compose', appUrl);
  composeUrl.searchParams.set('new', '1');
  await cdp.send('Page.navigate', { url: composeUrl.href });
  await waitUntil(cdp, 'the fresh composer and handleless claim option', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Send a little moment.')} && ${normalizedVisibleText('Share without a handle')} && location.pathname === '/compose'`)
  ));
  await waitUntil(cdp, 'the blank draft saved before selecting a delivery route', async () => (
    await evaluate(cdp, `${normalizedVisibleText('Saved on this device')}`)
  ));
  await activateFlowControl(cdp, { keyboard, name: 'Share without a handle', expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'the focused handleless claim explanation', async () => (
    await evaluate(cdp, `(() => {
      const panel = document.querySelector('[role="region"][aria-labelledby="unaddressed-claim-title"]');
      return Boolean(panel && document.activeElement === panel
        && ${normalizedVisibleText('Anyone holding the link can claim this drop')}
        && ${normalizedVisibleText('Connect your Drop account before making a private claim link.')});
    })()`)
  ));
  const blankDraftStillSaved = await evaluate(cdp, `${normalizedVisibleText('Saved on this device')}`);
  assert.equal(blankDraftStillSaved, true, 'Selecting an unaddressed route must not mark an unchanged saved draft as unsaved.');
  const unsafeShareActionVisible = await evaluate(cdp, `Array.from(document.querySelectorAll('button')).some(node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'share private link')`);
  assert.equal(unsafeShareActionVisible, false, 'An unconnected account must not be offered an actionable private-link share.');
  await assertNoFrameworkOverlay(cdp, 'Handleless claim explanation');
  await assertNoHorizontalOverflow(cdp, 'Handleless claim explanation', viewport.width);

  await activateFlowControl(cdp, { keyboard, name: 'Use a Drop handle instead', expectedTag: 'BUTTON' });
  await waitUntil(cdp, 'focus returned to the Drop handle field', async () => (
    await evaluate(cdp, `document.activeElement?.id === 'drop-recipient'`)
  ));
  await assertNoHorizontalOverflow(cdp, 'Handleless route switched back to recipient entry', viewport.width);
}

async function runShareTargetFlow(cdp, { appUrl, screenshotDir, getPageLoadEvents, captureShareRequests, getShareRequests, getShareRedirects, getShareForbiddenRequests, getBlockedRequestCount }) {
  const viewport = MOBILE_VIEWPORTS[1];
  await setViewport(cdp, viewport);
  await cdp.send('Page.navigate', { url: appUrl.href });
  await waitUntil(cdp, 'Home before installing the share-target worker', async () => (
    await evaluate(cdp, `location.origin === ${JSON.stringify(appUrl.origin)} && location.pathname === '/' && document.readyState === 'complete'`)
  ));

  const waitForRootWorker = () => waitUntil(cdp, 'an active root-scoped service worker controlling the page', async () => (
    await evaluate(cdp, `(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const controller = navigator.serviceWorker.controller;
      if (!registration?.active || registration.scope !== location.origin + '/' || !controller || controller.state !== 'activated') return null;
      return { scope: registration.scope, scriptURL: controller.scriptURL, state: controller.state };
    })()`)
  ));
  let worker = await waitForRootWorker().catch(() => null);
  if (!worker) {
    const previousLoadEvents = getPageLoadEvents();
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(cdp, 'Home reload after service-worker activation', async () => (
      getPageLoadEvents() > previousLoadEvents && await evaluate(cdp, `location.pathname === '/' && document.readyState === 'complete'`)
    ));
    worker = await waitForRootWorker();
  }
  assert.ok(worker.scriptURL.startsWith(`${appUrl.origin}/`), `The controlling worker is not same-origin: ${worker.scriptURL}`);

  const manifest = await evaluate(cdp, `(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const response = await fetch(link.href, { cache: 'no-store' });
    if (!response.ok) return { status: response.status };
    return response.json();
  })()`);
  assert.ok(manifest, 'The app should publish a web manifest before advertising the share target.');
  const shareTarget = manifest.share_target;
  assert.ok(shareTarget, 'The web manifest should declare a share target.');
  assert.equal(new URL(shareTarget.action, appUrl).pathname, '/share-target', 'The share target should submit to /share-target.');
  assert.equal(shareTarget.method?.toUpperCase(), 'POST', 'The share target should use POST so it can carry media.');
  assert.equal(shareTarget.enctype, 'multipart/form-data', 'The share target should use multipart/form-data.');
  assert.ok(shareTarget.params?.files?.some((field) => field.name === 'media'), 'The manifest should expose the media file field named media.');
  assert.ok(shareTarget.params.files.some((field) => field.name === 'media' && field.accept?.some((value) => value.toLowerCase() === 'image/png' || value.toLowerCase() === '.png')), 'The media field should accept PNG fixtures.');

  const iconSpecs = ['192x192', '512x512'].map((size) => {
    const spec = manifest.icons?.find((icon) => icon.sizes?.split(/\s+/).includes(size));
    assert.ok(spec?.src, `The web manifest should declare an icon with size ${size}.`);
    return { size, src: spec.src };
  });
  const iconUrls = [...new Set(iconSpecs.map(({ src }) => new URL(src, appUrl).href))];
  assert.equal(iconUrls.length, 2, 'The manifest should provide separate 192px and 512px icon URLs.');
  const iconResponses = await evaluate(cdp, `(async () => Promise.all(${JSON.stringify(iconUrls)}.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const blob = await response.blob();
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      return { url, status: response.status, ok: response.ok, contentType: response.headers.get('content-type') || '', byteLength: blob.size, width: bitmap.width, height: bitmap.height };
    } catch (error) {
      return { url, status: response.status, ok: response.ok, contentType: response.headers.get('content-type') || '', byteLength: blob.size, decodeError: error instanceof Error ? error.message : String(error) };
    } finally {
      bitmap?.close();
    }
  })))()`);
  assert.equal(iconResponses.length, iconUrls.length, 'Both declared icon URLs should be fetched.');
  for (const iconSpec of iconSpecs) {
    const iconUrl = new URL(iconSpec.src, appUrl).href;
    const iconResponse = iconResponses.find((response) => response.url === iconUrl);
    assert.ok(iconResponse?.ok, `Manifest icon ${iconUrl} should return a successful image response; got ${JSON.stringify(iconResponse)}.`);
    assert.match(iconResponse.contentType, /^image\/png\b/i, `Manifest icon ${iconUrl} should be served as PNG.`);
    assert.ok(iconResponse.byteLength > 0, `Manifest icon ${iconUrl} should have image bytes.`);
    const dimension = Number(iconSpec.size.split('x')[0]);
    assert.equal(iconResponse.width, dimension, `Manifest icon ${iconUrl} should decode at ${dimension}px width.`);
    assert.equal(iconResponse.height, dimension, `Manifest icon ${iconUrl} should decode at ${dimension}px height.`);
  }

  const previousDraftSeeded = await evaluate(cdp, `(async () => {
    const draft = ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT)};
    localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify(draft));
    localStorage.setItem('dear-exe:letter-drafts:v1', JSON.stringify([draft]));
    const response = await fetch('/demo-cat.png');
    if (!response.ok) throw new Error('Could not load the existing private attachment fixture.');
    const blob = await response.blob();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('attachments')) request.result.createObjectStore('attachments');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readwrite');
        transaction.objectStore('attachments').put({ blob, name: 'demo-cat.png', type: blob.type, lastModified: 1 }, draft.id);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return localStorage.getItem('dear-exe:active-letter:v1') === JSON.stringify(draft);
  })()`);
  assert.equal(previousDraftSeeded, true, 'The previous draft and private attachment should be saved before the share import.');

  const previousDraftUrl = new URL('/compose', appUrl);
  previousDraftUrl.searchParams.set('letter', SHARE_TARGET_PREVIOUS_DRAFT.id);
  await cdp.send('Page.navigate', { url: previousDraftUrl.href });
  await waitUntil(cdp, 'the existing draft composer before the share import', async () => (
    await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content'))`)
  ));
  await waitUntil(cdp, 'the existing draft content hydrated in the composer', async () => (
    await evaluate(cdp, `document.querySelector('#drop-content')?.value === ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.content)}
      && JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null')?.id === ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)}`)
  ));
  const previousDraftBeforeShare = await evaluate(cdp, `(() => ({
    active: JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null'),
    content: document.querySelector('#drop-content')?.value || '',
    subject: document.querySelector('#drop-subject')?.value || '',
  }))()`);
  assert.equal(previousDraftBeforeShare.active?.id, SHARE_TARGET_PREVIOUS_DRAFT.id, 'The previous local draft should be active before the share import.');
  assert.equal(previousDraftBeforeShare.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'The previous draft should have saved text before the share import.');
  assert.equal(previousDraftBeforeShare.subject, SHARE_TARGET_PREVIOUS_DRAFT.subject, 'The previous draft should have its original subject before the share import.');
  const previousActiveSnapshot = JSON.stringify(previousDraftBeforeShare.active);
  assert.equal(await evaluate(cdp, `sessionStorage.setItem('__dropSharePriorActiveSnapshot', ${JSON.stringify(previousActiveSnapshot)}); true`), true);
  const previousAttachment = await evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').get(${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)});
        request.onsuccess = () => resolve({ name: request.result?.name || null, size: request.result?.blob?.size || 0 });
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.equal(previousAttachment.name, 'demo-cat.png', 'The pre-existing draft attachment should be available before sharing.');
  assert.ok(previousAttachment.size > 0, 'The pre-existing attachment should contain image bytes.');
  assert.equal(await evaluate(cdp, `navigator.serviceWorker.controller?.state === 'activated'`), true, 'The composer document should remain controlled by the active worker.');

  const failureHookAdded = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const failureKey = '__dropShareDraftPersistenceFailureOnce';
      const attachmentCommitKey = '__dropShareAttachmentCommitBeforeDraftFailure';
      const activeWriteCountKey = '__dropShareImportedActiveWriteCount';
      const startFailureKey = '__dropShareStartNewDraftVerificationFailureOnce';
      const priorActiveKey = '__dropSharePriorActiveSnapshot';
      const blankDraftKey = '__dropShareBlankDraftWriteObserved';
      const originalPut = IDBObjectStore.prototype.put;
      const originalSetItem = Storage.prototype.setItem;
      const originalGetItem = Storage.prototype.getItem;
      IDBObjectStore.prototype.put = function (...args) {
        const handoffId = new URL(location.href).searchParams.get('shareImport');
        const attachment = args[0];
        if (sessionStorage.getItem(failureKey) === 'armed'
          && this.name === 'attachments'
          && this.transaction?.db?.name === 'dear-exe-draft-media'
          && attachment?.name === ${JSON.stringify(SHARE_TARGET_FILENAME)}) {
          this.transaction.addEventListener('complete', () => {
            Reflect.apply(originalSetItem, sessionStorage, [attachmentCommitKey, handoffId || '']);
          }, { once: true });
        }
        return Reflect.apply(originalPut, this, args);
      };
      Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage && key === 'dear-exe:active-letter:v1'
          && sessionStorage.getItem(startFailureKey) === 'armed') {
          let draft = null;
          try { draft = JSON.parse(value); } catch { /* Ignore unrelated local values. */ }
          if (draft?.status === 'draft' && !String(draft.content || '').trim()
            && !(draft.recipient || '').trim() && !draft.mediaUploadId) {
            const previousActive = JSON.parse(sessionStorage.getItem(priorActiveKey) || 'null');
            if (draft.id !== previousActive?.id) {
              const result = Reflect.apply(originalSetItem, this, [key, value]);
              Reflect.apply(originalSetItem, sessionStorage, [blankDraftKey, draft.id]);
              return result;
            }
          }
        }
        if (this === window.localStorage
          && key === 'dear-exe:active-letter:v1'
          && sessionStorage.getItem(failureKey) === 'armed') {
          const handoffId = new URL(location.href).searchParams.get('shareImport');
          let draft = null;
          try { draft = JSON.parse(value); } catch { /* Ignore unrelated local values. */ }
          if (handoffId && draft?.mediaUploadId === handoffId && draft.payloadKind === 'image') {
            const count = Number(sessionStorage.getItem(activeWriteCountKey) || '0') + 1;
            Reflect.apply(originalSetItem, sessionStorage, [activeWriteCountKey, String(count)]);
            if (count === 2 && sessionStorage.getItem(attachmentCommitKey) === handoffId) {
              Reflect.apply(originalSetItem, sessionStorage, [failureKey, 'consumed-after-attachment-commit']);
              throw new Error('Simulated imported draft persistence failure after attachment commit.');
            }
          }
        }
        return Reflect.apply(originalSetItem, this, [key, value]);
      };
      Storage.prototype.getItem = function (key) {
        if (this === window.localStorage && key === 'dear-exe:active-letter:v1'
          && sessionStorage.getItem(startFailureKey) === 'armed'
          && sessionStorage.getItem(blankDraftKey)) {
          const previousActive = sessionStorage.getItem(priorActiveKey);
          Reflect.apply(originalSetItem, sessionStorage, [startFailureKey, 'consumed-after-active-write']);
          return previousActive;
        }
        return Reflect.apply(originalGetItem, this, [key]);
      };
    })();`,
  });
  assert.ok(failureHookAdded.identifier, 'The smoke should install a one-time post-commit draft-persistence failure for the cleanup retry check.');
  assert.equal(await evaluate(cdp, `sessionStorage.setItem('__dropShareDraftPersistenceFailureOnce', 'armed'); true`), true);

  const beforeImportBlockedRequests = getBlockedRequestCount();
  captureShareRequests(true);
  const previousLoadEvents = getPageLoadEvents();
  const submittedForm = await evaluate(cdp, `(async () => {
    const form = document.createElement('form');
    form.id = 'drop-share-target-smoke-form';
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.action = new URL('/share-target', location.origin).href;
    form.hidden = true;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'media';
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2b45f7';
    context.fillRect(0, 0, 2, 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create the synthetic PNG payload.');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], ${JSON.stringify(SHARE_TARGET_FILENAME)}, { type: 'image/png', lastModified: 1 }));
    fileInput.files = transfer.files;
    form.append(fileInput);
    const caption = document.createElement('input');
    caption.type = 'hidden';
    caption.name = 'text';
    caption.value = ${JSON.stringify(SHARE_TARGET_CAPTION)};
    form.append(caption);
    document.body.append(form);
    const valid = fileInput.files.length === 1 && fileInput.files[0].type === 'image/png' && fileInput.files[0].name === ${JSON.stringify(SHARE_TARGET_FILENAME)};
    if (valid) setTimeout(() => HTMLFormElement.prototype.submit.call(form), 0);
    return { valid, method: form.method, enctype: form.enctype, action: form.action, caption: caption.value };
  })()`);
  assert.equal(submittedForm.valid, true, 'The smoke should submit one synthetic PNG through a real multipart file input.');
  assert.equal(submittedForm.method.toUpperCase(), 'POST');
  assert.equal(submittedForm.enctype, 'multipart/form-data');
  assert.equal(new URL(submittedForm.action).pathname, '/share-target');
  await waitUntil(cdp, 'the share import route after the injected post-commit persistence failure', async () => (
    getPageLoadEvents() > previousLoadEvents
      && await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content')) && new URL(location.href).searchParams.has('shareImport')`)
  ));
  await waitUntil(cdp, 'the committed attachment followed by a one-time draft persistence failure', async () => (
    await evaluate(cdp, `sessionStorage.getItem('__dropShareDraftPersistenceFailureOnce') === 'consumed-after-attachment-commit'
      && sessionStorage.getItem('__dropShareAttachmentCommitBeforeDraftFailure') === new URL(location.href).searchParams.get('shareImport')
      && sessionStorage.getItem('__dropShareImportedActiveWriteCount') === '2'
      && (document.querySelector('[role="alert"]')?.innerText || '').includes('new draft could not be saved')`)
  ));
  await sleep(500, interrupted.signal);
  const failedImportState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const attachments = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('attachments', 'readonly');
        const store = transaction.objectStore('attachments');
        const values = store.getAll();
        const previous = store.get(${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)});
        transaction.oncomplete = () => {
          database.close();
          resolve({
            values: values.result,
            previous: previous.result ? { name: previous.result.name, size: previous.result.blob?.size || 0 } : null,
          });
        };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });
    const handoffId = new URL(location.href).searchParams.get('shareImport');
    const handoffDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let handoffRemains = false;
    try {
      handoffRemains = await new Promise((resolve, reject) => {
        const transaction = handoffDatabase.transaction('handoffs', 'readonly');
        const request = transaction.objectStore('handoffs').get(handoffId);
        request.onsuccess = () => resolve(Boolean(request.result));
        request.onerror = () => reject(request.error);
      });
    } finally {
      handoffDatabase.close();
    }
    return {
      active,
      content: document.querySelector('#drop-content')?.value || '',
      alert: document.querySelector('[role="alert"]')?.innerText || '',
      url: location.href,
      importedAttachments: attachments.values.filter((attachment) => attachment?.name === ${JSON.stringify(SHARE_TARGET_FILENAME)}).length,
      previousAttachment: attachments.previous,
      handoffRemains,
      fault: sessionStorage.getItem('__dropShareDraftPersistenceFailureOnce'),
      attachmentCommit: sessionStorage.getItem('__dropShareAttachmentCommitBeforeDraftFailure'),
      importedActiveWriteCount: sessionStorage.getItem('__dropShareImportedActiveWriteCount'),
    };
  })()`);
  const failedHandoffId = new URL(failedImportState.url).searchParams.get('shareImport');
  assert.equal(failedImportState.fault, 'consumed-after-attachment-commit', 'The smoke should fail draft persistence only after the attachment transaction commits.');
  assert.equal(failedImportState.attachmentCommit, failedHandoffId);
  assert.equal(failedImportState.importedActiveWriteCount, '2', 'The injected failure should target the second imported-draft active write, after attachment save.');
  assert.match(failedImportState.alert, /new draft could not be saved/);
  assert.equal(failedImportState.active?.id, SHARE_TARGET_PREVIOUS_DRAFT.id, 'A failed share import must restore the previously active draft.');
  assert.equal(failedImportState.active?.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'A failed share import must preserve the prior active draft content.');
  assert.equal(failedImportState.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'The visible composer should keep showing the prior draft after import failure.');
  assert.equal(failedImportState.importedAttachments, 0, 'Rollback should remove the attachment that committed before draft persistence failed.');
  assert.deepEqual(failedImportState.previousAttachment, { name: 'demo-cat.png', size: previousAttachment.size }, 'Rollback should preserve the earlier draft attachment.');
  assert.equal(failedImportState.handoffRemains, true, 'The failed import should retain its handoff so the user can retry.');
  assert.match(failedHandoffId || '', SHARE_IMPORT_ID);

  await evaluate(cdp, `document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' }); true`);
  await captureScreenshot(cdp, screenshotDir, 'mobile-390-share-target-post-commit-rollback');
  assert.equal(await evaluate(cdp, `sessionStorage.setItem('__dropShareStartNewDraftVerificationFailureOnce', 'armed'); true`), true);
  const draftCreationFailureLoadEvents = getPageLoadEvents();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'reload before the active-draft verification failure check', async () => (
    getPageLoadEvents() > draftCreationFailureLoadEvents
      && await evaluate(cdp, `location.pathname === '/compose' && new URL(location.href).searchParams.get('shareImport') === ${JSON.stringify(failedHandoffId)}`)
  ));
  await waitUntil(cdp, 'the startNewLetter active-draft verification failure and rollback', async () => (
    await evaluate(cdp, `sessionStorage.getItem('__dropShareStartNewDraftVerificationFailureOnce') === 'consumed-after-active-write'
      && Boolean(sessionStorage.getItem('__dropShareBlankDraftWriteObserved'))
      && (document.querySelector('[role="alert"]')?.innerText || '').includes('new draft could not be verified')`)
  ));
  const draftCreationFailureState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const handoffId = new URL(location.href).searchParams.get('shareImport');
    const handoffDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let handoffRemains = false;
    try {
      handoffRemains = await new Promise((resolve, reject) => {
        const transaction = handoffDatabase.transaction('handoffs', 'readonly');
        const request = transaction.objectStore('handoffs').get(handoffId);
        request.onsuccess = () => resolve(Boolean(request.result));
        request.onerror = () => reject(request.error);
      });
    } finally {
      handoffDatabase.close();
    }
    const mediaDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let importedAttachments = 0;
    try {
      importedAttachments = await new Promise((resolve, reject) => {
        const transaction = mediaDatabase.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').getAll();
        request.onsuccess = () => resolve(request.result.filter((attachment) => attachment?.name === ${JSON.stringify(SHARE_TARGET_FILENAME)}).length);
        request.onerror = () => reject(request.error);
      });
    } finally {
      mediaDatabase.close();
    }
    return {
      active,
      content: document.querySelector('#drop-content')?.value || '',
      failedBlankDraftId: sessionStorage.getItem('__dropShareBlankDraftWriteObserved'),
      handoffRemains,
      importedAttachments,
    };
  })()`);
  assert.equal(draftCreationFailureState.active?.id, SHARE_TARGET_PREVIOUS_DRAFT.id, 'A post-write blank-draft verification failure must restore the previous active draft.');
  assert.notEqual(draftCreationFailureState.active?.id, draftCreationFailureState.failedBlankDraftId, 'The failed blank draft must not remain active.');
  assert.equal(draftCreationFailureState.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'The composer should keep showing the previous draft after blank-draft verification fails.');
  assert.equal(draftCreationFailureState.handoffRemains, true, 'A failed blank-draft verification must keep the share available to retry.');
  assert.equal(draftCreationFailureState.importedAttachments, 0, 'The blank-draft failure must not create an imported attachment.');
  await evaluate(cdp, `document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' }); true`);
  await captureScreenshot(cdp, screenshotDir, 'mobile-390-share-target-start-draft-rollback');

  const retryLoadEvents = getPageLoadEvents();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'reload before retrying the preserved share handoff', async () => (
    getPageLoadEvents() > retryLoadEvents
      && await evaluate(cdp, `(() => {
        const parameters = new URL(location.href).searchParams;
        return location.pathname === '/compose'
          && (parameters.get('shareImport') === ${JSON.stringify(failedHandoffId)}
            || (parameters.has('letter') && !parameters.has('shareImport')));
      })()`)
  ));
  await waitUntil(cdp, 'the imported share draft and its canonical composer route after retry', async () => (
    await evaluate(cdp, `location.pathname === '/compose' && Boolean(document.querySelector('#drop-content')) && new URL(location.href).searchParams.has('letter')`)
  ));
  await waitUntil(cdp, 'the shared text and image preview in the fresh composer draft', async () => (
    await evaluate(cdp, `document.querySelector('#drop-content')?.value === ${JSON.stringify(SHARE_TARGET_CAPTION)}
      && Array.from(document.querySelectorAll('img')).some((image) => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0)`)
  ));
  await waitUntil(cdp, 'the imported image and caption saved in the active local draft', async () => (
    await evaluate(cdp, `(() => {
      const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
      return active?.id && active.id !== ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)}
        && active.content === ${JSON.stringify(SHARE_TARGET_CAPTION)}
        && active.payloadKind === 'image'
        && !(active.recipient || '').trim();
    })()`)
  ));

  const requests = getShareRequests();
  const targetRequest = requests.find((request) => request.path === '/share-target' && request.method === 'POST');
  assert.ok(targetRequest, 'The import should use a same-origin navigation POST to /share-target.');
  assert.equal(targetRequest.origin, appUrl.origin, 'The multipart share request should remain same-origin.');
  const targetRedirect = getShareRedirects().find((redirect) => redirect.path === '/share-target' && redirect.status === 303);
  assert.ok(targetRedirect, `The service worker should return 303 from /share-target; redirects=${JSON.stringify(getShareRedirects())}`);
  const handoffUrl = new URL(targetRedirect.location || '', appUrl);
  assert.equal(handoffUrl.origin, appUrl.origin, 'The one-time handoff route should stay same-origin.');
  assert.equal(handoffUrl.pathname, '/compose', 'The 303 should redirect to the composer route.');
  assert.deepEqual(Array.from(handoffUrl.searchParams.keys()), ['shareImport'], 'The 303 URL should contain only the opaque handoff identifier.');
  const handoffId = handoffUrl.searchParams.get('shareImport') || '';
  assert.match(handoffId, SHARE_IMPORT_ID, 'The 303 should redirect with an opaque UUID handoff identifier.');
  assert.equal(handoffUrl.href.includes(SHARE_TARGET_CAPTION), false, 'The shared caption should not be copied into the 303 URL.');

  const importedState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    const url = new URL(location.href);
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let attachments;
    try {
      attachments = await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const store = transaction.objectStore('attachments');
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        transaction.oncomplete = () => resolve(valuesRequest.result.map((value, index) => ({
          key: String(keysRequest.result[index]),
          name: value?.name || '',
          type: value?.type || value?.blob?.type || '',
          size: value?.blob?.size || 0,
        })));
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    return {
      active,
      matchingDrafts: drafts.filter((draft) => draft.id === active?.id).length,
      previousDraft: drafts.find((draft) => draft.id === ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)}) || null,
      url: location.href,
      queryKeys: Array.from(url.searchParams.keys()),
      content: document.querySelector('#drop-content')?.value || '',
      recipient: document.querySelector('#drop-recipient')?.value || '',
      visibleImage: Array.from(document.querySelectorAll('img')).some((image) => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0),
      attachments,
    };
  })()`);
  assert.ok(importedState.active?.id && importedState.active.id !== SHARE_TARGET_PREVIOUS_DRAFT.id, 'The share import should create a fresh draft.');
  assert.equal(importedState.active.status, 'draft', 'Importing a shared file must leave the new draft unsent.');
  assert.equal(importedState.active.dispatchedAt, undefined, 'The share import must not set a dispatch timestamp.');
  assert.equal(importedState.content, SHARE_TARGET_CAPTION, 'The optional shared text should become the caption.');
  assert.equal(importedState.active.content, SHARE_TARGET_CAPTION, 'The caption should be saved with the imported draft.');
  assert.equal(importedState.recipient.trim(), '', 'A share import should not choose a recipient.');
  assert.equal((importedState.active.recipient || '').trim(), '', 'The recipient should stay blank in saved draft data.');
  assert.equal(importedState.active.payloadKind, 'image', 'The shared PNG should become an image drop.');
  assert.ok(importedState.matchingDrafts <= 1, 'The imported draft should not be duplicated in local draft history.');
  assert.equal(importedState.previousDraft?.id, SHARE_TARGET_PREVIOUS_DRAFT.id, 'The previous draft should remain in local history.');
  assert.equal(importedState.previousDraft?.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'The previous draft content should survive in history.');
  assert.equal(importedState.previousDraft?.subject, SHARE_TARGET_PREVIOUS_DRAFT.subject, 'The previous draft subject should survive in history.');
  assert.equal(importedState.previousDraft?.recipient, SHARE_TARGET_PREVIOUS_DRAFT.recipient, 'The previous draft recipient should survive in history.');
  assert.equal(importedState.visibleImage, true, 'The imported image should render as a visible preview.');
  const importedDraftAttachments = importedState.attachments.filter((attachment) => attachment.key.includes(importedState.active.id));
  const importedAttachment = importedDraftAttachments.find((attachment) => attachment.name === SHARE_TARGET_FILENAME);
  assert.equal(importedDraftAttachments.length, 1, 'The imported draft should begin with exactly one local attachment.');
  assert.ok(importedAttachment, 'The PNG bytes should be saved under the new draft key in local media storage.');
  assert.equal(importedAttachment.type, 'image/png', 'The stored share attachment should remain a PNG.');
  assert.ok(importedAttachment.size > 0, 'The stored share attachment should include non-empty bytes.');
  const preservedAttachment = importedState.attachments.find((attachment) => attachment.name === 'demo-cat.png' && attachment.key.includes(SHARE_TARGET_PREVIOUS_DRAFT.id));
  assert.ok(preservedAttachment && preservedAttachment.size > 0, 'The previous draft attachment should remain in local media storage.');
  const handoffWasConsumed = await evaluate(cdp, `(async () => {
    const knownDatabases = await indexedDB.databases();
    if (!knownDatabases.some((database) => database.name === 'drop-share-target-handoffs')) return false;
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('handoffs')) return false;
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('handoffs', 'readonly');
        const request = transaction.objectStore('handoffs').get(${JSON.stringify(handoffId)});
        request.onsuccess = () => resolve(request.result === undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.equal(handoffWasConsumed, true, 'A successfully imported one-time handoff should be deleted from temporary storage.');
  const importedUrl = new URL(importedState.url);
  assert.equal(importedUrl.pathname, '/compose');
  assert.equal(importedUrl.searchParams.get('letter'), importedState.active.id, 'The final route should address the imported draft.');
  assert.equal(importedUrl.searchParams.has('shareImport'), false, 'The one-time handoff identifier should be removed after import.');
  assert.equal(importedUrl.searchParams.has('shareError'), false, 'A successful import should not retain a share error code.');
  assert.deepEqual(importedState.queryKeys, ['letter'], 'Only the stable draft ID should remain in the URL query.');
  assert.equal(importedState.url.includes(SHARE_TARGET_CAPTION), false, 'Shared text should not appear in the URL.');
  assert.equal(importedState.url.includes(SHARE_TARGET_FILENAME), false, 'The shared filename should not appear in the URL.');
  await assertNoFrameworkOverlay(cdp, 'Share-target imported composer');
  await assertNoHorizontalOverflow(cdp, 'Share-target composer at 390px', 390);
  await setViewport(cdp, { name: 'mobile-375', width: 375, height: 844, deviceScaleFactor: 1, mobile: true });
  await assertNoHorizontalOverflow(cdp, 'Share-target composer at 375px', 375);
  await setViewport(cdp, { name: 'mobile-landscape-844', width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await assertNoHorizontalOverflow(cdp, 'Share-target composer at 844×390 landscape', 844);
  await setViewport(cdp, viewport);
  if (screenshotDir) await captureScreenshot(cdp, screenshotDir, 'mobile-390-share-target-import');

  const replayEditsDispatched = await evaluate(cdp, `(() => {
    const setValue = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value === value;
    };
    return {
      content: setValue(document.querySelector('#drop-content'), ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.content)}),
      subject: setValue(document.querySelector('#drop-subject'), ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.subject)}),
      recipient: setValue(document.querySelector('#drop-recipient'), ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.recipient.replace(/^@/, ''))}),
    };
  })()`);
  assert.deepEqual(replayEditsDispatched, { content: true, subject: true, recipient: true }, 'The smoke should edit the imported caption, subject, and recipient before replay.');
  await waitUntil(cdp, 'edited share draft saved before replay', async () => (
    await evaluate(cdp, `(() => {
      const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
      return active?.id === ${JSON.stringify(importedState.active.id)}
        && active.content === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.content)}
        && active.subject === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.subject)}
        && active.recipient === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.recipient)}
        && document.querySelector('#drop-content')?.value === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.content)}
        && document.querySelector('#drop-subject')?.value === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.subject)}
        && document.querySelector('#drop-recipient')?.value === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.recipient.replace(/^@/, ''))};
    })()`)
  ));

  const replayPrepared = await evaluate(cdp, `(async () => {
    const draftId = ${JSON.stringify(importedState.active.id)};
    const handoffId = ${JSON.stringify(handoffId)};
    const mediaDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let attachment;
    try {
      attachment = await new Promise((resolve, reject) => {
        const transaction = mediaDatabase.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').get(draftId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      mediaDatabase.close();
    }
    if (!attachment?.blob) return false;

    const handoffDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!handoffDatabase.objectStoreNames.contains('handoffs')) return false;
      await new Promise((resolve, reject) => {
        const transaction = handoffDatabase.transaction('handoffs', 'readwrite');
        transaction.objectStore('handoffs').put({
          id: handoffId,
          blob: attachment.blob,
          name: attachment.name,
          type: attachment.type,
          lastModified: Number.isFinite(attachment.lastModified) ? attachment.lastModified : Date.now(),
          caption: ${JSON.stringify(SHARE_TARGET_CAPTION)},
          createdAt: Date.now(),
        }, handoffId);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      handoffDatabase.close();
    }
    return true;
  })()`);
  assert.equal(replayPrepared, true, 'The smoke should recreate the same valid handoff UUID and media record.');
  const replayLoadEvents = getPageLoadEvents();
  const replayUrl = new URL('/compose', appUrl);
  replayUrl.searchParams.set('shareImport', handoffId);
  await cdp.send('Page.navigate', { url: replayUrl.href });
  await waitUntil(cdp, 'a full navigation to the replayed share import or its completed canonical draft route', async () => (
    getPageLoadEvents() > replayLoadEvents
      && await evaluate(cdp, `(() => {
        const parameters = new URL(location.href).searchParams;
        return location.pathname === '/compose'
          && (parameters.get('shareImport') === ${JSON.stringify(handoffId)}
            || (parameters.has('letter') && !parameters.has('shareImport')));
      })()`)
  ));
  let lastReplaySnapshot;
  try {
    await waitUntil(cdp, 'same-ID handoff replay returns to the existing canonical draft', async () => {
      lastReplaySnapshot = await evaluate(cdp, `(() => {
        const url = new URL(location.href);
        const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
        return { url: location.href, query: Object.fromEntries(url.searchParams), activeDraftId: active?.id, content: active?.content, historyState: history.state };
      })()`);
      return lastReplaySnapshot.url.includes('/compose')
        && new URL(lastReplaySnapshot.url).searchParams.get('letter') === importedState.active.id
        && !new URL(lastReplaySnapshot.url).searchParams.has('shareImport')
        && lastReplaySnapshot.activeDraftId === importedState.active.id;
    });
  } catch (error) {
    throw new Error(`${error.message}; expectedDraftId=${JSON.stringify(importedState.active.id)}; same-ID replay state=${JSON.stringify(lastReplaySnapshot)}`);
  }
  const replayedState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const store = transaction.objectStore('attachments');
        const keysRequest = store.getAllKeys();
        const request = store.get(${JSON.stringify(importedState.active.id)});
        transaction.oncomplete = () => resolve({
          active,
          matchingDrafts: drafts.filter((draft) => draft.id === ${JSON.stringify(importedState.active.id)}).length,
          matchingAttachmentKeys: keysRequest.result.map(String).filter((key) => key.includes(${JSON.stringify(importedState.active.id)})).length,
          attachment: request.result ? { name: request.result.name, type: request.result.type, size: request.result.blob?.size || 0 } : null,
          previousDraft: drafts.find((draft) => draft.id === ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)}) || null,
          content: document.querySelector('#drop-content')?.value || '',
          subject: document.querySelector('#drop-subject')?.value || '',
          recipient: document.querySelector('#drop-recipient')?.value || '',
          url: location.href,
        });
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.equal(replayedState.active?.id, importedState.active.id, 'Replaying the same handoff in the mounted composer should reuse its original draft ID.');
  assert.ok(replayedState.matchingDrafts <= 1, 'Replaying the handoff should not duplicate draft history.');
  assert.equal(replayedState.matchingAttachmentKeys, importedDraftAttachments.length, 'Replaying the handoff should not change the draft attachment count.');
  assert.equal(replayedState.attachment?.name, SHARE_TARGET_FILENAME, 'The replay should retain the original attachment.');
  assert.equal(replayedState.attachment?.type, 'image/png', 'The replay should retain the attachment MIME type.');
  assert.ok(replayedState.attachment?.size > 0, 'The replay should retain the attachment bytes.');
  assert.equal(replayedState.active.content, SHARE_TARGET_REPLAY_EDITS.content, 'Replay should preserve the edited caption in the saved draft.');
  assert.equal(replayedState.active.subject, SHARE_TARGET_REPLAY_EDITS.subject, 'Replay should preserve the edited subject in the saved draft.');
  assert.equal(replayedState.active.recipient, SHARE_TARGET_REPLAY_EDITS.recipient, 'Replay should preserve the edited recipient in the saved draft.');
  assert.equal(replayedState.content, SHARE_TARGET_REPLAY_EDITS.content, 'Replay should preserve the edited caption in the composer.');
  assert.equal(replayedState.subject, SHARE_TARGET_REPLAY_EDITS.subject, 'Replay should preserve the edited subject in the composer.');
  assert.equal(replayedState.recipient, SHARE_TARGET_REPLAY_EDITS.recipient.replace(/^@/, ''), 'Replay should preserve the edited recipient in the composer.');
  assert.equal(replayedState.previousDraft?.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'The replay should preserve the earlier draft history.');
  assert.equal(new URL(replayedState.url).searchParams.get('letter'), importedState.active.id, 'The replay should return to the canonical original draft URL.');
  const cleanedReplayHandoff = await evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('handoffs', 'readwrite');
        transaction.objectStore('handoffs').delete(${JSON.stringify(handoffId)});
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return true;
    } finally {
      database.close();
    }
  })()`);
  assert.equal(cleanedReplayHandoff, true, 'The replay fixture should be removed from temporary storage after its check.');

  await setViewport(cdp, DESKTOP_VIEWPORT);
  await assertNoHorizontalOverflow(cdp, 'Share-target composer at desktop 1440px', 1440);
  const previousReloadEvents = getPageLoadEvents();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(cdp, 'a fresh composer document after share-import reload', async () => getPageLoadEvents() > previousReloadEvents);
  await waitUntil(cdp, 'the same saved share draft after reload', async () => (
    await evaluate(cdp, `location.pathname === '/compose'
      && new URL(location.href).searchParams.get('letter') === ${JSON.stringify(importedState.active.id)}
      && document.querySelector('#drop-content')?.value === ${JSON.stringify(SHARE_TARGET_REPLAY_EDITS.content)}
      && ${normalizedVisibleText('Saved privately on this device')}`)
  ));
  const reloadedState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').get(${JSON.stringify(importedState.active.id)});
        request.onsuccess = () => resolve({
          active,
          matchingDrafts: drafts.filter((draft) => draft.id === ${JSON.stringify(importedState.active.id)}).length,
          previousDraft: drafts.find((draft) => draft.id === ${JSON.stringify(SHARE_TARGET_PREVIOUS_DRAFT.id)}) || null,
          attachment: request.result ? { name: request.result.name, type: request.result.type || request.result.blob?.type, size: request.result.blob?.size || 0 } : null,
          url: location.href,
          recipient: document.querySelector('#drop-recipient')?.value || '',
          content: document.querySelector('#drop-content')?.value || '',
          subject: document.querySelector('#drop-subject')?.value || '',
          visibleImage: Array.from(document.querySelectorAll('img')).some((image) => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0),
        });
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.equal(reloadedState.active?.id, importedState.active.id, 'Reload should preserve the same active imported draft.');
  assert.ok(reloadedState.matchingDrafts <= 1, 'Reload should not duplicate the imported draft in local history.');
  assert.equal(reloadedState.previousDraft?.content, SHARE_TARGET_PREVIOUS_DRAFT.content, 'Reload should preserve the previous draft content in history.');
  assert.equal(reloadedState.previousDraft?.subject, SHARE_TARGET_PREVIOUS_DRAFT.subject, 'Reload should preserve the previous draft subject in history.');
  assert.equal(reloadedState.previousDraft?.recipient, SHARE_TARGET_PREVIOUS_DRAFT.recipient, 'Reload should preserve the previous draft recipient in history.');
  assert.equal(reloadedState.active.content, SHARE_TARGET_REPLAY_EDITS.content, 'Reload should preserve the edited caption in saved draft data.');
  assert.equal(reloadedState.active.subject, SHARE_TARGET_REPLAY_EDITS.subject, 'Reload should preserve the edited subject in saved draft data.');
  assert.equal(reloadedState.active.recipient, SHARE_TARGET_REPLAY_EDITS.recipient, 'Reload should preserve the edited recipient in saved draft data.');
  assert.equal(reloadedState.content, SHARE_TARGET_REPLAY_EDITS.content, 'Reload should preserve the edited caption.');
  assert.equal(reloadedState.subject, SHARE_TARGET_REPLAY_EDITS.subject, 'Reload should preserve the edited subject.');
  assert.equal(reloadedState.recipient, SHARE_TARGET_REPLAY_EDITS.recipient.replace(/^@/, ''), 'Reload should preserve the edited recipient.');
  assert.equal(reloadedState.active.status, 'draft', 'Reload should not send the imported drop.');
  assert.equal(reloadedState.active.dispatchedAt, undefined, 'Reload should not add a dispatch timestamp.');
  assert.equal(reloadedState.attachment?.name, SHARE_TARGET_FILENAME, 'Reload should preserve the local PNG attachment.');
  assert.equal(reloadedState.attachment?.type, 'image/png', 'Reload should preserve the attachment MIME type.');
  assert.ok(reloadedState.attachment?.size > 0, 'Reload should preserve the PNG bytes.');
  assert.equal(reloadedState.visibleImage, true, 'Reload should restore the visible image preview.');
  const reloadedUrl = new URL(reloadedState.url);
  assert.deepEqual(Array.from(reloadedUrl.searchParams.keys()), ['letter'], 'Reload should retain only the canonical draft query.');
  assert.equal(reloadedState.url.includes(SHARE_TARGET_REPLAY_EDITS.content), false, 'The edited caption should remain out of the URL after reload.');
  await assertNoFrameworkOverlay(cdp, 'Share-target draft after reload');
  await setViewport(cdp, viewport);
  await assertNoHorizontalOverflow(cdp, 'Share-target draft after reload at 390px', 390);
  if (screenshotDir) await captureScreenshot(cdp, screenshotDir, 'mobile-390-share-target-reload');

  const sentReplayFixture = await evaluate(cdp, `(async () => {
    const sentDraftId = ${JSON.stringify(importedState.active.id)};
    const handoffId = ${JSON.stringify(handoffId)};
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    if (active?.id !== sentDraftId || active.status !== 'draft') return null;
    const sentAt = new Date().toISOString();
    localStorage.setItem('dear-exe:active-letter:v1', JSON.stringify({ ...active, status: 'sent', dispatchedAt: sentAt }));

    const mediaDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let attachment;
    try {
      attachment = await new Promise((resolve, reject) => {
        const transaction = mediaDatabase.transaction('attachments', 'readonly');
        const store = transaction.objectStore('attachments');
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        transaction.oncomplete = () => {
          const index = keysRequest.result.findIndex((key) => String(key).includes(sentDraftId));
          resolve(index < 0 ? null : { key: String(keysRequest.result[index]), value: valuesRequest.result[index] });
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      mediaDatabase.close();
    }
    if (!attachment?.value?.blob) return null;

    const handoffDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('drop-share-target-handoffs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!handoffDatabase.objectStoreNames.contains('handoffs')) return null;
      await new Promise((resolve, reject) => {
        const transaction = handoffDatabase.transaction('handoffs', 'readwrite');
        transaction.objectStore('handoffs').put({
          id: handoffId,
          blob: attachment.value.blob,
          name: attachment.value.name,
          type: attachment.value.type || attachment.value.blob.type,
          lastModified: Number.isFinite(attachment.value.lastModified) ? attachment.value.lastModified : Date.now(),
          caption: ${JSON.stringify(SHARE_TARGET_CAPTION)},
          createdAt: Date.now(),
        }, handoffId);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      handoffDatabase.close();
    }
    return { sentDraftId, sentAt, attachmentKey: attachment.key };
  })()`);
  assert.ok(sentReplayFixture, 'The smoke should stage the imported draft as sent and recreate its handoff for a non-reactivation check.');
  const sentReplayLoadEvents = getPageLoadEvents();
  const sentReplayUrl = new URL('/compose', appUrl);
  sentReplayUrl.searchParams.set('shareImport', handoffId);
  await cdp.send('Page.navigate', { url: sentReplayUrl.href });
  await waitUntil(cdp, 'sent handoff replay creates a new editable draft', async () => (
    getPageLoadEvents() > sentReplayLoadEvents
      && await evaluate(cdp, `location.pathname === '/compose'
        && new URL(location.href).searchParams.has('letter')
        && !new URL(location.href).searchParams.has('shareImport')
        && JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null')?.id !== ${JSON.stringify(sentReplayFixture.sentDraftId)}`)
  ));
  const sentReplayState = await evaluate(cdp, `(async () => {
    const active = JSON.parse(localStorage.getItem('dear-exe:active-letter:v1') || 'null');
    const drafts = JSON.parse(localStorage.getItem('dear-exe:letter-drafts:v1') || '[]');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dear-exe-draft-media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const keysRequest = transaction.objectStore('attachments').getAllKeys();
        const valuesRequest = transaction.objectStore('attachments').getAll();
        transaction.oncomplete = () => {
          const attachments = valuesRequest.result.map((value, index) => ({ key: String(keysRequest.result[index]), name: value?.name || '', size: value?.blob?.size || 0 }));
          const sentRecord = drafts.find((draft) => draft.id === ${JSON.stringify(sentReplayFixture.sentDraftId)}) || null;
          const newDraftAttachments = attachments.filter((attachment) => attachment.key.includes(active?.id || ''));
          const sentDraftAttachments = attachments.filter((attachment) => attachment.key.includes(${JSON.stringify(sentReplayFixture.sentDraftId)}));
          resolve({
            active,
            sentRecord,
            sentHistoryCount: drafts.filter((draft) => draft.id === ${JSON.stringify(sentReplayFixture.sentDraftId)}).length,
            newDraftAttachments,
            sentDraftAttachments,
            url: location.href,
            content: document.querySelector('#drop-content')?.value || '',
            recipient: document.querySelector('#drop-recipient')?.value || '',
          });
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  })()`);
  assert.ok(sentReplayState.active?.id && sentReplayState.active.id !== sentReplayFixture.sentDraftId, 'A replay must not reactivate a sent draft.');
  assert.equal(sentReplayState.active.status, 'draft', 'A replay of sent media should create a new unsent draft.');
  assert.equal(sentReplayState.active.dispatchedAt, undefined, 'The new replay draft should not inherit a send timestamp.');
  assert.equal(sentReplayState.active.content, SHARE_TARGET_CAPTION, 'The new draft should use the recreated handoff caption.');
  assert.equal(sentReplayState.active.recipient, '', 'The new draft should leave its recipient blank.');
  assert.equal(sentReplayState.content, SHARE_TARGET_CAPTION, 'The new draft caption should be visible in the composer.');
  assert.equal(sentReplayState.recipient, '', 'The new replay draft should leave the composer recipient blank.');
  assert.equal(sentReplayState.sentRecord?.id, sentReplayFixture.sentDraftId, 'The original sent draft should remain in local draft history.');
  assert.equal(sentReplayState.sentRecord?.status, 'sent', 'The original record should remain marked sent.');
  assert.equal(sentReplayState.sentRecord?.dispatchedAt, sentReplayFixture.sentAt, 'The original send timestamp should remain intact.');
  assert.equal(sentReplayState.sentRecord?.content, SHARE_TARGET_REPLAY_EDITS.content, 'The original sent caption should remain intact.');
  assert.equal(sentReplayState.sentRecord?.subject, SHARE_TARGET_REPLAY_EDITS.subject, 'The original sent subject should remain intact.');
  assert.equal(sentReplayState.sentRecord?.recipient, SHARE_TARGET_REPLAY_EDITS.recipient, 'The original sent recipient should remain intact.');
  assert.equal(sentReplayState.sentHistoryCount, 1, 'The sent draft should be preserved exactly once in draft history.');
  assert.equal(sentReplayState.sentDraftAttachments.length, 1, 'The original sent draft should retain exactly one attachment.');
  assert.equal(sentReplayState.newDraftAttachments.length, 1, 'The new replay draft should have exactly one attachment.');
  const sentReplayCanonicalUrl = new URL(sentReplayState.url);
  assert.equal(sentReplayCanonicalUrl.searchParams.get('letter'), sentReplayState.active.id, 'The sent replay should finish at the new draft URL.');
  assert.deepEqual(Array.from(sentReplayCanonicalUrl.searchParams.keys()), ['letter'], 'The sent replay URL should contain only the new draft ID.');

  assert.equal(getShareForbiddenRequests().length, 0, `The share import should not issue Auth or REST/Storage writes: ${JSON.stringify(getShareForbiddenRequests())}`);
  assert.equal(getBlockedRequestCount(), beforeImportBlockedRequests, 'The share import should not initiate cross-origin requests.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/browser-demo-smoke.mjs [http://127.0.0.1:4004] [--claim-recovery-only|--prompt-only|--friend-draft-only|--share-target-only|--drop-back-only]');
    return;
  }

  const args = process.argv.slice(2);
  const claimRecoveryOnly = args.includes('--claim-recovery-only');
  const promptOnly = args.includes('--prompt-only');
  const friendDraftOnly = args.includes('--friend-draft-only');
  const shareTargetOnly = args.includes('--share-target-only');
  const dropBackOnly = args.includes('--drop-back-only');
  assert.ok([claimRecoveryOnly, promptOnly, friendDraftOnly, shareTargetOnly, dropBackOnly].filter(Boolean).length <= 1, 'Choose only one focused browser-smoke mode.');
  const appUrl = parseAppUrl(args.find((argument) => !argument.startsWith('--')) || DEFAULT_APP_URL);
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
  let capturingRecoveryBackendRequests = false;
  const blockedOrigins = new Set();
  const forbiddenRequests = [];
  const recoveryBackendRequests = [];
  const pageConsoleErrors = [];
  const pageExceptions = [];
  let blockedRequestCount = 0;
  let browserStderr = '';
  let pageTargetId;
  let pageLoadEvents = 0;
  let chromeStopped = false;
  let capturingShareImportRequests = false;
  const shareImportRequests = [];
  const shareTargetRedirects = [];
  const shareImportForbiddenRequests = [];

  try {
    const hostnameForResolver = appUrl.hostname.replace(/^\[|\]$/g, '');
    const resolverRule = `MAP * ~NOTFOUND, EXCLUDE ${hostnameForResolver}`;
    console.log(`[browser-demo-smoke] Starting isolated Chrome: ${chromeExecutable}`);
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
    console.log('[browser-demo-smoke] Chrome DevTools is ready.');
    const versionInfo = await requestJson(`http://127.0.0.1:${devTools.port}/json/version`);
    assert.equal(typeof versionInfo.webSocketDebuggerUrl, 'string', 'Chrome did not expose its DevTools WebSocket URL.');
    browserCdp = await CdpConnection.connect(devTools.browserWebSocketUrl, interrupted.signal);

    const target = await requestJson(`http://127.0.0.1:${devTools.port}/json/new?about:blank`, { method: 'PUT' });
    console.log('[browser-demo-smoke] Connected to the isolated Chrome page.');
    pageTargetId = target.id;
    assert.equal(typeof target.webSocketDebuggerUrl, 'string', 'Chrome did not create an isolated page target.');
    pageCdp = await CdpConnection.connect(target.webSocketDebuggerUrl, interrupted.signal);
    pageCdp.on('Page.loadEventFired', () => { pageLoadEvents += 1; });
    pageCdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      pageExceptions.push(exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown browser exception');
    });
    pageCdp.on('Runtime.consoleAPICalled', ({ type, args = [], stackTrace }) => {
      if (type !== 'error') return;
      const message = args.map((argument) => argument.value ?? argument.description ?? '').filter(Boolean).join(' ');
      const frames = stackTrace?.callFrames?.map((frame) => `${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`).join(' <- ');
      pageConsoleErrors.push(frames ? `${message} (${frames})` : message);
    });

    pageCdp.on('Network.requestWillBeSent', ({ request, redirectResponse }) => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url);
      } catch {
        return;
      }
      const method = (request.method || 'GET').toUpperCase();
      const path = requestUrl.pathname;
      if (capturingShareImportRequests) {
        const entry = { method, path, origin: requestUrl.origin };
        shareImportRequests.push(entry);
        if (requestUrl.origin !== appUrl.origin) {
          // The fetch firewall should reject every cross-origin request attempted during import.
          shareImportForbiddenRequests.push({ ...entry, reason: 'cross-origin request' });
        }
        if (redirectResponse) {
          let redirectedFrom;
          try {
            redirectedFrom = new URL(redirectResponse.url || request.url);
          } catch {
            redirectedFrom = null;
          }
          const headers = redirectResponse.headers || {};
          const locationHeader = Object.entries(headers).find(([name]) => name.toLowerCase() === 'location')?.[1] || '';
          if (redirectedFrom?.pathname === '/share-target') {
            shareTargetRedirects.push({ path: redirectedFrom.pathname, status: redirectResponse.status, location: String(locationHeader) });
          }
        }
        const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const expectedShareNavigation = path === '/share-target' && method === 'POST';
        if (isWrite && !expectedShareNavigation) shareImportForbiddenRequests.push({ ...entry, reason: 'unexpected write during import, including possible send' });
      }
      if (capturingRecoveryBackendRequests && /\/(?:auth|rest|storage)\/v1\//i.test(path)) {
        recoveryBackendRequests.push({ method, path });
      }
      if (/\/auth\/v1\//i.test(path)
        || /\/rest\/v1\/rpc\//i.test(path)
        || (/\/storage\/v1\//i.test(path) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))) {
        forbiddenRequests.push({ method, path });
      }
    });

    pageCdp.on('Network.responseReceived', ({ response }) => {
      if (!capturingShareImportRequests) return;
      let responseUrl;
      try {
        responseUrl = new URL(response.url);
      } catch {
        return;
      }
      if (responseUrl.pathname === '/share-target') {
        shareTargetRedirects.push({ path: responseUrl.pathname, status: response.status, location: response.headers?.location || response.headers?.Location || '' });
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
        if (capturingShareImportRequests) shareImportForbiddenRequests.push({ method: request.method || 'GET', url: request.url, reason: 'cross-origin request blocked by browser firewall' });
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
    const flowName = dropBackOnly ? 'drop-back-only' : shareTargetOnly ? 'share-target-only' : claimRecoveryOnly ? 'claim-recovery' : promptOnly ? 'prompt-only' : friendDraftOnly ? 'friend-draft-only' : 'full';
    const flowViewports = friendDraftOnly || shareTargetOnly || dropBackOnly ? [MOBILE_VIEWPORTS[1]] : FLOW_VIEWPORTS;
    console.log(`[browser-demo-smoke] App: ${appUrl.origin}; ${flowName} flow viewports: ${flowViewports.map(({ name }) => name).join(', ')}.`);

    if (dropBackOnly) {
      await runDropBackFlow(pageCdp, { appUrl, screenshotDir });
      console.log(`[browser-demo-smoke] PASS keyboard Drop back creates a fresh sender-addressed draft at ${MOBILE_VIEWPORTS[1].width}×${MOBILE_VIEWPORTS[1].height}; existing photo fields and exact bytes stay preserved; no send occurs.`);
    }

    if (shareTargetOnly) {
      await runShareTargetFlow(pageCdp, {
        appUrl,
        screenshotDir,
        getPageLoadEvents: () => pageLoadEvents,
        captureShareRequests: (capturing) => { capturingShareImportRequests = capturing; },
        getShareRequests: () => shareImportRequests,
        getShareRedirects: () => shareTargetRedirects,
        getShareForbiddenRequests: () => shareImportForbiddenRequests,
        getBlockedRequestCount: () => blockedRequestCount,
      });
      capturingShareImportRequests = false;
      console.log('[browser-demo-smoke] PASS installed web manifest and controlled same-origin service-worker share target.');
      console.log('[browser-demo-smoke] PASS multipart synthetic PNG navigation POST, opaque 303 handoff, fresh local draft, shared caption, blank recipient, and canonical URL.');
      console.log('[browser-demo-smoke] PASS existing draft preserved; same-ID replay and reload retain edited caption, subject, recipient, and the single attachment.');
      console.log('[browser-demo-smoke] PASS replaying a sent handoff creates a fresh draft and leaves the original sent record intact.');
      console.log('[browser-demo-smoke] PASS no horizontal overflow at 375×844, 390×844, 844×390, or 1440×900; no Auth/REST/Storage/app API writes or cross-origin requests during import.');
      console.log('[browser-demo-smoke] NOTE This headless browser check does not verify PWA installation or the operating-system share sheet.');
    }

    if (friendDraftOnly) {
      const viewport = MOBILE_VIEWPORTS[1];
      await runDemoFlow(pageCdp, {
        appUrl,
        viewport,
        payload: 'gif',
        keyboard: true,
        verifyFreshDraft: true,
        screenshotDir,
        screenshotSteps: new Set(['home', 'sender-copy']),
        getPageLoadEvents: () => pageLoadEvents,
      });
      console.log(`[browser-demo-smoke] PASS keyboard sender-copy to fresh editable text draft at ${viewport.width}×${viewport.height}; existing media draft and local demo remain preserved.`);
    }

    if (!friendDraftOnly && !claimRecoveryOnly && !promptOnly && !shareTargetOnly && !dropBackOnly) {
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
    }

    if (!friendDraftOnly && !claimRecoveryOnly && !shareTargetOnly && !dropBackOnly) {
      for (const viewport of FLOW_VIEWPORTS) {
        await runWritingPromptFlow(pageCdp, {
          appUrl,
          viewport,
          keyboard: true,
          screenshotDir: viewport.width === 390 || !viewport.mobile ? screenshotDir : null,
        });
        console.log(`[browser-demo-smoke] PASS keyboard prompt-to-editable-draft flow and existing attachment preservation at ${viewport.width}×${viewport.height}${viewport.mobile ? '' : ' desktop'}.`);
      }
    }

    if (!friendDraftOnly && !promptOnly && !shareTargetOnly && !dropBackOnly) {
      for (const viewport of FLOW_VIEWPORTS) {
        await runRecipientlessClaimChoiceFlow(pageCdp, {
          appUrl,
          viewport,
          keyboard: true,
        });
        console.log(`[browser-demo-smoke] PASS keyboard handleless claim choice and focus recovery at ${viewport.width}×${viewport.height}${viewport.mobile ? '' : ' desktop'}.`);
      }

      capturingRecoveryBackendRequests = true;
      for (const viewport of FLOW_VIEWPORTS) {
        await runClaimRecoveryFlow(pageCdp, {
          appUrl,
          viewport,
          keyboard: true,
          screenshotDir: viewport.width === 390 || !viewport.mobile ? screenshotDir : null,
          getPageLoadEvents: () => pageLoadEvents,
        });
        console.log(`[browser-demo-smoke] PASS keyboard saved-claim recovery at ${viewport.width}×${viewport.height}${viewport.mobile ? '' : ' desktop'}.`);
      }
      capturingRecoveryBackendRequests = false;
    }

    if (!shareTargetOnly) assert.deepEqual(forbiddenRequests, [], `The local browser flow made forbidden auth, RPC, or Storage write requests: ${JSON.stringify(forbiddenRequests)}.`);
    assert.deepEqual(recoveryBackendRequests, [], `The saved-claim recovery flow made Auth, REST, or Storage requests without a configured backend: ${JSON.stringify(recoveryBackendRequests)}.`);
    assert.deepEqual(pageConsoleErrors, [], `The browser reported console errors: ${JSON.stringify(pageConsoleErrors)}.`);
    assert.deepEqual(pageExceptions, [], `The browser reported JavaScript exceptions: ${JSON.stringify(pageExceptions)}.`);
    if (firewallFailure) throw new Error(`The browser network gate failed: ${firewallFailure.message}`);

    if (!friendDraftOnly && !promptOnly && !shareTargetOnly && !dropBackOnly) {
      console.log('[browser-demo-smoke] PASS saved-claim recovery after reload, including the encoded detail route and fresh-link action at all mobile and desktop widths.');
      console.log('[browser-demo-smoke] PASS handleless claim disclosure, account readiness gate, and focus recovery at all mobile and desktop widths.');
      console.log('[browser-demo-smoke] PASS no Auth, REST, or Storage request during the saved-claim recovery flow.');
    }
    if (!friendDraftOnly && !claimRecoveryOnly && !promptOnly && !shareTargetOnly && !dropBackOnly) {
      console.log('[browser-demo-smoke] PASS photo flow at 390×844, including saved reaction, reload persistence, and sender copy.');
      console.log('[browser-demo-smoke] PASS no horizontal overflow on Home and demo chooser at 360, 390, 430px and 1440×900.');
      console.log('[browser-demo-smoke] PASS no Auth, RPC, or Storage write request during the local demo.');
    }
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
