import assert from 'node:assert/strict';
import test from 'node:test';
import { authCallbackRoute, profileRoute } from '../lib/inviteOnboarding.ts';
import { createProfileSharePayload } from '../lib/profileInviteShare.ts';
import { shareInviteLink } from '../lib/shareInvite.ts';

test('keeps invite context on profile and through auth callback routes', () => {
  assert.equal(profileRoute(true), '/profile?invite=1');
  assert.equal(profileRoute(false), '/profile');
  assert.equal(profileRoute(true, '/compose?letter=draft-1'), '/profile?invite=1&next=%2Fcompose%3Fletter%3Ddraft-1');
  assert.equal(authCallbackRoute(true), '/auth/callback?invite=1');
  assert.equal(authCallbackRoute(false), '/auth/callback');
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

test('rejects invalid handles before building an invite share payload', () => {
  assert.equal(createProfileSharePayload('user@example.test', 'https://drop.test'), null);
  assert.equal(createProfileSharePayload('../draft', 'https://drop.test'), null);
});
