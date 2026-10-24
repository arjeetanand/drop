'use strict';

const HANDOFF_DB = 'drop-share-target-handoffs';
const HANDOFF_DB_VERSION = 1;
const HANDOFF_STORE = 'handoffs';
const HANDOFF_TTL_MS = 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_MEDIA_BYTES + 64 * 1024;
const MAX_CAPTION_LENGTH = 5000;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const HANDOFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HANDOFF_KEYS = ['blob', 'caption', 'createdAt', 'id', 'lastModified', 'name', 'type'];
const ALLOWED_ERROR_CODES = new Set([
  'invalid-share',
  'unsupported-media',
  'too-large',
  'storage-unavailable',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'POST' ||
    url.origin !== self.location.origin ||
    url.pathname !== '/share-target' ||
    url.search !== ''
  ) {
    return;
  }

  // Share payloads stay in this local handoff. Matched POST requests never fall through to a server.
  event.respondWith(handleShareTarget(request));
});

async function handleShareTarget(request) {
  const parsed = await readShareFormData(request);
  if (parsed.error) return redirectToCompose({ shareError: parsed.error });
  const formData = parsed.formData;

  const mediaEntries = formData.getAll('media');
  if (mediaEntries.length !== 1 || !(mediaEntries[0] instanceof File)) {
    return redirectToCompose({ shareError: 'invalid-share' });
  }

  const media = mediaEntries[0];
  const mediaType = media.type.toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return redirectToCompose({ shareError: 'unsupported-media' });
  }
  if (media.size <= 0) {
    return redirectToCompose({ shareError: 'invalid-share' });
  }
  if (media.size > MAX_MEDIA_BYTES) {
    return redirectToCompose({ shareError: 'too-large' });
  }

  const id = crypto.randomUUID();
  const text = formData.get('text');
  const title = formData.get('title');
  const sharedText = typeof text === 'string' ? text.trim() : '';
  const sharedTitle = typeof title === 'string' ? title.trim() : '';
  const caption = boundedCaption(sharedText || sharedTitle);
  const name = sanitizeFileName(media.name);
  const createdAt = Date.now();

  try {
    await storeHandoff({
      id,
      blob: media,
      name,
      type: mediaType,
      lastModified: Number.isFinite(media.lastModified) ? media.lastModified : Date.now(),
      caption,
      createdAt,
    }, createdAt);
  } catch {
    return redirectToCompose({ shareError: 'storage-unavailable' });
  }

  return redirectToCompose({ shareImport: id });
}

async function readShareFormData(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\b/i.test(contentType)) return { error: 'invalid-share' };

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return { error: 'invalid-share' };
    if (contentLength > MAX_MULTIPART_BYTES) return { error: 'too-large' };
  }

  if (!request.body || typeof request.body.getReader !== 'function') return { error: 'invalid-share' };

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_MULTIPART_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { error: 'too-large' };
      }
      chunks.push(value);
    }

    const body = new Blob(chunks);
    return { formData: await new Response(body, { headers: { 'Content-Type': contentType } }).formData() };
  } catch {
    return { error: 'invalid-share' };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation or parsing already stopped the body reader.
    }
  }
}

function sanitizeFileName(value) {
  const safeName = value
    .replace(/[\\/\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return safeName || 'shared-media';
}

function boundedCaption(value) {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > MAX_CAPTION_LENGTH) break;
    result += character;
  }
  return result;
}

function redirectToCompose(parameters) {
  const destination = new URL('/compose', self.location.origin);
  if (parameters.shareImport) {
    destination.searchParams.set('shareImport', parameters.shareImport);
  } else {
    const requestedError = parameters.shareError;
    const errorCode = ALLOWED_ERROR_CODES.has(requestedError) ? requestedError : 'invalid-share';
    destination.searchParams.set('shareError', errorCode);
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.href,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function storeHandoff(handoff, now) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const openRequest = indexedDB.open(HANDOFF_DB, HANDOFF_DB_VERSION);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(HANDOFF_STORE)) {
        database.createObjectStore(HANDOFF_STORE);
      }
    };

    openRequest.onerror = () => fail(openRequest.error || new Error('Unable to open share handoff storage.'));
    openRequest.onblocked = () => fail(new Error('Share handoff storage is busy.'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      if (settled) {
        database.close();
        return;
      }

      let transaction;
      try {
        transaction = database.transaction(HANDOFF_STORE, 'readwrite');
        const store = transaction.objectStore(HANDOFF_STORE);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            store.put(handoff, handoff.id);
            return;
          }

          if (!isValidStoredHandoff(cursor.value, cursor.primaryKey, now)) cursor.delete();
          cursor.continue();
        };
      } catch (error) {
        database.close();
        fail(error);
        return;
      }

      transaction.oncomplete = () => {
        database.close();
        if (settled) return;
        settled = true;
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        fail(transaction.error || new Error('Unable to save the shared media.'));
      };
      transaction.onabort = () => {
        database.close();
        fail(transaction.error || new Error('Unable to save the shared media.'));
      };
    };
  });
}

function isValidStoredHandoff(value, key, now) {
  if (!value || typeof value !== 'object' || typeof key !== 'string' || !HANDOFF_ID_PATTERN.test(key)) return false;

  const handoff = value;
  const keys = Object.keys(handoff).sort();
  if (
    keys.length !== HANDOFF_KEYS.length ||
    keys.some((entry, index) => entry !== HANDOFF_KEYS[index])
  ) {
    return false;
  }
  if (handoff.id !== key || !(handoff.blob instanceof Blob)) return false;
  if (typeof handoff.name !== 'string' || handoff.name.trim().length === 0) return false;
  if (!ALLOWED_MEDIA_TYPES.has(handoff.type) || handoff.blob.size <= 0 || handoff.blob.size > MAX_MEDIA_BYTES) return false;
  if (!Number.isFinite(handoff.lastModified) || handoff.lastModified < 0) return false;
  if (typeof handoff.caption !== 'string' || handoff.caption.length > MAX_CAPTION_LENGTH) return false;
  if (!Number.isFinite(handoff.createdAt) || handoff.createdAt < 0 || handoff.createdAt > now) return false;

  return now - handoff.createdAt < HANDOFF_TTL_MS;
}
