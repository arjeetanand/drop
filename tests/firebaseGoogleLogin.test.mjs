import assert from 'node:assert/strict';
import test from 'node:test';
import { isFirebaseGoogleLoginEnabled, isFirebasePopupBlockedError } from '../lib/firebaseGoogleConfig.ts';

const firebaseKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_GOOGLE_LOGIN_ENABLED',
];

test('Firebase Google login stays off until explicitly enabled with full web config', () => {
  const previousValues = new Map(firebaseKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of firebaseKeys) delete process.env[key];
    assert.equal(isFirebaseGoogleLoginEnabled(), false);

    for (const key of firebaseKeys.slice(0, -1)) process.env[key] = `test-${key}`;
    assert.equal(isFirebaseGoogleLoginEnabled(), false);

    process.env.NEXT_PUBLIC_FIREBASE_GOOGLE_LOGIN_ENABLED = 'true';
    assert.equal(isFirebaseGoogleLoginEnabled(), true);

    delete process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
    assert.equal(isFirebaseGoogleLoginEnabled(), false);
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('only Firebase popup-blocked errors select the existing redirect fallback', () => {
  assert.equal(isFirebasePopupBlockedError({ code: 'auth/popup-blocked' }), true);
  assert.equal(isFirebasePopupBlockedError({ code: 'auth/popup-closed-by-user' }), false);
  assert.equal(isFirebasePopupBlockedError({ code: 'auth/network-request-failed' }), false);
  assert.equal(isFirebasePopupBlockedError(null), false);
});
