import assert from 'node:assert/strict';
import test from 'node:test';
import { shareInviteLink } from '../lib/shareInvite.ts';

test('uses native sharing without copying the private invite link', async () => {
  let shared;
  let copied = false;
  const result = await shareInviteLink('https://drop.test/relay/scan?token=opaque', async (data) => { shared = data; }, async () => { copied = true; });

  assert.equal(result, 'shared');
  assert.equal(shared.url, 'https://drop.test/relay/scan?token=opaque');
  assert.equal(copied, false);
});

test('treats a cancelled share sheet as intentional', async () => {
  let copied = false;
  const result = await shareInviteLink('/relay/scan', async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }, async () => { copied = true; });

  assert.equal(result, 'cancelled');
  assert.equal(copied, false);
});

test('falls back to copy when native sharing fails or is unavailable', async () => {
  let copied;
  const result = await shareInviteLink('/relay/scan', async () => { throw new Error('share unavailable'); }, async (url) => { copied = url; });

  assert.equal(result, 'copied');
  assert.equal(copied, '/relay/scan');
  assert.equal(await shareInviteLink('/relay/scan', undefined, async () => undefined), 'copied');
});

test('reports when neither sharing nor copying is available', async () => {
  assert.equal(await shareInviteLink('/relay/scan', undefined, async () => { throw new Error('clipboard unavailable'); }), 'unavailable');
});
