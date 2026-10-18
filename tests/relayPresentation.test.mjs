import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemoteRelayHandoffs } from '../components/relayPresentation.ts';

const localRelay = {
  letterId: 'drop-1',
  subject: 'A sealed drop',
  recipient: 'Eleanor',
  passcode: 'DROP-1',
  startedAt: '2026-10-18T09:00:00.000Z',
  durationHours: 0,
  currentCarrierName: 'Local carrier',
  handoffs: [
    { id: 'legacy-1', name: 'Local carrier', role: 'carrier', location: 'Bandra', note: '', createdAt: '2026-10-18T09:00:00.000Z' },
  ],
  gpsWaypoints: [
    { coords: { lat: 19.05, lng: 72.83 }, neighborhood: 'Bandra', timestamp: '2026-10-18T09:00:00.000Z', carrierName: 'Local carrier' },
  ],
};

test('merges remote handoffs with local history, orders the route, and deduplicates matching ids', () => {
  const remote = [
    { id: 'legacy-1', name: 'Updated local', role: 'carrier', location: 'Dadar', neighborhood: 'Dadar', note: 'Heading south', createdAt: '2026-10-18T10:00:00.000Z', coords: { lat: 19.02, lng: 72.85 } },
    { id: 'remote-1', name: 'Mina', role: 'carrier', location: 'Colaba', neighborhood: 'Colaba', note: '', createdAt: '2026-10-18T11:00:00.000Z' },
  ];

  const merged = mergeRemoteRelayHandoffs(localRelay, remote);

  assert.deepEqual(merged.handoffs.map(({ id }) => id), ['legacy-1', 'remote-1']);
  assert.equal(merged.handoffs[0].name, 'Updated local');
  assert.deepEqual(merged.gpsWaypoints.map(({ neighborhood }) => neighborhood), ['Bandra', 'Dadar']);
  assert.equal(merged.currentCarrierName, 'Mina');
  assert.equal(merged.durationHours, 1);
});

test('keeps local waypoints when remote handoffs have no optional coordinates', () => {
  const merged = mergeRemoteRelayHandoffs(localRelay, [
    { id: 'remote-2', name: 'No GPS', role: 'carrier', location: 'Nearby area', neighborhood: 'Nearby area', note: '', createdAt: '2026-10-18T09:30:00.000Z' },
  ]);

  assert.equal(merged.gpsWaypoints.length, 1);
  assert.equal(merged.gpsWaypoints[0].neighborhood, 'Bandra');
  assert.equal(merged.currentCarrierName, 'No GPS');
});
