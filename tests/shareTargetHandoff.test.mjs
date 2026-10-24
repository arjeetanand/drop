import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupShareTargetHandoffs,
  deleteShareTargetHandoff,
  getShareTargetHandoff,
  isValidShareTargetHandoffId,
  MAX_SHARE_TARGET_CAPTION_CHARS,
  normalizeShareTargetHandoffCaption,
  saveShareTargetHandoff,
  SHARE_TARGET_HANDOFF_TTL_MS,
  validateShareTargetHandoffFile,
} from '../lib/shareTargetHandoff.ts';
import { MAX_DROP_MEDIA_BYTES } from '../lib/dropValidation.ts';

const VALID_ID = '9d3c2637-d960-4af4-89a0-0d22e1b6bd89';

function memoryIndexedDb(records = new Map()) {
  const stores = new Set();
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) {
      stores.add(name);
      return {};
    },
    transaction(storeName) {
      assert.equal(storeName, 'handoffs');
      let pending = 0;
      const transaction = {};
      const completeIfIdle = () => {
        if (pending === 0) queueMicrotask(() => transaction.oncomplete?.());
      };
      const store = {
        openCursor() {
          pending += 1;
          const entries = [...records.entries()];
          let index = 0;
          const request = {};
          const deliverCursor = () => {
            if (index >= entries.length) {
              request.result = null;
              request.onsuccess?.();
              pending -= 1;
              completeIfIdle();
              return;
            }

            const [key, value] = entries[index];
            request.result = {
              key,
              primaryKey: key,
              value,
              delete() {
                records.delete(key);
                return {};
              },
              continue() {
                index += 1;
                queueMicrotask(deliverCursor);
              },
            };
            request.onsuccess?.();
          };
          queueMicrotask(deliverCursor);
          return request;
        },
        get(key) {
          pending += 1;
          const request = {};
          queueMicrotask(() => {
            request.result = records.get(key);
            request.onsuccess?.();
            pending -= 1;
            completeIfIdle();
          });
          return request;
        },
        put(value, key) {
          pending += 1;
          queueMicrotask(() => {
            records.set(key, value);
            pending -= 1;
            completeIfIdle();
          });
        },
        delete(key) {
          pending += 1;
          queueMicrotask(() => {
            records.delete(key);
            pending -= 1;
            completeIfIdle();
          });
        },
      };
      transaction.objectStore = () => store;
      return transaction;
    },
    close() {},
  };

  return {
    records,
    indexedDb: {
      open(name, version) {
        assert.equal(name, 'drop-share-target-handoffs');
        assert.equal(version, 1);
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

function installIndexedDb(t, indexedDb) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { indexedDB: indexedDb },
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
}

function imageFile({ type = 'image/png', size = 4, name = 'photo.png', lastModified = 123 } = {}) {
  return new File([new Uint8Array(size)], name, { type, lastModified });
}

test('accepts only canonical lowercase UUID v4 handoff IDs', () => {
  assert.equal(isValidShareTargetHandoffId(VALID_ID), true);
  for (const id of [
    '',
    VALID_ID.toUpperCase(),
    '9d3c2637-d960-1af4-89a0-0d22e1b6bd89',
    '9d3c2637-d960-4af4-79a0-0d22e1b6bd89',
    '9d3c2637d9604af489a00d22e1b6bd89',
    `${VALID_ID}?caption=private`,
    null,
  ]) {
    assert.equal(isValidShareTargetHandoffId(id), false, String(id));
  }
});

test('reuses Drop media validation for allowed MIME types and the 8 MiB limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(validateShareTargetHandoffFile({ type, size: MAX_DROP_MEDIA_BYTES }), null);
  }
  assert.match(validateShareTargetHandoffFile(null) ?? '', /Choose/);
  assert.match(validateShareTargetHandoffFile({ type: 'image/svg+xml', size: 20 }) ?? '', /JPG/);
  assert.match(validateShareTargetHandoffFile({ type: 'image/png', size: MAX_DROP_MEDIA_BYTES + 1 }) ?? '', /8 MB/);
  assert.match(validateShareTargetHandoffFile({ type: 'image/png', size: 0 }) ?? '', /8 MB/);
});

