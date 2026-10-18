import assert from 'node:assert/strict';
import test from 'node:test';
import { clearActiveCarry, getActiveCarry, saveActiveCarry } from '../lib/gpsUtils.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

test('active carry helpers keep explicit account data isolated across a switch', (t) => {
  const previousWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  };
  t.after(() => {
    setLocalAccountId(null);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const accountACarry = { letterId: 'drop-a', subject: 'A', recipient: 'One', acceptedAt: '', waypoints: [], destinationNeighborhood: 'North' };
  const accountBCarry = { ...accountACarry, letterId: 'drop-b', subject: 'B' };
  setLocalAccountId('account-a');
  saveActiveCarry(accountACarry, 'account-a');
  setLocalAccountId('account-b');
  saveActiveCarry(accountBCarry);

  assert.equal(getActiveCarry('account-a')?.letterId, 'drop-a');
  assert.equal(getActiveCarry()?.letterId, 'drop-b');
  clearActiveCarry('account-a');
  assert.equal(getActiveCarry('account-a'), null);
  assert.equal(getActiveCarry()?.letterId, 'drop-b');
});
