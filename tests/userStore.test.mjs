import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingRemoteProfile,
  defaultUserProfile,
  getFirstUseProfile,
  getPendingRemoteProfileSnapshot,
  getUserProfile,
  getUserProfileForAccount,
  getUserProfileOwnerId,
  hasCustomizedUserIdentity,
  hasUnmatchedLocalProfile,
  markPendingRemoteProfileSynced,
  preserveUserProfileForAccount,
  savePendingRemoteProfile,
  saveUserProfile,
  suggestedDropUsername,
  withPendingRemoteProfileLock,
} from '../lib/userStore.ts';

test('suggests a valid, stable, account-specific first-use handle', () => {
  const first = suggestedDropUsername('123e4567-e89b-12d3-a456-426614174000');
  const second = suggestedDropUsername('223e4567-e89b-12d3-a456-426614174000');

  assert.equal(first, 'drop_123e4567e89b12d3a45');
  assert.equal(first.length, 24);
  assert.match(first, /^[a-z0-9._-]{2,24}$/);
  assert.notEqual(first, second);
});

test('preserves a customized local identity when creating a first account profile', () => {
  const localProfile = {
    ...defaultUserProfile,
    displayName: 'Mina Park',
    username: 'mina.p',
    bio: 'Tiny joys, always.',
    lettersSent: 8,
    lettersReceived: 3,
  };

  assert.deepEqual(getFirstUseProfile('user-1', 'mina@example.test', localProfile), {
    displayName: 'Mina Park',
    username: 'mina.p',
    bio: 'Tiny joys, always.',
    lettersSent: 0,
    lettersReceived: 0,
  });
  assert.equal(getFirstUseProfile('user-1', 'Mina', defaultUserProfile).username, suggestedDropUsername('user-1'));
  assert.equal(getFirstUseProfile('user-2', 'New Person', localProfile, 'user-1').username, suggestedDropUsername('user-2'));
});

test('distinguishes a customized local identity from the seeded profile', () => {
  assert.equal(hasCustomizedUserIdentity(defaultUserProfile), false);
  assert.equal(hasCustomizedUserIdentity({ ...defaultUserProfile, username: 'mina.p' }), true);
});

test('keeps a signed-out edit visible beside a different saved account snapshot', () => {
  const remoteProfile = { ...defaultUserProfile, username: 'mina.p' };
  const pendingProfile = { ...defaultUserProfile, username: 'mina.pending' };
  const signedOutEdit = { ...defaultUserProfile, username: 'mina.offline' };

  assert.equal(hasUnmatchedLocalProfile(signedOutEdit, 'account-1', 'account-1', remoteProfile, pendingProfile), true);
  assert.equal(hasUnmatchedLocalProfile(pendingProfile, 'account-1', 'account-1', remoteProfile, pendingProfile), false);
  assert.equal(hasUnmatchedLocalProfile(signedOutEdit, 'account-2', 'account-1', remoteProfile, pendingProfile), false);
});

