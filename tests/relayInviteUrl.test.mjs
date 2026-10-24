import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRelayScanUrl, resolveRelayToken, stripRelayTokenQuery } from '../lib/relayInviteUrl.ts';

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
  assert.equal(resolveRelayToken(url.hash), token);
});

test('relay bearer tokens resolve only from the URL fragment', () => {
  assert.equal(resolveRelayToken('#token=fragment-token'), 'fragment-token');
  assert.equal(resolveRelayToken('#other=value'), '');
  assert.equal(resolveRelayToken(''), '');
});

test('legacy query tokens are stripped but never resolved as bearer capabilities', () => {
  const token = '8f14e45f-ea2b-4c8a-ae4f-56de6c560001';
  const url = stripRelayTokenQuery(
    new URL(`https://drop.test/relay/handoff?letter=drop+42&dest=Bandra+West&token=${token}`),
  );

  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.get('letter'), 'drop 42');
  assert.equal(url.searchParams.get('dest'), 'Bandra West');
  assert.equal(resolveRelayToken(url.hash), '');
});
