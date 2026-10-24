import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function loadFetchHandler() {
  const listeners = new Map();
  runInNewContext(source, {
    self: {
      location: { origin: 'https://drop.test' },
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    URL,
    Response,
    Blob,
    File,
    crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
    indexedDB: { open: () => { throw new Error('IndexedDB is unavailable in this parser test.'); } },
  });
  return listeners.get('fetch');
}

async function dispatchShareRequest(request) {
  let responsePromise;
  loadFetchHandler()({
    request,
    respondWith: (response) => { responsePromise = Promise.resolve(response); },
  });
  assert.ok(responsePromise, 'the service worker should intercept the share-target POST');
  return responsePromise;
}

function shareRequest({ contentLength, contentType = 'multipart/form-data; boundary=test-boundary', body }) {
  return {
    method: 'POST',
    url: 'https://drop.test/share-target',
    headers: {
      get: (name) => {
        if (name === 'content-type') return contentType;
        if (name === 'content-length') return contentLength ?? null;
        return null;
      },
    },
    body,
  };
}

test('rejects an oversized declared multipart body before reading or parsing it', async () => {
  let read = false;
  const response = await dispatchShareRequest(shareRequest({
    contentLength: String(9 * 1024 * 1024),
    body: {
      getReader: () => {
        read = true;
        throw new Error('an oversized declared body should not be read');
      },
    },
  }));

  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('shareError'), 'too-large');
  assert.equal(read, false);
});

test('bounds a streamed multipart body when Content-Length is absent', async () => {
  let cancelled = false;
  const response = await dispatchShareRequest(shareRequest({
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(9 * 1024 * 1024) }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => undefined,
      }),
    },
  }));

  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('shareError'), 'too-large');
  assert.equal(cancelled, true);
});

test('bounds a streamed multipart body when Content-Length understates it', async () => {
  let cancelled = false;
  const response = await dispatchShareRequest(shareRequest({
    contentLength: '1',
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(9 * 1024 * 1024) }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => undefined,
      }),
    },
  }));

  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('shareError'), 'too-large');
  assert.equal(cancelled, true);
});

test('preserves the original case-sensitive multipart boundary while parsing', async () => {
  const boundary = 'MixedCaseBOUNDARY123';
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="media"; filename="tiny.png"\r\n',
    'Content-Type: image/png\r\n\r\n',
    new Uint8Array([1, 2, 3]),
    `\r\n--${boundary}--\r\n`,
  ]);
  const response = await dispatchShareRequest(shareRequest({
    contentLength: String(body.size),
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: body.stream(),
  }));

  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('shareError'), 'storage-unavailable');
});
