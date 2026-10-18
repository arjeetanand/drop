import assert from 'node:assert/strict';
import test from 'node:test';
import { isRelayToken, RELAY_CARRIER_TOKEN_TTL_SECONDS, RELAY_TOKEN_TTL_SECONDS, validateRelayHandoff } from '../lib/relayValidation.ts';

test('accepts an opaque UUID capability and fixes the pass lifetime at ten minutes', () => {
  assert.equal(isRelayToken('8f14e45f-ea2b-4c8a-ae4f-56de6c560001'), true);
  assert.equal(RELAY_TOKEN_TTL_SECONDS, 600);
  assert.equal(RELAY_CARRIER_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60);
});

test('rejects malformed or low-entropy relay tokens', () => {
  for (const token of ['', '1234', '8f14e45f-ea2b-1c8a-ae4f-56de6c560001', '../other-letter']) {
    assert.equal(isRelayToken(token), false);
  }
});

test('accepts bounded relay details with or without GPS coordinates', () => {
  assert.equal(validateRelayHandoff({ name: 'Mira', neighborhood: 'Bandra West' }), null);
  assert.equal(validateRelayHandoff({
    name: 'Mira',
    neighborhood: 'Bandra West',
    note: 'Passed at the market.',
    handoffCoords: { lat: 19.05, lng: 72.82 },
    acceptedCoords: { lat: 19.05, lng: 72.82 },
  }), null);
});

test('rejects empty, oversized, and out-of-range handoff details', () => {
  assert.match(validateRelayHandoff({ name: '  ', neighborhood: 'Dadar' }) ?? '', /carrier name/);
  assert.match(validateRelayHandoff({ name: 'A'.repeat(61), neighborhood: 'Dadar' }) ?? '', /carrier name/);
  assert.match(validateRelayHandoff({ name: 'Mira', neighborhood: 'N'.repeat(121) }) ?? '', /neighborhood/);
  assert.match(validateRelayHandoff({ name: 'Mira', neighborhood: 'Dadar', note: 'x'.repeat(501) }) ?? '', /note/);
  assert.match(validateRelayHandoff({ name: 'Mira', neighborhood: 'Dadar', acceptedCoords: { lat: 91, lng: 0 } }) ?? '', /coordinates/);
});
