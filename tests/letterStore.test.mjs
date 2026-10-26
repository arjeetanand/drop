import assert from 'node:assert/strict';
import test from 'node:test';
import { clearRecipientInviteProgressForDraft, completeSuccessfulSend, copyGuestDraftToAccount, createLocalDemoDrop, dispatchLetter, ensureLetterDraftMediaUploadId, getGuestDraftById, getJourneyNotes, getLetterDraft, getLetterDraftById, getLetterDraftByMediaUploadId, getLettersWithDraft, isLetterDraftPersisted, recordRecipientInviteProgress, saveJourneyNotes, saveLetterDraft, setActiveLetterDraft, startNewLetter } from '../lib/letterStore.ts';
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

test('requires the previous editable draft to be preserved before starting a new one when opted in', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let rejectDraftHistory = false;
  let activeDraftWrites = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (rejectDraftHistory && key === 'dear-exe:letter-drafts:v1:account:preserved-draft-account') {
            throw new Error('draft history full');
          }
          if (key === 'dear-exe:active-letter:v1:account:preserved-draft-account') activeDraftWrites += 1;
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId('preserved-draft-account');
    const original = saveLetterDraft({ id: 'draft-preserve-before-new', content: 'Keep this editable draft.' });
    const activeKey = 'dear-exe:active-letter:v1:account:preserved-draft-account';
    const originalActive = values.get(activeKey);
    const writesBeforeAttempt = activeDraftWrites;

    rejectDraftHistory = true;
    assert.throws(() => startNewLetter({ forceNew: true, requirePreserved: true }), /could not be preserved/i);

    assert.equal(activeDraftWrites, writesBeforeAttempt, 'the active draft must not be replaced if its history write fails');
    assert.equal(values.get(activeKey), originalActive);
    assert.equal(getLetterDraft().id, original.id);
    assert.equal(getLetterDraft().content, original.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('starts a verified new active draft after preserving the previous draft when opted in', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('preserved-success-account');
    const original = saveLetterDraft({ id: 'draft-preserved-success-original', content: 'The original remains editable.' });
    const next = startNewLetter({ forceNew: true, requirePreserved: true });
    const history = JSON.parse(values.get('dear-exe:letter-drafts:v1:account:preserved-success-account'));

    assert.notEqual(next.id, original.id);
    assert.equal(getLetterDraft().id, next.id);
    assert.equal(isLetterDraftPersisted(next, 'preserved-success-account'), true);
    assert.equal(history.find((draft) => draft.id === original.id)?.content, original.content);
    assert.equal(getLetterDraftById(original.id, 'preserved-success-account')?.content, original.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('restores a captured account draft after an account switch without replacing the current account', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('rollback-account-one');
    const previous = saveLetterDraft({ id: 'draft-rollback-previous', content: 'Keep this account draft.' });
    setActiveLetterDraft({ ...previous, id: 'draft-rollback-imported', content: 'Temporary shared draft.' });

    setLocalAccountId('rollback-account-two');
    const current = saveLetterDraft({ id: 'draft-rollback-current', content: 'Do not replace this other account draft.' });
    const restored = setActiveLetterDraft(previous, 'rollback-account-one');

    assert.equal(restored.id, previous.id);
    assert.equal(getLetterDraft('rollback-account-one').id, previous.id);
    assert.equal(getLetterDraft('rollback-account-one').content, previous.content);
    assert.equal(getLetterDraft('rollback-account-two').id, current.id);
    assert.equal(getLetterDraft().id, current.id);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('keeps a committed imported share draft reachable in its captured account after a switch', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('share-account-one');
    saveLetterDraft({ id: 'draft-share-previous', content: 'Keep the previous draft.' });
    const imported = setActiveLetterDraft({
      ...getLetterDraft('share-account-one'),
      id: 'draft-share-imported',
      content: 'Keep this imported share with its committed photo.',
      payloadKind: 'image',
      mediaUploadId: 'share-handoff-committed',
    });

    setLocalAccountId('share-account-two');
    const otherAccount = saveLetterDraft({ id: 'draft-share-other-account', content: 'Keep this account separate.' });

    assert.equal(getLetterDraft('share-account-one').id, imported.id);
    assert.equal(getLetterDraftByMediaUploadId('share-handoff-committed', 'share-account-one', 'image')?.id, imported.id);
    assert.equal(getLetterDraft('share-account-two').id, otherAccount.id);
    assert.equal(getLetterDraft().id, otherAccount.id);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('aborts an opted-in new draft if its active record cannot be persisted', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let rejectNewActive = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (rejectNewActive && key === 'dear-exe:active-letter:v1:account:active-write-account') {
            const next = JSON.parse(value);
            if (next.id !== 'draft-active-write-original') throw new Error('active draft write failed');
          }
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId('active-write-account');
    const original = saveLetterDraft({ id: 'draft-active-write-original', content: 'Still here if the new draft fails.' });
    const activeKey = 'dear-exe:active-letter:v1:account:active-write-account';
    const originalActive = values.get(activeKey);

    rejectNewActive = true;
    assert.throws(() => startNewLetter({ forceNew: true, requirePreserved: true }), /new draft could not be saved/i);

    assert.equal(values.get(activeKey), originalActive, 'a failed active write must leave the previous active draft intact');
    const history = JSON.parse(values.get('dear-exe:letter-drafts:v1:account:active-write-account'));
    assert.equal(history.find((draft) => draft.id === original.id)?.content, original.content);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('keeps legacy startNewLetter behavior when preservation is not requested', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          if (key === 'dear-exe:letter-drafts:v1:account:legacy-new-letter-account') {
            throw new Error('draft history full');
          }
          values.set(key, value);
        },
      },
    },
  });
  try {
    setLocalAccountId('legacy-new-letter-account');
    const original = saveLetterDraft({ id: 'draft-legacy-new-letter', content: 'Existing caller behavior.' });
    const next = startNewLetter({ forceNew: true });

    assert.notEqual(next.id, original.id);
    assert.equal(getLetterDraft().id, next.id);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('finds media drafts by upload ID in active and history storage without crossing accounts', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('media-lookup-account-one');
    const historical = saveLetterDraft({
      id: 'draft-media-lookup-history',
      content: 'The original imported draft.',
      payloadKind: 'image',
      mediaUploadId: 'share-handoff-one',
    });
    startNewLetter();
    assert.equal(getLetterDraftByMediaUploadId('share-handoff-one')?.id, historical.id);

    setLocalAccountId('media-lookup-account-two');
    const active = saveLetterDraft({
      id: 'draft-media-lookup-active',
      content: 'A different account draft.',
      payloadKind: 'gif',
      mediaUploadId: 'share-handoff-one',
    });
    assert.equal(getLetterDraftByMediaUploadId('share-handoff-one')?.id, active.id);
    assert.equal(getLetterDraftByMediaUploadId('share-handoff-one', 'media-lookup-account-one')?.id, historical.id);
    assert.equal(getLetterDraftByMediaUploadId('', 'media-lookup-account-one'), null);
    assert.equal(getLetterDraftByMediaUploadId('unknown-handoff', 'media-lookup-account-one'), null);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('media upload lookup never reopens completed drops and rejects a conflicting media kind', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    const accountId = 'media-replay-status-account';
    setLocalAccountId(accountId);
    const statuses = ['draft', 'sealed', 'dispatched', 'delivered', 'claim_pending'];
    const drafts = statuses.map((status) => ({
      id: `draft-share-${status}`,
      recipient: '@saved.person',
      subject: `Keep this ${status} subject`,
      content: `Keep this ${status} caption`,
      fontSize: 18,
      alignment: 'left',
      address: { name: 'Saved person', street: '', city: '', postcode: '', country: '' },
      sealId: 'heart',
      payloadKind: 'image',
      deliveryMode: 'instant',
      mediaUploadId: `share-${status}`,
      status,
      updatedAt: new Date().toISOString(),
    }));
    values.set('dear-exe:letter-drafts:v1:account:media-replay-status-account', JSON.stringify(drafts));
    const historyBefore = values.get('dear-exe:letter-drafts:v1:account:media-replay-status-account');

    for (const draft of drafts) {
      const found = getLetterDraftByMediaUploadId(draft.mediaUploadId, accountId, 'image');
      if (draft.status === 'draft' || draft.status === 'sealed') {
        assert.equal(found?.id, draft.id);
        assert.equal(found?.recipient, draft.recipient);
        assert.equal(found?.subject, draft.subject);
        assert.equal(found?.content, draft.content);
      } else {
        assert.equal(found, null, `${draft.status} must not be reopened as an editable draft`);
      }
      assert.throws(
        () => getLetterDraftByMediaUploadId(draft.mediaUploadId, accountId, 'gif'),
        /different media type/i,
      );
    }

    assert.equal(values.get('dear-exe:letter-drafts:v1:account:media-replay-status-account'), historyBefore,
      'lookup must not rewrite saved captions, recipients, subjects, or completion status');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('creates the home demo without replacing or sending the active user draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const active = saveLetterDraft({
      id: 'draft-unfinished-user-note',
      recipient: '@close.friend',
      subject: 'Keep this thought',
      content: 'This unfinished note must remain a draft.',
    });
    const activeBefore = values.get('dear-exe:active-letter:v1');
    const demoDraft = {
      id: 'draft-local-demo-preserve-active',
      recipient: 'demo.friend',
      subject: 'The world doing its thing',
      content: 'A little loop from the walk home. This made me think of you.',
      fontSize: 18,
      alignment: 'left',
      address: { name: 'Your person', street: '', city: '', postcode: '', country: '' },
      sealId: 'celestial',
      sealColor: '#102a43',
      sealMonogram: '',
      payloadKind: 'gif',
      deliveryMode: 'instant',
      mediaMimeType: 'image/gif',
      mediaSizeBytes: 64,
      status: 'draft',
      updatedAt: new Date().toISOString(),
      localDemo: true,
    };

    const completed = createLocalDemoDrop(demoDraft);

    assert.equal(completed?.status, 'delivered');
    assert.equal(completed?.localDemo, true);
    assert.equal(getLetterDraft().id, active.id);
    assert.equal(getLetterDraft().content, active.content);
    assert.equal(values.get('dear-exe:active-letter:v1'), activeBefore);
    assert.equal(getLetterDraftById(demoDraft.id)?.localDemo, true);
    assert.equal(getLetterDraftById(demoDraft.id)?.status, 'delivered');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === demoDraft.id)?.localDemo, true);
    assert.equal(getLettersWithDraft().find((letter) => letter.id === demoDraft.id)?.status, 'delivered');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('creates a local text demo without media or replacing the active draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const active = saveLetterDraft({
      id: 'draft-unfinished-user-note-for-text-demo',
      recipient: '@close.friend',
      subject: 'Keep this thought',
      content: 'This unfinished note must remain a draft.',
    });
    const activeBefore = values.get('dear-exe:active-letter:v1');
    const demoDraft = {
      id: 'draft-local-demo-text-note',
      recipient: 'demo.friend',
      subject: 'A tiny reminder',
      content: 'I saved you the window seat. No reply needed — just wanted you to know I thought of you.',
      fontSize: 18,
      alignment: 'left',
      address: { name: 'Your person', street: '', city: '', postcode: '', country: '' },
      sealId: 'celestial',
      sealColor: '#102a43',
      sealMonogram: '',
      payloadKind: 'text',
      deliveryMode: 'instant',
      status: 'draft',
      updatedAt: new Date().toISOString(),
      localDemo: true,
    };

    const completed = createLocalDemoDrop(demoDraft);
    const displayed = getLettersWithDraft().find((letter) => letter.id === demoDraft.id);

    assert.equal(completed?.status, 'delivered');
    assert.equal(completed?.localDemo, true);
    assert.equal(completed?.payloadKind, 'text');
    assert.equal(completed?.mediaMimeType, undefined);
    assert.equal(completed?.mediaSizeBytes, undefined);
    assert.equal(getLetterDraft().id, active.id);
    assert.equal(values.get('dear-exe:active-letter:v1'), activeBefore);
    assert.equal(getLetterDraftById(demoDraft.id)?.content, demoDraft.content);
    assert.equal(displayed?.excerpt, demoDraft.content);
    assert.equal(displayed?.status, 'delivered');
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('rejects a blank or media-backed local text demo', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('text-demo-validation');
    const base = {
      id: 'draft-local-demo-invalid-text',
      recipient: 'demo.friend',
      subject: 'A note',
      content: 'A note for a friend.',
      fontSize: 18,
      alignment: 'left',
      address: { name: 'Your person', street: '', city: '', postcode: '', country: '' },
      sealId: 'celestial',
      sealColor: '#102a43',
      sealMonogram: '',
      payloadKind: 'text',
      deliveryMode: 'instant',
      status: 'draft',
      updatedAt: new Date().toISOString(),
      localDemo: true,
    };

    assert.equal(createLocalDemoDrop({ ...base, content: '   ' }), null);
    assert.equal(createLocalDemoDrop({ ...base, mediaMimeType: 'image/png', mediaSizeBytes: 64 }), null);
    assert.equal(getLetterDraftById(base.id), null);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('keeps account-scoped demos out of other accounts and rejects an account switch', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('demo-account-one');
    const active = saveLetterDraft({ id: 'draft-account-one-work', content: 'Keep this account draft.' });
    const demoDraft = {
      id: 'draft-local-demo-account-scoped',
      recipient: 'demo.friend',
      subject: 'The blue hour',
      content: 'A little moment to open.',
      fontSize: 18,
      alignment: 'left',
      address: { name: 'Your person', street: '', city: '', postcode: '', country: '' },
      sealId: 'celestial',
      sealColor: '#102a43',
      sealMonogram: '',
      payloadKind: 'image',
      deliveryMode: 'instant',
      mediaMimeType: 'image/png',
      mediaSizeBytes: 64,
      status: 'draft',
      updatedAt: new Date().toISOString(),
      localDemo: true,
    };

    assert.equal(createLocalDemoDrop(demoDraft, 'demo-account-two'), null);
    assert.equal(getLetterDraftById(demoDraft.id), null);
    assert.equal(createLocalDemoDrop(demoDraft, 'demo-account-one')?.status, 'delivered');
    assert.equal(getLetterDraft().id, active.id);
    assert.equal(getLetterDraftById(demoDraft.id)?.localDemo, true);

    setLocalAccountId('demo-account-two');
    assert.equal(getLetterDraftById(demoDraft.id), null);
    setLocalAccountId('demo-account-one');
    assert.equal(getLetterDraftById(demoDraft.id)?.status, 'delivered');
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

test('a prompt starts a separate draft without replacing an empty media draft', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId(null);
    const existing = saveLetterDraft({
      id: 'draft-empty-photo-in-progress',
      subject: 'Keep this attachment',
      payloadKind: 'image',
      mediaUploadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    const promptedDraft = startNewLetter({ forceNew: true });
    const recoveredExisting = getLetterDraftById(existing.id);
    const populated = setActiveLetterDraft({ ...promptedDraft, content: 'Describe a small kindness you still remember.' });

    assert.notEqual(populated.id, existing.id);
    assert.equal(promptedDraft.recipient, '');
    assert.equal(promptedDraft.subject, '');
    assert.equal(promptedDraft.content, '');
    assert.equal(promptedDraft.payloadKind, 'text');
    assert.equal(promptedDraft.localDemo, undefined);
    assert.equal(promptedDraft.mediaPath, undefined);
    assert.equal(promptedDraft.mediaMimeType, undefined);
    assert.equal(promptedDraft.mediaSizeBytes, undefined);
    assert.equal(promptedDraft.mediaUploadId, undefined);
    assert.equal(populated.content, 'Describe a small kindness you still remember.');
    assert.equal(recoveredExisting?.subject, 'Keep this attachment');
    assert.equal(recoveredExisting?.payloadKind, 'image');
    assert.equal(recoveredExisting?.mediaUploadId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(getLetterDraft().id, populated.id);
  } finally {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('backfills and persists one media upload ID for a restored draft before private invite retries', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  try {
    setLocalAccountId('legacy-media-invite-account');
    const restored = saveLetterDraft({ id: 'draft-legacy-media-invite', payloadKind: 'image' });
    assert.equal(restored.mediaUploadId, undefined);

    const prepared = ensureLetterDraftMediaUploadId(restored, 'legacy-media-invite-account');
    assert.ok(prepared?.mediaUploadId);
    assert.equal(isLetterDraftPersisted(prepared, 'legacy-media-invite-account'), true);
    assert.equal(
      ensureLetterDraftMediaUploadId(prepared, 'legacy-media-invite-account')?.mediaUploadId,
      prepared?.mediaUploadId,
    );
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

test('persists an explicitly unaddressed claim with a generic recipient label', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } },
  });
  try {
    setLocalAccountId('unaddressed-claim-owner');
    const draft = saveLetterDraft({
      id: 'draft-unaddressed-claim',
      recipient: '',
      address: { name: '', street: '', city: '', postcode: '', country: '' },
      content: 'A note for whoever needs it.',
      recipientInviteProgress: { username: 'old.friend', status: 'copied' },
    });
    const sent = completeSuccessfulSend(draft, 'unaddressed-claim-owner', 'claim_pending', '2026-10-24T00:00:00.000Z', {});

    assert.equal(sent?.status, 'claim_pending');
    assert.equal(sent?.recipient, '');
    assert.equal(sent?.address.name, '');
    assert.equal(sent?.recipientInviteProgress, undefined);
    assert.equal(getLetterDraftById(draft.id)?.status, 'claim_pending');
    assert.equal(getLettersWithDraft().find((letter) => letter.id === draft.id)?.recipient, 'Anyone with the link');

    const ordinaryDraft = saveLetterDraft({ id: 'draft-blank-ordinary-send', recipient: '', content: 'Still needs a recipient.' });
    assert.equal(completeSuccessfulSend(ordinaryDraft, 'unaddressed-claim-owner', 'delivered', '2026-10-24T00:00:01.000Z', {}), null);
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
