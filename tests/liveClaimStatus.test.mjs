import assert from 'node:assert/strict';
import test from 'node:test';
import { getLiveClaimCompletionUpdate } from '../lib/liveClaimStatus.ts';

function letter(id, status, extra = {}) {
  return {
    id,
    direction: 'sent',
    status,
    deliveryMode: 'instant',
    payloadKind: 'text',
    recipient: status === 'claim_pending' ? 'your invited friend' : 'New Friend',
    subject: 'A private note',
    ...extra,
  };
}

test('a matching sender claim transition updates the open drop and announces once', () => {
  const pending = letter('drop-1', 'claim_pending');
  const delivered = letter('drop-1', 'delivered');
  const update = getLiveClaimCompletionUpdate(pending, delivered, 'drop-1');

  assert.deepEqual(update, {
    letter: { ...delivered, claimedViaInvite: true },
    announcement: 'Claimed by New Friend. The private drop is now addressed to them.',
  });
  assert.equal(update.letter.claimedViaInvite, true, 'A live claim transition leaves a durable status in the current UI state.');
  assert.equal(
    getLiveClaimCompletionUpdate(update.letter, delivered, 'drop-1'),
    null,
    'A repeated or late read cannot announce the same claim twice.',
  );
});

test('a matching instant image or GIF claim transition updates sender state', () => {
  for (const payloadKind of ['image', 'gif']) {
    const pending = letter('drop-1', 'claim_pending', { payloadKind });
    const delivered = letter('drop-1', 'delivered', { payloadKind });
    const update = getLiveClaimCompletionUpdate(pending, delivered, 'drop-1');

    assert.equal(update?.letter.claimedViaInvite, true);
    assert.equal(update?.announcement, 'Claimed by New Friend. The private drop is now addressed to them.');
  }
});

test('stale, unrelated, and non-claim refreshes do not change sender state', () => {
  const pending = letter('drop-1', 'claim_pending');
  const candidates = [
    [null, letter('drop-1', 'delivered'), 'drop-1'],
    [pending, letter('drop-2', 'delivered'), 'drop-1'],
    [pending, letter('drop-1', 'claim_pending'), 'drop-1'],
    [pending, letter('drop-1', 'delivered', { direction: 'received' }), 'drop-1'],
    [pending, letter('drop-1', 'delivered', { deliveryMode: 'relay' }), 'drop-1'],
    [letter('drop-1', 'claim_pending', { payloadKind: 'unknown' }), letter('drop-1', 'delivered', { payloadKind: 'unknown' }), 'drop-1'],
    [pending, letter('drop-1', 'delivered', { payloadKind: 'gif' }), 'drop-1'],
    [pending, letter('drop-1', 'delivered'), 'drop-2'],
  ];

  for (const [current, refreshed, expectedDropId] of candidates) {
    assert.equal(getLiveClaimCompletionUpdate(current, refreshed, expectedDropId), null);
  }
});