test('prefers shared text, falls back to title, ignores URL, and safely bounds captions', () => {
  assert.equal(normalizeShareTargetHandoffCaption({
    text: '  shared caption  ',
    title: 'Page title',
    url: 'https://example.test/private',
  }), 'shared caption');
  assert.equal(normalizeShareTargetHandoffCaption({ text: '   ', title: '  Page title  ', url: 'https://example.test/private' }), 'Page title');
  assert.equal(normalizeShareTargetHandoffCaption({ text: '', title: '', url: 'https://example.test/private' }), '');

  const long = `${'x'.repeat(MAX_SHARE_TARGET_CAPTION_CHARS - 1)}🌈rest`;
  const bounded = normalizeShareTargetHandoffCaption({ text: long, title: 'fallback' });
  assert.equal(bounded.length, MAX_SHARE_TARGET_CAPTION_CHARS - 1);
  assert.equal(bounded.endsWith('🌈'), false);
  assert.doesNotMatch(bounded, /https?:\/\//);
});

test('saves and reads a validated one-time handoff without consuming it', async (t) => {
  const db = memoryIndexedDb();
  installIndexedDb(t, db.indexedDb);
  const now = 1_800_000_000_000;
  const file = imageFile({ type: 'image/gif', name: 'mood.gif', lastModified: 456 });

  await saveShareTargetHandoff(VALID_ID, file, { text: 'mood for the group chat', title: 'Original page' }, now);
  const stored = db.records.get(VALID_ID);
  assert.deepEqual(Object.keys(stored).sort(), ['blob', 'caption', 'createdAt', 'id', 'lastModified', 'name', 'type']);
  assert.equal(stored.id, VALID_ID);
  assert.equal(stored.caption, 'mood for the group chat');
  assert.equal(stored.createdAt, now);
  assert.equal(stored.name, 'mood.gif');
  assert.equal(stored.type, 'image/gif');
  assert.equal(stored.lastModified, 456);
  assert.equal(await stored.blob.text(), await file.text());

  const first = await getShareTargetHandoff(VALID_ID, now + 1);
  const second = await getShareTargetHandoff(VALID_ID, now + 2);
  assert.equal(first?.id, VALID_ID);
  assert.equal(first?.caption, 'mood for the group chat');
  assert.equal(first?.createdAt, now);
  assert.equal(first?.file.name, 'mood.gif');
  assert.equal(first?.file.type, 'image/gif');
  assert.equal(await first?.file.text(), await file.text());
  assert.equal(second?.id, VALID_ID);
  assert.equal(db.records.has(VALID_ID), true, 'read must not consume the pending handoff');

  await deleteShareTargetHandoff(VALID_ID);
  assert.equal(db.records.has(VALID_ID), false);
});

test('rejects an expired handoff and removes it so the import can recover cleanly', async (t) => {
  const db = memoryIndexedDb();
  installIndexedDb(t, db.indexedDb);
  const createdAt = 1_800_000_000_000;
  await saveShareTargetHandoff(VALID_ID, imageFile(), { text: 'caption' }, createdAt);

  assert.ok(await getShareTargetHandoff(VALID_ID, createdAt + SHARE_TARGET_HANDOFF_TTL_MS - 1));
  assert.equal(db.records.has(VALID_ID), true, 'handoff remains valid just before one hour');
  assert.equal(await getShareTargetHandoff(VALID_ID, createdAt + SHARE_TARGET_HANDOFF_TTL_MS), null);
  assert.equal(db.records.has(VALID_ID), false, 'expired record is deleted on read');
});

test('opportunistic startup cleanup deletes expired and corrupt records while preserving valid handoffs', async (t) => {
  const now = 1_800_000_000_000;
  const validId = '00000000-0000-4000-8000-000000000001';
  const expiredId = '00000000-0000-4000-8000-000000000002';
  const badMimeId = '00000000-0000-4000-8000-000000000003';
  const mismatchedId = '00000000-0000-4000-8000-000000000004';
  const base = {
    blob: new Blob(['image'], { type: 'image/png' }),
    name: 'photo.png',
    type: 'image/png',
    lastModified: 123,
    caption: 'caption',
    createdAt: now - 100,
  };
  const db = memoryIndexedDb(new Map([
    [validId, { ...base, id: validId, createdAt: now + 1 - SHARE_TARGET_HANDOFF_TTL_MS }],
    [expiredId, { ...base, id: expiredId, createdAt: now - SHARE_TARGET_HANDOFF_TTL_MS }],
    [badMimeId, { ...base, id: badMimeId, type: 'image/svg+xml' }],
    [mismatchedId, { ...base, id: validId }],
  ]));
  installIndexedDb(t, db.indexedDb);

  await cleanupShareTargetHandoffs(now);

  assert.deepEqual([...db.records.keys()], [validId]);
  assert.equal(db.records.get(validId).id, validId);
  assert.equal(db.records.get(validId).createdAt, now + 1 - SHARE_TARGET_HANDOFF_TTL_MS);
  // Cleanup runs when startup invokes it; it does not promise deletion at the exact expiry instant.
});

test('best-effort cleanup leaves storage errors non-fatal', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });

  await assert.doesNotReject(cleanupShareTargetHandoffs());
});

test('deletes and rejects records with mismatched IDs or corrupt media metadata', async (t) => {
  const db = memoryIndexedDb();
  installIndexedDb(t, db.indexedDb);
  const now = 1_800_000_000_000;
  const base = {
    id: VALID_ID,
    blob: new Blob(['image'], { type: 'image/png' }),
    name: 'photo.png',
    type: 'image/png',
    lastModified: 123,
    caption: 'caption',
    createdAt: now,
  };
  const corruptRecords = [
    { ...base, id: '00000000-0000-4000-8000-000000000000' },
    { ...base, type: 'image/svg+xml' },
    { ...base, blob: new Blob([new Uint8Array(MAX_DROP_MEDIA_BYTES + 1)], { type: 'image/png' }) },
    { ...base, lastModified: Number.NaN },
    { ...base, caption: 'x'.repeat(MAX_SHARE_TARGET_CAPTION_CHARS + 1) },
    { ...base, createdAt: now + 1 },
  ];

  for (const corrupt of corruptRecords) {
    db.records.set(VALID_ID, corrupt);
    assert.equal(await getShareTargetHandoff(VALID_ID, now), null);
    assert.equal(db.records.has(VALID_ID), false);
  }
});

test('save rejects invalid IDs, unsafe media, and non-file metadata without writing', async (t) => {
  const db = memoryIndexedDb();
  installIndexedDb(t, db.indexedDb);
  await assert.rejects(saveShareTargetHandoff('not-a-uuid', imageFile()), /UUID/);
  await assert.rejects(saveShareTargetHandoff(VALID_ID, imageFile({ type: 'image/svg+xml' })), /JPG/);
  await assert.rejects(saveShareTargetHandoff(VALID_ID, {
    type: 'image/png',
    size: 1,
    name: '',
    lastModified: 123,
    slice: () => new Blob(['x'], { type: 'image/png' }),
  }), /file metadata/i);
  assert.equal(db.records.size, 0);
});