test('keeps unsynced profiles separate by account and clears only the synced account', async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const values = new Map();
  const lockTails = new Map();
  let failAccountProfileWrites = false;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (name, callback) => {
          const result = (lockTails.get(name) || Promise.resolve()).then(callback);
          lockTails.set(name, result.catch(() => {}));
          return result;
        },
      },
    },
  });
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failAccountProfileWrites && key === 'dear-exe:user-profile:v1:account:blocked') throw new Error('storage full');
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    const firstProfile = { ...defaultUserProfile, username: 'mina.p' };
    const newerProfile = { ...firstProfile, bio: 'Newer edits.' };
    const secondProfile = { ...defaultUserProfile, username: 'jules.r' };
    const syncOrder = [];
    await Promise.all([
      withPendingRemoteProfileLock('account-1', async () => {
        syncOrder.push('first:start');
        await Promise.resolve();
        syncOrder.push('first:end');
      }),
      withPendingRemoteProfileLock('account-1', async () => {
        syncOrder.push('second:start');
        await Promise.resolve();
        syncOrder.push('second:end');
      }),
    ]);
    assert.deepEqual(syncOrder, ['first:start', 'first:end', 'second:start', 'second:end']);
    saveUserProfile(firstProfile, 'account-1');
    assert.equal(getUserProfileOwnerId(), 'account-1');
    saveUserProfile({ bio: 'Edited while signed out.' });
    assert.equal(getUserProfileOwnerId(), 'account-1');
    assert.equal(getFirstUseProfile('account-2', 'New Person', getUserProfile(), getUserProfileOwnerId()).username, suggestedDropUsername('account-2'));
    const accountOneLocalEdits = getUserProfile();
    saveUserProfile(secondProfile, 'account-2');
    assert.deepEqual(getUserProfileForAccount('account-1'), accountOneLocalEdits, 'Switching the shared profile to another account keeps the previous account’s signed-out edits recoverable');
    failAccountProfileWrites = true;
    assert.equal(preserveUserProfileForAccount('blocked', firstProfile), false, 'A storage failure must stop an account switch from overwriting the only local copy');
    failAccountProfileWrites = false;
    const firstPending = await savePendingRemoteProfile('account-1', firstProfile);
    const secondPending = await savePendingRemoteProfile('account-2', secondProfile);
    assert.equal(firstPending.ok, true);
    assert.equal(secondPending.ok, true);
    const firstRevision = firstPending.revision;

    assert.deepEqual(getPendingRemoteProfileSnapshot('account-1')?.profile, firstProfile);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-2')?.profile, secondProfile);
    const [, newerRevision] = await Promise.all([
      clearPendingRemoteProfile('account-1', firstRevision),
      savePendingRemoteProfile('account-1', newerProfile, firstRevision),
      savePendingRemoteProfile('account-2', secondProfile),
    ]);
    assert.equal(newerRevision.ok, true);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-1')?.profile, newerProfile);
    await clearPendingRemoteProfile('account-1', firstRevision);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-1')?.profile, newerProfile);
    await clearPendingRemoteProfile('account-1', newerRevision.revision);
    assert.equal(getPendingRemoteProfileSnapshot('account-1'), null);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-2')?.profile, secondProfile);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    const syncedPending = await savePendingRemoteProfile('account-3', firstProfile);
    assert.equal(syncedPending.ok, true);
    const syncedRevision = syncedPending.revision;
    await clearPendingRemoteProfile('account-3', syncedRevision);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-3')?.profile, firstProfile);
    markPendingRemoteProfileSynced('account-3', syncedRevision);
    assert.equal(getPendingRemoteProfileSnapshot('account-3')?.synced, true, 'A retained synced snapshot is distinguished from unsynced edits');
    const repeatedPending = await savePendingRemoteProfile('account-3', firstProfile);
    assert.equal(repeatedPending.ok, true);
    const repeatedEditsRevision = repeatedPending.revision;
    assert.notEqual(repeatedEditsRevision, syncedRevision);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-3'), {
      profile: firstProfile,
      revision: repeatedEditsRevision,
      synced: false,
    }, 'A new save of the same values remains recoverable after a later sync failure');
    const stalePending = await savePendingRemoteProfile('account-4', firstProfile);
    assert.equal(stalePending.ok, true);
    const staleRevision = stalePending.revision;
    const refusedPending = await savePendingRemoteProfile('account-4', newerProfile);
    assert.deepEqual(refusedPending, { ok: false, reason: 'conflict' }, 'A different unsynced revision cannot be overwritten implicitly');
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-4')?.profile, firstProfile);
    assert.deepEqual(await savePendingRemoteProfile('account-4', newerProfile, staleRevision), {
      ok: false,
      reason: 'conflict',
    }, 'A browser without Web Locks cannot replace the revision even after an explicit restore');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: (name, callback) => {
            const result = (lockTails.get(name) || Promise.resolve()).then(callback);
            lockTails.set(name, result.catch(() => {}));
            return result;
          },
        },
      },
    });
    const currentRevision = await savePendingRemoteProfile('account-4', newerProfile, staleRevision);
    assert.equal(currentRevision.ok, true);
    markPendingRemoteProfileSynced('account-4', staleRevision);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-4'), {
      profile: newerProfile,
      revision: currentRevision.revision,
      synced: false,
    }, 'Marking an older revision synced must keep newer edits pending');
    const savedAccountChoice = await savePendingRemoteProfile('account-8', firstProfile);
    assert.equal(savedAccountChoice.ok, true);
    const replacedWithAccountProfile = await savePendingRemoteProfile('account-8', secondProfile, savedAccountChoice.revision);
    assert.equal(replacedWithAccountProfile.ok, true, 'An explicit choice of the current account profile can resolve a retained device edit');
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-8')?.profile, secondProfile);

    const legacyProfile = { ...firstProfile, bio: 'Old profile format.' };
    const legacyKey = 'dear-exe:pending-profile-sync:v1:legacy';
    values.set(legacyKey, JSON.stringify(legacyProfile));
    const legacySnapshot = getPendingRemoteProfileSnapshot('legacy');
    assert.equal(legacySnapshot?.revision, `legacy:${JSON.stringify(legacyProfile)}`);
    markPendingRemoteProfileSynced('legacy', legacySnapshot.revision);
    assert.equal(getPendingRemoteProfileSnapshot('legacy')?.synced, true);
    values.set(legacyKey, JSON.stringify({ ...legacyProfile, bio: 'Edited in an older open tab.' }));
    assert.equal(getPendingRemoteProfileSnapshot('legacy')?.synced, false, 'Changed legacy data must not reuse its prior synced marker');

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    const noLockPending = await savePendingRemoteProfile('account-6', firstProfile);
    assert.equal(noLockPending.ok, true);
    assert.deepEqual(await savePendingRemoteProfile('account-6', newerProfile, noLockPending.revision), {
      ok: false,
      reason: 'conflict',
    }, 'A browser without Web Locks cannot replace an unsynced revision');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: (name, callback) => {
            const result = (lockTails.get(name) || Promise.resolve()).then(callback);
            lockTails.set(name, result.catch(() => {}));
            return result;
          },
        },
      },
    });
    const modernPending = await savePendingRemoteProfile('account-7', firstProfile);
    assert.equal(modernPending.ok, true);
    const concurrentLegacyProfile = { ...firstProfile, bio: 'Saved by an older open tab.' };
    const legacyMap = JSON.parse(values.get('dear-exe:pending-profile-sync:v1') || '{}');
    legacyMap['account-7'] = { profile: concurrentLegacyProfile, conflict: false };
    values.set('dear-exe:pending-profile-sync:v1', JSON.stringify(legacyMap));
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-7')?.legacyConflict, {
      profile: concurrentLegacyProfile,
      revision: `legacy-map:${JSON.stringify(concurrentLegacyProfile)}`,
    }, 'A divergent write from a legacy tab remains visible beside the newer per-account snapshot');
    assert.deepEqual(await savePendingRemoteProfile('account-7', newerProfile), {
      ok: false,
      reason: 'conflict',
    }, 'A divergent legacy edit cannot be silently overwritten');
    const legacyConflictRevision = `legacy-map:${JSON.stringify(concurrentLegacyProfile)}`;
    const resolvedLegacy = await savePendingRemoteProfile('account-7', concurrentLegacyProfile, legacyConflictRevision);
    assert.equal(resolvedLegacy.ok, true);
    assert.deepEqual(getPendingRemoteProfileSnapshot('account-7'), {
      profile: concurrentLegacyProfile,
      revision: resolvedLegacy.revision,
      synced: false,
    }, 'Choosing the legacy copy preserves it under the current format and acknowledges the old map entry');

    const legacyMapProfile = { ...firstProfile, username: 'legacy.map' };
    values.set('dear-exe:pending-profile-sync:v1', JSON.stringify({
      'account-5': { profile: legacyMapProfile, conflict: false },
    }));
    const legacyMapSnapshot = getPendingRemoteProfileSnapshot('account-5');
    assert.deepEqual(legacyMapSnapshot, {
      profile: legacyMapProfile,
      revision: `legacy-map:${JSON.stringify(legacyMapProfile)}`,
      synced: false,
    }, 'The old shared account map remains recoverable');
    markPendingRemoteProfileSynced('account-5', legacyMapSnapshot.revision);
    const currentMapRevision = await savePendingRemoteProfile('account-5', newerProfile);
    assert.equal(currentMapRevision.ok, true);
    markPendingRemoteProfileSynced('account-5', currentMapRevision.revision);
    await clearPendingRemoteProfile('account-5', currentMapRevision.revision);
    values.delete('dear-exe:pending-profile-sync:v1:account-5');
    assert.equal(getPendingRemoteProfileSnapshot('account-5')?.synced, true, 'A newer sync must not make an acknowledged legacy map entry pending again');
    values.set('dear-exe:pending-profile-sync:v1:broken', 'null');
    values.set('dear-exe:pending-profile-sync:v1:alsoBroken', JSON.stringify({ username: 42 }));
    assert.equal(getPendingRemoteProfileSnapshot('broken'), null);
    assert.equal(getPendingRemoteProfileSnapshot('alsoBroken'), null);
    assert.equal(getUserProfile().username, secondProfile.username);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});
