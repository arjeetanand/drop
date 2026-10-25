import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function loadFetchHandler(indexedDB = {
  open: () => { throw new Error('IndexedDB is unavailable in this parser test.'); },
}) {
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
    indexedDB,
  });
  return listeners.get('fetch');
}

async function dispatchShareRequest(request, indexedDB) {
  let responsePromise;
  loadFetchHandler(indexedDB)({
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

function indexedDBWithEmptyHandoffStore(onPut) {
  return {
    open: () => {
      const request = { result: null, error: null };
      const database = {
        objectStoreNames: { contains: () => false },
        createObjectStore: () => undefined,
        close: () => undefined,
        transaction: () => {
          const transaction = { error: null };
          const store = {
            openCursor: () => {
              const cursorRequest = { result: null };
              queueMicrotask(() => cursorRequest.onsuccess?.());
              return cursorRequest;
            },
            put: (value, key) => {
              onPut(value, key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
          };
          transaction.objectStore = () => store;
          return transaction;
        },
      };

      request.result = database;
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        queueMicrotask(() => request.onsuccess?.());
      });
      return request;
    },
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

test('stores a valid shared file in IndexedDB and redirects with an opaque handoff id', async () => {
  const boundary = 'DropShareBoundary';
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0xff]);
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="text"\r\n\r\n',
    'Caption from shared text\r\n',
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="title"\r\n\r\n',
    'Fallback title should not replace text\r\n',
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="url"\r\n\r\n',
    'https://shared.example/private-link\r\n',
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="media"; filename="celebration.gif"\r\n',
    'Content-Type: image/gif\r\n\r\n',
    bytes,
    `\r\n--${boundary}--\r\n`,
  ]);
  let stored;
  const indexedDB = indexedDBWithEmptyHandoffStore((value, key) => {
    stored = { value, key };
  });
  const response = await dispatchShareRequest(shareRequest({
    contentLength: String(body.size),
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: body.stream(),
  }), indexedDB);

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, 'https://drop.test');
  assert.equal(location.pathname, '/compose');
  assert.deepEqual([...location.searchParams.keys()], ['shareImport']);
  assert.equal(location.searchParams.get('shareImport'), '123e4567-e89b-42d3-a456-426614174000');
  assert.doesNotMatch(location.href, /Caption from shared text|private-link|celebration\.gif/);

  assert.ok(stored, 'the handoff should be persisted before redirecting');
  assert.equal(stored.key, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(stored.value.id, stored.key);
  assert.equal(stored.value.name, 'celebration.gif');
  assert.equal(stored.value.type, 'image/gif');
  assert.equal(stored.value.caption, 'Caption from shared text');
  assert.doesNotMatch(stored.value.caption, /Fallback title|private-link/);
  assert.deepEqual([...new Uint8Array(await stored.value.blob.arrayBuffer())], [...bytes]);
});
