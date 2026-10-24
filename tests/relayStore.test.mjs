import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

register(new URL('./dropMediaFinalizeLoader.mjs', import.meta.url));

const { confirmHandoff, confirmHandoffFromQR, getInitialRelayState, getRelayStats } = await import('../lib/relayStore.ts');

test('relay carrier count excludes the sender and recipient', () => {
  const seeded = getInitialRelayState();
  assert.equal(getRelayStats(seeded).carriers, 2);

  const senderOnly = {
    ...seeded,
    handoffs: seeded.handoffs.filter((handoff) => handoff.role === 'sender'),
  };
  assert.equal(getRelayStats(senderOnly).carriers, 0);

  const oneCarrier = {
    ...seeded,
    handoffs: [
      ...seeded.handoffs.filter((handoff) => handoff.role === 'sender'),
      ...seeded.handoffs.filter((handoff) => handoff.role === 'carrier').slice(0, 1),
      ...seeded.handoffs.filter((handoff) => handoff.role === 'recipient'),
    ],
  };
  assert.equal(getRelayStats(oneCarrier).carriers, 1);
});

test('manual and QR handoffs can be recorded without inventing a GPS waypoint', (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  } });
  t.after(() => {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });

  setLocalAccountId('relay-no-location-test');
  const manual = confirmHandoff('manual-no-location', {
    name: 'Mira',
    neighborhood: 'Location not shared',
  });
  assert.equal(manual.currentCarrierName, 'Mira');
  assert.equal(manual.handoffs.find((handoff) => handoff.name === 'Mira')?.coords, undefined);
  assert.equal(manual.gpsWaypoints?.length ?? 0, 0);

  const qr = confirmHandoffFromQR(
    'qr-no-location',
    { coords: { lat: 19.05, lng: 72.83 }, neighborhood: 'Bandra', pin: '1234' },
    { name: 'Ari', neighborhood: 'Location not shared' },
  );
  assert.equal(qr.currentCarrierName, 'Ari');
  assert.equal(qr.handoffs.find((handoff) => handoff.name === 'Ari')?.coords, undefined);
  assert.equal(qr.gpsWaypoints?.length, 1);
  assert.equal(qr.gpsWaypoints?.[0].carrierName, 'Previous carrier');
});
