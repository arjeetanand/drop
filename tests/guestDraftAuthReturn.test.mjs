import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthAccountCurrent, resolveGuestDraftAuthReturn, resolveStoredDraftAuthReturn } from '../lib/guestDraftAuthReturn.ts';
import { copyGuestDraftToAccount, getGuestDraftById, getStoredLetterDraftById, saveLetterDraft } from '../lib/letterStore.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

function mockLocalStorage(values = new Map()) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } },
  });
  return () => {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  };
}

test('allows a draft retry only while the current auth session matches the account', async () => {
  const matching = await isAuthAccountCurrent('account-one', async () => ({
    data: { session: { user: { id: 'account-one' } } }, error: null,
  }));
  const changed = await isAuthAccountCurrent('account-one', async () => ({
    data: { session: { user: { id: 'account-two' } } }, error: null,
  }));
  const unavailable = await isAuthAccountCurrent('account-one', async () => ({
    data: { session: null }, error: new Error('session read failed'),
  }));
  const thrown = await isAuthAccountCurrent('account-one', async () => { throw new Error('session read failed'); });

  assert.equal(matching, true);
  assert.equal(changed, false);
  assert.equal(unavailable, false);
  assert.equal(thrown, false);
});

test('does not return to compose when guest media transfer fails and preserves the guest draft', async () => {
  const restoreWindow = mockLocalStorage();
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: 'draft-guest-photo', content: 'A caption', payloadKind: 'image' });
    setLocalAccountId('account-one');
    let accountReadbackAttempted = false;

    const result = await resolveGuestDraftAuthReturn(
      `/compose?letter=${guestDraft.id}`,
      guestDraft.id,
      'account-one',
      (draftId, accountId) => copyGuestDraftToAccount(draftId, accountId, async () => false),
      (draftId, accountId) => {
        accountReadbackAttempted = true;
        return getStoredLetterDraftById(draftId, accountId);
      },
    );

    assert.deepEqual(result, { status: 'retry' });
    assert.equal(accountReadbackAttempted, false);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.content, guestDraft.content);
    assert.equal(getGuestDraftById(guestDraft.id)?.payloadKind, 'image');
  } finally {
    restoreWindow();
  }
});

test('routes to the remapped ID only after the account copy can be read back', async () => {
  const restoreWindow = mockLocalStorage();
  try {
    setLocalAccountId(null);
    const guestDraft = saveLetterDraft({ id: '3', content: 'Guest version of the starter.' });
    setLocalAccountId('account-one');
    saveLetterDraft({ id: '3', content: 'Account version of the starter.' });

    const result = await resolveGuestDraftAuthReturn(
      '/compose?letter=3&source=auth#editor',
      guestDraft.id,
      'account-one',
      copyGuestDraftToAccount,
      getStoredLetterDraftById,
    );

    assert.equal(result.status, 'ready');
    assert.notEqual(result.draftId, guestDraft.id);
    assert.equal(result.nextPath, `/compose?letter=${result.draftId}&source=auth#editor`);
    assert.equal(getStoredLetterDraftById(result.draftId, 'account-one')?.content, guestDraft.content);
    setLocalAccountId(null);
    assert.equal(getGuestDraftById(guestDraft.id)?.content, guestDraft.content);
  } finally {
    restoreWindow();
  }
});

test('keeps the retry result when account readback is missing or mismatched', async () => {
  const copyDraft = async () => ({ id: 'draft-copied' });

  assert.deepEqual(await resolveGuestDraftAuthReturn(
    '/compose?letter=draft-guest',
    'draft-guest',
    'account-one',
    copyDraft,
    () => null,
  ), { status: 'retry' });

  assert.deepEqual(await resolveGuestDraftAuthReturn(
    '/compose?letter=draft-guest',
    'draft-guest',
    'account-one',
    copyDraft,
    () => ({ id: 'some-other-draft' }),
  ), { status: 'retry' });
});

test('rejects unrelated return routes before attempting a draft transfer', async () => {
  let copied = false;
  const result = await resolveGuestDraftAuthReturn(
    '/profile?next=%2Fcompose%3Fletter%3Ddraft-guest',
    'draft-guest',
    'account-one',
    async () => { copied = true; return { id: 'draft-guest' }; },
    () => ({ id: 'draft-guest' }),
  );

  assert.deepEqual(result, { status: 'retry' });
  assert.equal(copied, false);
});

test('does not resume a compose return when neither guest nor account copy can be verified', () => {
  assert.deepEqual(resolveStoredDraftAuthReturn(
    '/compose?letter=draft-missing',
    'draft-missing',
    'account-one',
    () => null,
  ), { status: 'retry' });

  assert.deepEqual(resolveStoredDraftAuthReturn(
    '/compose?letter=draft-missing',
    'draft-missing',
    'account-one',
    (draftId, accountId) => accountId === 'account-one' ? { id: draftId } : null,
  ), {
    status: 'ready',
    nextPath: '/compose?letter=draft-missing',
    draftId: 'draft-missing',
  });
});
