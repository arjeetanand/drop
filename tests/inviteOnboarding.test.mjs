import assert from 'node:assert/strict';
import test from 'node:test';
import { authCallbackRoute, canEditInviteProfile, claimReturnAfterProfileSync, firstUseProfileSetupRoute, isClaimReturnPath, profileRoute, resolveAuthReturnPath } from '../lib/inviteOnboarding.ts';
import { copyProfileSharePayload, createProfileSharePayload } from '../lib/profileInviteShare.ts';
import { shareInviteLink } from '../lib/shareInvite.ts';

test('keeps invite context on profile and through auth callback routes', () => {
  assert.equal(profileRoute(true), '/profile?invite=1');
  assert.equal(profileRoute(false), '/profile');
  assert.equal(profileRoute(true, '/compose?letter=draft-1'), '/profile?invite=1&next=%2Fcompose%3Fletter%3Ddraft-1');
  assert.equal(profileRoute(true, '/claim'), '/profile?invite=1&next=%2Fclaim');
  assert.equal(profileRoute(true, '/claim?handoff=123e4567-e89b-42d3-a456-426614174000'), '/profile?invite=1&next=%2Fclaim%3Fhandoff%3D123e4567-e89b-42d3-a456-426614174000');
  assert.equal(authCallbackRoute(true), '/auth/callback?invite=1');
  assert.equal(authCallbackRoute(true, '/claim?handoff=123e4567-e89b-42d3-a456-426614174000'), '/auth/callback?invite=1&next=%2Fclaim%3Fhandoff%3D123e4567-e89b-42d3-a456-426614174000');
  assert.equal(authCallbackRoute(false, '//outside.test'), '/auth/callback');
  assert.equal(authCallbackRoute(false), '/auth/callback');
});

test('prefers the return path carried by the current auth callback over stale tab storage', () => {
  const origin = 'https://drop.test';
  const currentClaim = '/claim?handoff=123e4567-e89b-42d3-a456-426614174000';

  assert.equal(resolveAuthReturnPath(currentClaim, '/compose?letter=stale', origin), currentClaim);
  assert.equal(resolveAuthReturnPath('//outside.test', currentClaim, origin), currentClaim);
  assert.equal(resolveAuthReturnPath('//outside.test', '//also-outside.test', origin), null);
});

test('routes a new sender through profile setup while preserving the authenticated draft return', () => {
  const draftPath = '/compose?letter=draft-1';

  assert.equal(firstUseProfileSetupRoute(draftPath, false, 'missing', 'account-1', 'account-1'),
    '/profile?next=%2Fcompose%3Fletter%3Ddraft-1');
  assert.equal(firstUseProfileSetupRoute(draftPath, true, 'missing', 'account-1', 'account-1'),
    '/profile?invite=1&next=%2Fcompose%3Fletter%3Ddraft-1');
  assert.equal(firstUseProfileSetupRoute(draftPath, false, 'missing', 'account-2', 'account-1'), null);
  assert.equal(firstUseProfileSetupRoute(draftPath, false, 'found', 'account-1', 'account-1'), null);
  assert.equal(firstUseProfileSetupRoute(draftPath, false, 'unavailable', null, 'account-1'), null);
  assert.equal(firstUseProfileSetupRoute(draftPath, false, 'error', 'account-1', 'account-1'), null);
  assert.equal(firstUseProfileSetupRoute('/claim?handoff=invite-1', false, 'missing', 'account-1', 'account-1'), null);
  assert.equal(firstUseProfileSetupRoute('//outside.test/compose?letter=draft-1', false, 'missing', 'account-1', 'account-1'), null);
});

test('recognizes a claim return without matching unrelated routes or nested query values', () => {
  assert.equal(isClaimReturnPath('/claim'), true);
  assert.equal(isClaimReturnPath('/claim?handoff=123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isClaimReturnPath('/claim-back'), false);
  assert.equal(isClaimReturnPath('/profile?next=/claim'), false);
  assert.equal(isClaimReturnPath(null), false);
});

test('returns to a safe claim handoff only after the profile has synced', () => {
  const claimPath = '/claim?handoff=123e4567-e89b-42d3-a456-426614174000';

  assert.equal(claimReturnAfterProfileSync(true, claimPath), claimPath);
  assert.equal(claimReturnAfterProfileSync(false, claimPath), null);
  assert.equal(claimReturnAfterProfileSync(true, '/compose?letter=draft-1'), null);
  assert.equal(claimReturnAfterProfileSync(true, '//outside.test/claim'), null);
  assert.equal(claimReturnAfterProfileSync(true, null), null);
});

test('requires a verified signed-in account before editing an invite profile', () => {
  assert.equal(canEditInviteProfile(false, 'signed-out', false, false), true);
  assert.equal(canEditInviteProfile(true, 'signed-out', false, false), false);
  assert.equal(canEditInviteProfile(true, 'signed-in', false, false), true);
  assert.equal(canEditInviteProfile(true, 'signed-in', true, false), false);
  assert.equal(canEditInviteProfile(true, 'signed-in', false, true), false);
});

test('builds a share payload from only the public handle and canonical profile URL', async () => {
  const payload = createProfileSharePayload('@Ada.9', 'https://drop.test');
  assert.deepEqual(payload, {
    title: 'My Drop handle',
    text: '@ada.9',
    url: 'https://drop.test/u/ada.9',
    copyText: '@ada.9\nhttps://drop.test/u/ada.9',
  });

  let shared;
  let copied;
  const result = await shareInviteLink(
    payload.url,
    async (details) => { shared = details; },
    async (text) => { copied = text; },
    { title: payload.title, text: payload.text },
  );

  assert.equal(result, 'shared');
  assert.deepEqual(shared, { title: 'My Drop handle', text: '@ada.9', url: 'https://drop.test/u/ada.9' });
  assert.equal(copied, undefined);
  assert.equal(payload.copyText, '@ada.9\nhttps://drop.test/u/ada.9');
});

test('copies only the public handle and profile URL when explicitly requested', async () => {
  const payload = createProfileSharePayload('@Ada.9', 'https://drop.test');
  let copiedText = '';

  assert.equal(await copyProfileSharePayload(payload, async (text) => { copiedText = text; }), 'copied');
  assert.equal(copiedText, '@ada.9\nhttps://drop.test/u/ada.9');
});

test('exposes the manual-copy fallback when clipboard is missing or denied', async () => {
  const payload = createProfileSharePayload('@Ada.9', 'https://drop.test');

  assert.equal(await copyProfileSharePayload(payload), 'unavailable');
  assert.equal(await copyProfileSharePayload(payload, async () => { throw new Error('NotAllowedError'); }), 'unavailable');
});

test('rejects invalid handles before building an invite share payload', () => {
  assert.equal(createProfileSharePayload('user@example.test', 'https://drop.test'), null);
  assert.equal(createProfileSharePayload('../draft', 'https://drop.test'), null);
});
