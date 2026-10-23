import assert from 'node:assert/strict';
import test from 'node:test';
import { clearRecipientInviteProgressForDraft, completeSuccessfulSend, copyGuestDraftToAccount, dispatchLetter, getGuestDraftById, getJourneyNotes, getLetterDraft, getLetterDraftById, getLettersWithDraft, isLetterDraftPersisted, recordRecipientInviteProgress, saveJourneyNotes, saveLetterDraft, setActiveLetterDraft, startNewLetter } from '../lib/letterStore.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

test('transfers the starter draft and refreshes the preserved account draft snapshot', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: '3', content: 'Only my person should see this.' });
    setLocalAccountId('account-one');
    const accountDraft = saveLetterDraft({ id: 'draft-account-work', content: 'Keep this account draft.' });
    values.set('dear-exe:letter-drafts:v1:account:account-one', JSON.stringify([{ ...accountDraft, content: 'Stale history copy.' }]));
    assert.notEqual(getLetterDraftById(guestDraft.id)?.content, guestDraft.content);
    assert.deepEqual(await copyGuestDraftToAccount(guestDraft.id, 'account-one'), guestDraft);
    assert.equal(getLetterDraftById(guestDraft.id)?.content, guestDraft.content);
    assert.equal(getLetterDraft().content, accountDraft.content);
    setActiveLetterDraft(guestDraft);
    assert.equal(getLetterDraftById(accountDraft.id)?.content, accountDraft.content);
    setLocalAccountId(null);
    assert.equal(getLetterDraftById(guestDraft.id)?.content, guestDraft.content);
    assert.equal(getGuestDraftById(guestDraft.id)?.content, guestDraft.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('verifies the active draft can be read back before it is shared', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let rejectWrites = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (rejectWrites) throw new Error('storage full');
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId('invite-storage-check');
    const persistedDraft = saveLetterDraft({ id: 'draft-persisted-before-invite', content: 'Ready to share.' });
    assert.equal(isLetterDraftPersisted(persistedDraft), true);

    rejectWrites = true;
    const unsavedDraft = saveLetterDraft({ id: 'draft-rejected-before-invite', content: 'Keep this private.' });
    assert.equal(isLetterDraftPersisted(unsavedDraft), false);
    assert.equal(getLetterDraft().id, persistedDraft.id);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('retains a media upload ID when a draft is saved and resumed', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('media-retry-account');
    const mediaUploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const mediaDraft = saveLetterDraft({
      id: 'draft-media-retry',
      content: 'A caption for the photo.',
      payloadKind: 'image',
      mediaUploadId,
    });

    startNewLetter();
    const resumedDraft = getLetterDraftById(mediaDraft.id);

    assert.ok(resumedDraft);
    assert.equal(resumedDraft?.mediaUploadId, mediaUploadId);
    setActiveLetterDraft(resumedDraft);
    assert.equal(getLetterDraft().mediaUploadId, mediaUploadId);
    assert.equal(saveLetterDraft({ content: 'Retrying the same photo.' }).mediaUploadId, mediaUploadId);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('persists each invite outcome with the matching account draft and mailbox card', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('invite-owner');
    const draft = saveLetterDraft({ id: 'draft-invite-progress', recipient: '@New.Friend' });
    for (const status of ['shared', 'copied', 'cancelled', 'unavailable']) {
      const updated = recordRecipientInviteProgress(draft.id, 'invite-owner', '@New.Friend', status);
      assert.deepEqual(updated?.recipientInviteProgress, {
        username: 'new.friend',
        status,
        ...(status === 'unavailable' ? { manualLinkAvailable: true } : {}),
      });
      const saved = getLetterDraftById(draft.id);
      assert.deepEqual(saved?.recipientInviteProgress, updated?.recipientInviteProgress);
      assert.deepEqual(getLettersWithDraft().find((letter) => letter.id === draft.id)?.recipientInviteProgress, saved?.recipientInviteProgress);
    }

    setLocalAccountId('other-account');
    assert.equal(recordRecipientInviteProgress(draft.id, 'invite-owner', 'different.friend', 'shared'), null);
    assert.equal(getLetterDraftById(draft.id), null);

    setLocalAccountId('invite-owner');
    assert.equal(clearRecipientInviteProgressForDraft(draft.id, 'other-account'), null);
    assert.deepEqual(getLetterDraftById(draft.id)?.recipientInviteProgress, { username: 'new.friend', status: 'unavailable', manualLinkAvailable: true });
    assert.equal(clearRecipientInviteProgressForDraft(draft.id, 'invite-owner')?.recipientInviteProgress, undefined);
    assert.equal(getLetterDraftById(draft.id)?.recipientInviteProgress, undefined);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('restores the manual invite link after a cancelled retry of an unavailable invite', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('invite-cancel-retry-owner');
    const draft = saveLetterDraft({ id: 'draft-invite-cancel-retry', recipient: '@retry.friend' });
    recordRecipientInviteProgress(draft.id, 'invite-cancel-retry-owner', 'retry.friend', 'unavailable');
    const cancelled = recordRecipientInviteProgress(draft.id, 'invite-cancel-retry-owner', 'retry.friend', 'cancelled', true);

    assert.deepEqual(cancelled?.recipientInviteProgress, {
      username: 'retry.friend',
      status: 'cancelled',
      manualLinkAvailable: true,
    });
    assert.deepEqual(getLetterDraftById(draft.id)?.recipientInviteProgress, cancelled?.recipientInviteProgress);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('an invite result updates its original draft in history without touching the active draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('invite-history-owner');
    const original = saveLetterDraft({ id: 'draft-invite-history', recipient: '@history.friend' });
    const active = startNewLetter();

    const updated = recordRecipientInviteProgress(original.id, 'invite-history-owner', 'history.friend', 'copied');

    assert.deepEqual(updated?.recipientInviteProgress, { username: 'history.friend', status: 'copied' });
    assert.deepEqual(getLetterDraftById(original.id)?.recipientInviteProgress, updated?.recipientInviteProgress);
    assert.equal(getLetterDraft().id, active.id);
    assert.equal(getLetterDraft().recipientInviteProgress, undefined);
    assert.equal(clearRecipientInviteProgressForDraft(original.id, 'invite-history-owner')?.recipientInviteProgress, undefined);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('ignores an invite result when the saved recipient changed during sharing', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('invite-recipient-owner');
    const draft = saveLetterDraft({ id: 'draft-invite-recipient-check', recipient: '@before.friend' });
    saveLetterDraft({ recipient: '@after.friend' });

    assert.equal(recordRecipientInviteProgress(draft.id, 'invite-recipient-owner', 'before.friend', 'shared'), null);
    assert.equal(getLetterDraft().recipientInviteProgress, undefined);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('hydrates the previous local invite reminder shape into the current progress state', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map([['dear-exe:active-letter:v1', JSON.stringify({
    id: 'draft-legacy-invite',
    recipient: '@Old.Friend',
    status: 'draft',
    updatedAt: '2026-10-20T00:00:00.000Z',
    inviteFollowUp: { username: 'Old.Friend', method: 'copied' },
  })]]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    assert.deepEqual(getLetterDraft().recipientInviteProgress, { username: 'old.friend', status: 'copied' });
    assert.equal(Object.hasOwn(getLetterDraft(), 'inviteFollowUp'), false);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('completes a sent draft by ID and preserves a different active draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } },
  });
  try {
    setLocalAccountId('send-owner');
    const original = saveLetterDraft({ id: 'draft-send-race', recipient: '@to.send' });
    const submittedDraft = recordRecipientInviteProgress(original.id, 'send-owner', 'to.send', 'shared');
    startNewLetter();
    const active = saveLetterDraft({ id: 'draft-active-after-navigation', content: 'Keep this one open.' });

    const sent = completeSuccessfulSend(submittedDraft, 'send-owner', 'delivered', '2026-10-23T00:00:00.000Z', {
      mediaPath: 'private-media/sent.png',
      mediaMimeType: 'image/png',
      mediaSizeBytes: 1024,
    });

    assert.equal(sent?.id, original.id);
    assert.equal(sent?.status, 'delivered');
    assert.equal(sent?.mediaPath, 'private-media/sent.png');
    assert.equal(sent?.recipientInviteProgress, undefined);
    assert.equal(getLetterDraft().id, active.id);
    assert.equal(getLetterDraftById(original.id)?.status, 'delivered');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === original.id)?.recipientInviteProgress, undefined);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('persists a private claim as an unclaimed sent receipt', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } },
  });
  try {
    setLocalAccountId('claim-owner');
    const draft = saveLetterDraft({ id: 'draft-private-claim', recipient: '@new.friend', content: 'A private note.' });
    const sent = completeSuccessfulSend(draft, 'claim-owner', 'claim_pending', '2026-10-23T00:00:00.000Z', {});

    assert.equal(sent?.status, 'claim_pending');
    assert.equal(getLetterDraftById(draft.id)?.status, 'claim_pending');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === draft.id)?.status, 'claim_pending');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('clears only progress for the recipient of the completed send', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } },
  });
  try {
    setLocalAccountId('send-progress-owner');
    const draft = saveLetterDraft({
      id: 'draft-send-progress-match',
      recipient: '@sent.friend',
      recipientInviteProgress: { username: 'other.friend', status: 'copied' },
    });

    const sent = completeSuccessfulSend(draft, 'send-progress-owner', 'delivered', '2026-10-23T00:00:00.000Z', {
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaSizeBytes: undefined,
    });

    assert.deepEqual(sent?.recipientInviteProgress, { username: 'other.friend', status: 'copied' });
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('does not mark newer same-draft edits sent when an older version finishes sending', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } },
  });
  try {
    setLocalAccountId('send-edited-owner');
    const submitted = saveLetterDraft({ id: 'draft-edited-in-flight', recipient: '@same.friend', content: 'The version sent.' });
    saveLetterDraft({ content: 'Newer edits not sent.' });

    const sent = completeSuccessfulSend(submitted, 'send-edited-owner', 'delivered', '2026-10-23T00:00:00.000Z', {
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaSizeBytes: undefined,
    });

    assert.equal(sent, null);
    assert.equal(getLetterDraft().content, 'Newer edits not sent.');
    assert.equal(getLetterDraft().status, 'draft');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === submitted.id)?.status, 'draft');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('restores only each account’s drafts, sent copy, and journey notes across A-B-A switching', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('account-a');
    const draftA = saveLetterDraft({ id: 'draft-switch', content: 'A private draft' });
    startNewLetter();
    saveLetterDraft({ id: 'sent-switch', content: 'A sent copy', recipient: '@friend' });
    const sentA = dispatchLetter('sent-switch', 'delivered', '2026-10-19T00:00:00.000Z');
    setActiveLetterDraft(draftA);
    saveJourneyNotes([{ id: 'note-switch', date: 'Today', text: 'A private note' }], sentA.id);

    setLocalAccountId('account-b');
    assert.equal(getLetterDraftById(draftA.id), null);
    assert.equal(getLettersWithDraft().some((letter) => letter.id === sentA.id), false);
    assert.deepEqual(getJourneyNotes(sentA.id), []);
    const draftB = saveLetterDraft({ id: draftA.id, content: 'B private draft' });
    startNewLetter();
    saveLetterDraft({ id: sentA.id, content: 'B sent copy', recipient: '@friend' });
    const sentB = dispatchLetter(sentA.id, 'delivered', '2026-10-19T00:00:01.000Z');
    setActiveLetterDraft(draftB);
    saveJourneyNotes([{ id: 'note-switch', date: 'Today', text: 'B private note' }], sentB.id);

    setLocalAccountId('account-a');
    assert.equal(getLetterDraft().content, 'A private draft');
    assert.equal(getLetterDraftById(draftA.id)?.content, 'A private draft');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === sentA.id)?.excerpt, 'A sent copy');
    assert.deepEqual(getJourneyNotes(sentA.id).map((note) => note.text), ['A private note']);

    setLocalAccountId('account-b');
    assert.equal(getLetterDraft().content, 'B private draft');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === sentB.id)?.excerpt, 'B sent copy');
    assert.deepEqual(getJourneyNotes(sentB.id).map((note) => note.text), ['B private note']);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('keeps seeded samples labeled when merging older local history snapshots', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map([['dear-exe:letter-history:v1', JSON.stringify([
    { id: 'incoming-1', recipient: 'sunny.stories', sender: 'Mina Vale', direction: 'received', date: 'Just now', status: 'delivered', excerpt: 'A sample.', subject: 'The blue hour' },
  ])]]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    assert.equal(getLettersWithDraft().find((letter) => letter.id === 'incoming-1')?.sample, true);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('remaps a guest starter draft when the account already owns draft ID 3', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: '3', content: 'Guest version of the starter.', payloadKind: 'gif' });
    setLocalAccountId('account-one');
    const accountDraft = saveLetterDraft({ id: '3', content: 'Account version of the starter.' });
    const imported = await copyGuestDraftToAccount(guestDraft.id, 'account-one', async (sourceId, accountId, targetId) => {
      assert.equal(sourceId, guestDraft.id);
      assert.equal(accountId, 'account-one');
      assert.notEqual(targetId, sourceId);
      return 'copied';
    });
    assert.ok(imported);
    assert.notEqual(imported.id, guestDraft.id);
    assert.equal(getLetterDraftById(imported.id)?.content, guestDraft.content);
    setActiveLetterDraft(imported);
    assert.equal(getLetterDraftById(accountDraft.id)?.content, accountDraft.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('restores a missing attachment when retrying an existing draft', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: 'draft-guest-media', content: '', payloadKind: 'image' });
    setLocalAccountId('account-one');
    values.set('dear-exe:letter-drafts:v1:account:account-one', JSON.stringify([guestDraft]));
    let copied = false;
    assert.deepEqual(await copyGuestDraftToAccount(guestDraft.id, 'account-one', async () => {
      copied = true;
      return 'copied';
    }), guestDraft);
    assert.equal(copied, true);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('does not copy a media draft when its attachment copy fails', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: 'draft-guest-media', content: '', payloadKind: 'image' });
    setLocalAccountId('account-one');
    assert.equal(await copyGuestDraftToAccount(guestDraft.id, 'account-one', async () => false), null);
    assert.equal(getLetterDraftById(guestDraft.id), null);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.payloadKind, 'image');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('rolls back a copied media attachment if the account draft history cannot be saved', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let rollbackTarget = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (key === 'dear-exe:letter-drafts:v1:account:account-one') throw new Error('storage full');
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: 'draft-guest-media', content: '', payloadKind: 'image' });
    setLocalAccountId('account-one');
    assert.equal(await copyGuestDraftToAccount(
      guestDraft.id,
      'account-one',
      async (sourceId, accountId, targetId) => {
        assert.equal(sourceId, guestDraft.id);
        assert.equal(accountId, 'account-one');
        rollbackTarget = targetId;
        return 'copied';
      },
      async (targetId, accountId) => {
        assert.equal(accountId, 'account-one');
        rollbackTarget = `deleted:${targetId}`;
      },
    ), null);
    assert.equal(rollbackTarget, `deleted:${guestDraft.id}`);
    assert.equal(getLetterDraftById(guestDraft.id), null);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.payloadKind, 'image');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('rolls back the remapped attachment after a colliding media transfer cannot be saved', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let copiedId = null;
  let rolledBackId = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (key === 'dear-exe:letter-drafts:v1:account:account-one') throw new Error('storage full');
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: '3', content: '', payloadKind: 'image' });
    setLocalAccountId('account-one');
    const accountDraft = saveLetterDraft({ id: '3', content: 'Account draft.' });
    assert.equal(await copyGuestDraftToAccount(
      guestDraft.id,
      'account-one',
      async (sourceId, accountId, targetId) => {
        assert.equal(sourceId, guestDraft.id);
        assert.equal(accountId, 'account-one');
        assert.notEqual(targetId, guestDraft.id);
        copiedId = targetId;
        return 'copied';
      },
      async (targetId, accountId) => {
        assert.equal(accountId, 'account-one');
        rolledBackId = targetId;
      },
    ), null);
    assert.equal(rolledBackId, copiedId);
    assert.equal(getLetterDraftById(accountDraft.id)?.content, accountDraft.content);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.payloadKind, 'image');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('rolls back an attachment restored by a retry if draft history cannot be saved', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let rolledBackId = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (key === 'dear-exe:letter-drafts:v1:account:account-one') throw new Error('storage full');
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: 'draft-guest-media', content: '', payloadKind: 'image' });
    setLocalAccountId('account-one');
    values.set('dear-exe:letter-drafts:v1:account:account-one', JSON.stringify([guestDraft]));
    assert.equal(await copyGuestDraftToAccount(
      guestDraft.id,
      'account-one',
      async () => 'copied',
      async (targetId, accountId) => {
        assert.equal(accountId, 'account-one');
        rolledBackId = targetId;
      },
    ), null);
    assert.equal(rolledBackId, guestDraft.id);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.payloadKind, 'image');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
