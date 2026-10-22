import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  clearRelayAcceptanceAttempt,
  getRelayAcceptanceRecoveryKey,
  readRelayAcceptanceAttempt,
  saveRelayAcceptanceAttempt,
} from '../lib/relayAcceptanceRecovery.ts';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const token = '8f14e45f-ea2b-4c8a-ae4f-56de6c560001';
const accountId = 'local-account-a';
const attempt = {
  requestId: '7a51d1ae-b29e-4525-880b-86b3db9a6e61',
  name: 'Mira',
  neighborhood: '',
  note: 'Met near the market.',
  savedAt: Date.now(),
};

test('relay acceptance recovery key is stable, scoped, and does not expose the invite token', async () => {
  const key = await getRelayAcceptanceRecoveryKey(token, accountId);

  assert.match(key, /^drop:relay-acceptance:v1:[a-f0-9]{64}$/);
  assert.equal(await getRelayAcceptanceRecoveryKey(token, accountId), key);
  assert.notEqual(await getRelayAcceptanceRecoveryKey(token, 'local-account-b'), key);
  assert.notEqual(await getRelayAcceptanceRecoveryKey('8f14e45f-ea2b-4c8a-ae4f-56de6c560002', accountId), key);
  assert.equal(key.includes(token), false);
});

test('relay acceptance attempts round-trip within an hour and can be cleared', async () => {
  const storage = createStorage();
  const key = await getRelayAcceptanceRecoveryKey(token, accountId);

  assert.equal(saveRelayAcceptanceAttempt(storage, key, attempt), true);
  assert.deepEqual(readRelayAcceptanceAttempt(storage, key, attempt.savedAt + 60 * 60 * 1000), attempt);

  clearRelayAcceptanceAttempt(storage, key);
  assert.equal(readRelayAcceptanceAttempt(storage, key, attempt.savedAt + 60 * 60 * 1000), null);
});

test('expired and malformed relay acceptance attempts are discarded', async () => {
  const storage = createStorage();
  const key = await getRelayAcceptanceRecoveryKey(token, accountId);

  saveRelayAcceptanceAttempt(storage, key, attempt);
  assert.equal(readRelayAcceptanceAttempt(storage, key, attempt.savedAt + 24 * 60 * 60 * 1000 + 1), null);
  assert.equal(storage.values.has(key), false);

  storage.setItem(key, '{not valid json');
  assert.equal(readRelayAcceptanceAttempt(storage, key, attempt.savedAt), null);
  assert.equal(storage.values.has(key), false);
});

test('storage failures do not throw into the relay flow', async () => {
  const key = await getRelayAcceptanceRecoveryKey(token, accountId);
  const unavailable = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };

  assert.equal(saveRelayAcceptanceAttempt(unavailable, key, attempt), false);
  assert.equal(readRelayAcceptanceAttempt(unavailable, key, attempt.savedAt), null);
  assert.doesNotThrow(() => clearRelayAcceptanceAttempt(unavailable, key));
});
