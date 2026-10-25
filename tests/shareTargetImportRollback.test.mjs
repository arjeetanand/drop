import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalAccountId, localAccountRecordId, setLocalAccountId } from '../lib/localAccountScope.ts';
import { getLetterDraft, getLetterDraftByMediaUploadId, saveLetterDraft, setActiveLetterDraft } from '../lib/letterStore.ts';
import { rollbackShareTargetImport } from '../lib/shareTargetImportRollback.ts';

test('preserves a committed share import under its captured account after an account switch', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });

  const accountA = 'share-rollback-account-a';
  const accountB = 'share-rollback-account-b';
  const handoffId = 'e53980be-8f6b-4da5-9740-aad65ed1f3cf';
  const attachments = new Map();
  const handoffs = new Map([[handoffId, { caption: 'Retry this shared image.' }]]);
  const deleteAttempts = [];

  try {
    setLocalAccountId(accountA);
    const previousDraft = saveLetterDraft({ id: 'draft-share-rollback-previous', content: 'Keep account A’s prior draft.' });
    const importedDraft = setActiveLetterDraft({
      ...previousDraft,
      id: 'draft-share-rollback-imported',
      content: 'Retry this shared image.',
      payloadKind: 'image',
      mediaUploadId: handoffId,
    });
    const attachmentKey = localAccountRecordId(importedDraft.id, accountA);
    attachments.set(attachmentKey, { name: 'shared-photo.png', bytes: new Uint8Array([1, 2, 3]) });

    setLocalAccountId(accountB);
    const otherAccountDraft = saveLetterDraft({ id: 'draft-share-rollback-account-b', content: 'Keep account B’s current draft.' });

    const result = await rollbackShareTargetImport({
      accountId: accountA,
      previousActiveDraft: previousDraft,
      activatedDraftIds: new Set(['draft-share-rollback-blank', importedDraft.id]),
      newlyWrittenAttachmentDraftId: importedDraft.id,
    }, async (draftId) => {
      deleteAttempts.push(draftId);
      attachments.delete(localAccountRecordId(draftId, getLocalAccountId()));
    });

    assert.equal(result.activeDraftRestoreFailed, false);
    assert.equal(result.preserveCommittedImportForCapturedAccount, true);
    assert.equal(getLetterDraft(accountA).id, importedDraft.id);
    assert.equal(getLetterDraftByMediaUploadId(handoffId, accountA, 'image')?.id, importedDraft.id);
    assert.deepEqual(attachments.get(attachmentKey), { name: 'shared-photo.png', bytes: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(deleteAttempts, [], 'The committed attachment should not be deleted after the active account changes.');
    assert.equal(getLetterDraft(accountB).id, otherAccountDraft.id);
    assert.equal(getLetterDraft().content, otherAccountDraft.content);
    assert.equal(handoffs.has(handoffId), true, 'A failed import should leave its share handoff available for retry.');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('keeps a committed share import reachable when the account switches during rollback cleanup', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });

  const accountA = 'share-rollback-cleanup-account-a';
  const accountB = 'share-rollback-cleanup-account-b';
  const handoffId = '5e060c52-7fcb-45a0-9eab-3d26a2b6eec2';
  const attachments = new Map();
  const handoffs = new Map([[handoffId, { caption: 'Retry this shared image.' }]]);

  try {
    setLocalAccountId(accountA);
    const previousDraft = saveLetterDraft({ id: 'draft-share-cleanup-previous', content: 'Keep account A’s prior draft.' });
    const importedDraft = setActiveLetterDraft({
      ...previousDraft,
      id: 'draft-share-cleanup-imported',
      content: 'Retry this shared image.',
      payloadKind: 'image',
      mediaUploadId: handoffId,
    });
    const attachmentKey = localAccountRecordId(importedDraft.id, accountA);
    attachments.set(attachmentKey, { name: 'shared-photo.png', bytes: new Uint8Array([4, 5, 6]) });

    setLocalAccountId(accountB);
    const otherAccountDraft = saveLetterDraft({ id: 'draft-share-cleanup-account-b', content: 'Keep account B’s current draft.' });
    setLocalAccountId(accountA);

    const result = await rollbackShareTargetImport({
      accountId: accountA,
      previousActiveDraft: previousDraft,
      activatedDraftIds: new Set([importedDraft.id]),
      newlyWrittenAttachmentDraftId: importedDraft.id,
    }, async () => {
      setLocalAccountId(accountB);
      return 'account-switched';
    });

    assert.equal(result.activeDraftRestoreFailed, false);
    assert.equal(result.preserveCommittedImportForCapturedAccount, true);
    assert.equal(getLetterDraft(accountA).id, importedDraft.id);
    assert.equal(getLetterDraftByMediaUploadId(handoffId, accountA, 'image')?.id, importedDraft.id);
    assert.deepEqual(attachments.get(attachmentKey), { name: 'shared-photo.png', bytes: new Uint8Array([4, 5, 6]) });
    assert.equal(getLetterDraft(accountB).id, otherAccountDraft.id);
    assert.equal(getLetterDraft().content, otherAccountDraft.content);
    assert.equal(handoffs.has(handoffId), true, 'A failed import should leave its share handoff available for retry.');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
