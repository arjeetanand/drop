import assert from 'node:assert/strict';
import test from 'node:test';
import { copyGuestDraftToAccount, getGuestDraftById, getLetterDraft, getLetterDraftById, getLettersWithDraft, saveLetterDraft, setActiveLetterDraft } from '../lib/letterStore.ts';
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
