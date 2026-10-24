import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthCallbackActivity, exchangeAuthCodeOnce, exchangeAuthCodeWhileActive } from '../lib/authCallbackSafety.ts';

test('reuses one pending PKCE exchange when the callback effect is replayed', async () => {
  const slot = { current: null };
  let exchanges = 0;
  let resolveExchange;
  const exchange = async (code) => {
    exchanges += 1;
    return new Promise((resolve) => { resolveExchange = () => resolve({ code }); });
  };

  const first = exchangeAuthCodeOnce(slot, 'one-time-code', exchange);
  const replay = exchangeAuthCodeOnce(slot, 'one-time-code', exchange);

  assert.strictEqual(replay, first);
  await Promise.resolve();
  assert.equal(exchanges, 1);
  resolveExchange();
  assert.deepEqual(await first, { code: 'one-time-code' });
});

test('a new callback code gets its own exchange', async () => {
  const slot = { current: null };
  const exchangedCodes = [];
  const exchange = async (code) => {
    exchangedCodes.push(code);
    return code;
  };

  assert.equal(await exchangeAuthCodeOnce(slot, 'first-code', exchange), 'first-code');
  assert.equal(await exchangeAuthCodeOnce(slot, 'next-code', exchange), 'next-code');
  assert.deepEqual(exchangedCodes, ['first-code', 'next-code']);
});

test('a callback effect cannot navigate after its cleanup', () => {
  const activity = createAuthCallbackActivity();
  const destinations = [];

  activity.whileActive(() => destinations.push('/claim'));
  activity.dispose();
  activity.whileActive(() => destinations.push('/profile?authError=stale'));

  assert.deepEqual(destinations, ['/claim']);
  assert.equal(activity.isActive(), false);
});

test('only the replayed active effect handles and routes the shared exchange result', async () => {
  const slot = { current: null };
  const firstActivity = createAuthCallbackActivity();
  const replayActivity = createAuthCallbackActivity();
  const destinations = [];
  let exchanges = 0;
  let resolveExchange;
  const exchange = async (code) => {
    exchanges += 1;
    return new Promise((resolve) => { resolveExchange = () => resolve({ data: { session: { user: { id: 'account-1' } } }, error: null, code }); });
  };

  const first = exchangeAuthCodeWhileActive(slot, firstActivity, 'one-time-code', exchange);
  firstActivity.dispose();
  const replay = exchangeAuthCodeWhileActive(slot, replayActivity, 'one-time-code', exchange);

  await Promise.resolve();
  assert.equal(exchanges, 1);
  resolveExchange();
  assert.deepEqual(await first, { active: false });

  const result = await replay;
  assert.equal(result.active, true);
  if (result.active && result.value.data.session) {
    replayActivity.whileActive(() => destinations.push('/claim?handoff=opaque-id'));
  }
  firstActivity.whileActive(() => destinations.push('/profile?authError=stale'));

  assert.deepEqual(destinations, ['/claim?handoff=opaque-id']);
});
