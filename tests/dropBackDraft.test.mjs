import assert from 'node:assert/strict';
import test from 'node:test';
import { getLetterDraft, getLetterDraftById, saveLetterDraft } from '../lib/letterStore.ts';
import { getDraftAttachment, saveDraftAttachment } from '../lib/letterMediaStore.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';
import { startDropBackDraft } from '../lib/dropBackDraft.ts';

function memoryIndexedDb(records) {
  const database = {
    transaction() {
      const transaction = {};
      const store = {
        get(key) {
          const request = {};
          queueMicrotask(() => {
            request.result = records.get(key);
            request.onsuccess?.();
          });
          return request;
        },
        put(value, key) {
          records.set(key, value);
          queueMicrotask(() => transaction.oncomplete?.());
        },
        delete(key) {
          records.delete(key);
          queueMicrotask(() => transaction.oncomplete?.());
        },
      };
      transaction.objectStore = () => store;
      return transaction;
    },
    close() {},
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('starts a fresh sender-addressed drop and preserves an empty-photo draft and attachment', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  const attachments = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
      indexedDB: memoryIndexedDb(attachments),
    },
  });

  try {
    setLocalAccountId('drop-back-draft-account');
    const original = saveLetterDraft({
      id: 'draft-empty-photo-in-progress',
      recipient: '@close.friend',
      subject: 'Keep this photo for later',
      content: '',
      payloadKind: 'image',
      mediaUploadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const originalFile = new File([new Uint8Array([1, 4, 9, 16])], 'photo.png', {
      type: 'image/png',
      lastModified: 42,
    });
    await saveDraftAttachment(original.id, originalFile);

    const result = startDropBackDraft('Friend.Handle');
    const route = new URL(result.composeHref, 'https://drop.test');
    const preservedDraft = getLetterDraftById(original.id);
    const preservedAttachment = await getDraftAttachment(original.id);

    assert.notEqual(result.draft.id, original.id);
    assert.equal(getLetterDraft().id, result.draft.id);
    assert.equal(result.draft.status, 'draft');
    assert.equal(result.draft.payloadKind, 'text');
    assert.equal(result.draft.content, '');
    assert.equal(route.pathname, '/compose');
    assert.equal(route.searchParams.get('letter'), result.draft.id);
    assert.equal(route.searchParams.get('recipient'), '@friend.handle');
    assert.deepEqual(preservedDraft, original, 'The earlier draft fields should remain unchanged in history.');
    assert.equal(await preservedAttachment?.text(), await originalFile.text(), 'The original photo bytes should stay under the earlier draft ID.');
    assert.equal(await getDraftAttachment(result.draft.id), null, 'The fresh Drop back draft should not inherit the earlier attachment.');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('rejects an invalid sender handle without replacing the current draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('drop-back-invalid-handle-account');
    const original = saveLetterDraft({ id: 'draft-stay-active', content: 'Do not replace me.' });
    assert.throws(() => startDropBackDraft('!'), /sender handle/i);
    assert.equal(getLetterDraft().id, original.id);
    assert.equal(getLetterDraft().content, original.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
