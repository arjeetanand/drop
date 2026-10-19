import assert from 'node:assert/strict';
import test from 'node:test';
import { copyGuestDraftAttachmentToAccount, deleteDraftAttachment, getDraftAttachment, saveDraftAttachment } from '../lib/letterMediaStore.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

function memoryIndexedDb(records) {
  const database = {
    transaction() {
      let pending = 0;
      const transaction = {};
      const completeIfIdle = () => {
        if (pending === 0) queueMicrotask(() => transaction.oncomplete?.());
      };
      const store = {
        get(key) {
          pending += 1;
          const request = {};
          queueMicrotask(() => {
            request.result = records.get(key);
            pending -= 1;
            request.onsuccess?.();
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

test('copies a remapped guest attachment and does not replace an existing account attachment', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const source = { blob: 'guest image', name: 'guest.png', type: 'image/png', lastModified: 1 };
  const existing = { blob: 'account image', name: 'account.png', type: 'image/png', lastModified: 2 };
  const records = new Map([
    ['guest-draft', source],
    ['account:account-one:remapped-draft', undefined],
    ['existing-draft', source],
    ['account:account-one:existing-draft', existing],
  ]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { indexedDB: memoryIndexedDb(records) },
  });
  try {
    assert.equal(await copyGuestDraftAttachmentToAccount('guest-draft', 'account-one', 'remapped-draft'), 'copied');
    assert.equal(records.get('account:account-one:remapped-draft'), source);
    assert.equal(await copyGuestDraftAttachmentToAccount('existing-draft', 'account-one'), 'existing');
    assert.equal(records.get('account:account-one:existing-draft'), existing);
    assert.equal(await copyGuestDraftAttachmentToAccount('missing-draft', 'account-one'), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('restores only the owning account’s attachment across A-B-A switching', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const records = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: memoryIndexedDb(records) } });
  try {
    setLocalAccountId('account-a');
    await saveDraftAttachment('draft-switch', {
      size: 5,
      type: 'image/png',
      name: 'a.png',
      lastModified: 1,
      slice: () => new Blob(['A-file'], { type: 'image/png' }),
    });

    setLocalAccountId('account-b');
    assert.equal(await getDraftAttachment('draft-switch'), null);
    await saveDraftAttachment('draft-switch', {
      size: 5,
      type: 'image/png',
      name: 'b.png',
      lastModified: 2,
      slice: () => new Blob(['B-file'], { type: 'image/png' }),
    });

    setLocalAccountId('account-a');
    const attachmentA = await getDraftAttachment('draft-switch');
    assert.equal(attachmentA?.name, 'a.png');
    assert.equal(await attachmentA?.text(), 'A-file');

    setLocalAccountId('account-b');
    const attachmentB = await getDraftAttachment('draft-switch');
    assert.equal(attachmentB?.name, 'b.png');
    assert.equal(await attachmentB?.text(), 'B-file');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

function deferredIndexedDb() {
  let releaseOpen;
  const open = new Promise((resolve) => { releaseOpen = resolve; });
  let transactions = 0;
  const database = {
    transaction() {
      transactions += 1;
      throw new Error('This database should not be used after an account switch.');
    },
    close() {},
  };
  return {
    indexedDB: {
      open() {
        const request = {};
        open.then(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
    },
    releaseOpen,
    transactionCount: () => transactions,
  };
}

test('does not save an attachment under a different account after database open is delayed', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const indexedDb = deferredIndexedDb();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: indexedDb.indexedDB } });
  try {
    setLocalAccountId('account-one');
    const pending = saveDraftAttachment('3', {
      size: 1,
      type: 'image/png',
      name: 'photo.png',
      lastModified: 1,
      slice: () => new Blob(['x'], { type: 'image/png' }),
    });
    setLocalAccountId('account-two');
    indexedDb.releaseOpen();
    await assert.rejects(pending, /active account changed/);
    assert.equal(indexedDb.transactionCount(), 0);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('does not read or delete another account attachment after a switch during database open', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const indexedDb = deferredIndexedDb();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: indexedDb.indexedDB } });
  try {
    setLocalAccountId('account-one');
    const pending = getDraftAttachment('3');
    const pendingDelete = deleteDraftAttachment('3');
    setLocalAccountId('account-two');
    indexedDb.releaseOpen();
    assert.equal(await pending, null);
    await pendingDelete;
    assert.equal(indexedDb.transactionCount(), 0);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
