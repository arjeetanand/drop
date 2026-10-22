import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRelayScanUrl, resolveRelayToken } from '../lib/relayInviteUrl.ts';

test('new carrier invite URLs keep the bearer token and coordinates out of the request query', () => {
  const token = '8f14e45f-ea2b-4c8a-ae4f-56de6c560001';
  const url = new URL(buildRelayScanUrl('https://drop.test', {
    token,
    letterId: 'drop 42',
    destination: 'Bandra West',
  }));

  assert.equal(url.pathname, '/relay/scan');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['dest', 'letter']);
  for (const key of ['token', 'd', 'pin', 'lat', 'lng']) assert.equal(url.searchParams.has(key), false);
  assert.equal(resolveRelayToken(null, url.hash), token);
});

test('relay scan keeps accepting previously issued query tokens and prefers them over a fragment', () => {
  assert.equal(resolveRelayToken('previously-issued-token', '#token=fragment-token'), 'previously-issued-token');
  assert.equal(resolveRelayToken(null, '#token=fragment-token'), 'fragment-token');
  assert.equal(resolveRelayToken(null, '#other=value'), '');
});
