import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearDropClaimHandoff,
  canUseDropClaimSessionToken,
  dropClaimReturnPath,
  DROP_CLAIM_HANDOFF_TTL_MS,
  isDropClaimHandoffId,
  takeDropClaimHandoff,
  storeDropClaimHandoff,
} from '../lib/dropClaimHandoff.ts';
import { profileRoute } from '../lib/inviteOnboarding.ts';

const token = 'a'.repeat(64);
const handoffId = '00000000-0000-4000-8000-000000000001';

class MemoryStorage {
  values = new Map();

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('shares only an opaque handoff ID, moves the token into the receiving tab, and consumes the shared copy', () => {
  const sharedBrowserStorage = new MemoryStorage();
  const receivingTabStorage = new MemoryStorage();

  const result = storeDropClaimHandoff(token, sharedBrowserStorage, 1000, () => handoffId);

  assert.equal(result, handoffId);
  assert.equal(isDropClaimHandoffId(result), true);
  assert.notEqual(result, token);
  assert.equal(dropClaimReturnPath(result), `/claim?handoff=${handoffId}`);
  assert.equal(profileRoute(true, dropClaimReturnPath(result)).includes(token), false);
  assert.equal(takeDropClaimHandoff(handoffId, sharedBrowserStorage, 1001, (restoredToken) => {
    receivingTabStorage.setItem('drop:claim-token:v1', restoredToken);
    return true;
  }), token);
  assert.equal(receivingTabStorage.getItem('drop:claim-token:v1'), token);
  assert.equal(sharedBrowserStorage.length, 0);
  assert.equal(takeDropClaimHandoff(handoffId, sharedBrowserStorage, 1002), null);
});

test('retains the shared handoff when the receiving tab cannot persist its session copy', () => {
  const storage = new MemoryStorage();
  storeDropClaimHandoff(token, storage, 1000, () => handoffId);

  assert.equal(takeDropClaimHandoff(handoffId, storage, 1001, () => false), token);
  assert.equal(storage.length, 1);
});

test('falls back to the plain claim route for invalid handoff IDs', () => {
  assert.equal(dropClaimReturnPath('../outside'), '/claim');
  assert.equal(dropClaimReturnPath(null), '/claim');
});

test('does not reuse a tab token for a different or unreadable handoff', () => {
  assert.equal(canUseDropClaimSessionToken(handoffId, handoffId, true), true);
  assert.equal(canUseDropClaimSessionToken('00000000-0000-4000-8000-000000000002', handoffId, true), false);
  assert.equal(canUseDropClaimSessionToken(null, handoffId, true), false);
  assert.equal(canUseDropClaimSessionToken(null, null, false), true);
  assert.equal(canUseDropClaimSessionToken(null, handoffId, false), false);
});

test('expires cross-tab handoffs and removes their stored token', () => {
  const storage = new MemoryStorage();
  storeDropClaimHandoff(token, storage, 1000, () => handoffId);

  assert.equal(takeDropClaimHandoff(handoffId, storage, 1000 + DROP_CLAIM_HANDOFF_TTL_MS), null);
  assert.equal(storage.length, 0);
});

test('rejects malformed IDs and corrupt or overlong records', () => {
  const storage = new MemoryStorage();
  storage.setItem('drop:claim-handoff:v1:00000000-0000-4000-8000-000000000001', JSON.stringify({
    token: 'not-a-claim-token',
    expiresAt: 50_000,
  }));

  assert.equal(isDropClaimHandoffId('../outside'), false);
  assert.equal(takeDropClaimHandoff('../outside', storage, 1000), null);
  assert.equal(takeDropClaimHandoff(handoffId, storage, 1000), null);
  assert.equal(storage.length, 0);

  assert.equal(storeDropClaimHandoff('bad-token', storage, 1000, () => handoffId), null);
  assert.equal(storage.length, 0);
});

test('clears a handoff after a successful claim', () => {
  const storage = new MemoryStorage();
  storeDropClaimHandoff(token, storage, 1000, () => handoffId);

  clearDropClaimHandoff(handoffId, storage);

  assert.equal(takeDropClaimHandoff(handoffId, storage, 1001), null);
  assert.equal(storage.length, 0);
});
