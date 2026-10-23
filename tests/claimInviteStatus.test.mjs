import assert from 'node:assert/strict';
import test from 'node:test';
import { getClaimedDropLabel, isEligibleSenderClaim, markSenderClaimedDrops, needsSenderClaimStatusRetry, retainKnownClaimStatus } from '../lib/claimInviteStatus.ts';

function letter(id, extra = {}) {
  return {
    id,
    recipient: 'New Friend',
    direction: 'sent',
    status: 'delivered',
    deliveryMode: 'instant',
    payloadKind: 'text',
    subject: 'A private note',
    excerpt: 'A note',
    ...extra,
  };
}

test('attaches durable claim status only to matching delivered sender text drops', () => {
  const letters = [
    letter('claimed'),
    letter('ordinary'),
    letter('pending', { status: 'claim_pending' }),
    letter('received', { direction: 'received' }),
    letter('relay', { deliveryMode: 'relay' }),
    letter('photo', { payloadKind: 'image' }),
    letter('sample', { sample: true }),
    letter('demo', { localDemo: true }),
  ];

  const updated = markSenderClaimedDrops(letters, ['claimed', 'pending', 'received', 'relay', 'photo', 'sample', 'demo']);

  assert.equal(updated[0].claimedViaInvite, true);
  assert.deepEqual(updated.slice(1).map((drop) => drop.claimedViaInvite), Array(7).fill(undefined));
  assert.equal(letters[0].claimedViaInvite, undefined, 'The mapping does not mutate the mailbox snapshot.');
});

test('keeps the claim label tied to a confirmed delivered private text claim', () => {
  assert.equal(getClaimedDropLabel(letter('claimed', { claimedViaInvite: true })), 'Claimed by New Friend');
  assert.equal(getClaimedDropLabel(letter('ordinary')), null);
  assert.equal(getClaimedDropLabel(letter('pending', { status: 'claim_pending', claimedViaInvite: true })), null);
  assert.equal(getClaimedDropLabel(letter('received', { direction: 'received', claimedViaInvite: true })), null);
  assert.equal(getClaimedDropLabel(letter('photo', { payloadKind: 'image', claimedViaInvite: true })), null);
  assert.equal(getClaimedDropLabel(letter('sample', { sample: true, claimedViaInvite: true })), null);
});

test('keeps a confirmed claim cue when a same-drop detail refresh is temporarily unavailable', () => {
  const previous = letter('claimed', { claimedViaInvite: true });
  const refreshed = letter('claimed');
  const other = letter('other');
  const noLongerEligible = letter('claimed', { status: 'claim_pending' });

  assert.equal(retainKnownClaimStatus(previous, refreshed).claimedViaInvite, true);
  assert.equal(retainKnownClaimStatus(previous, other).claimedViaInvite, undefined);
  assert.equal(retainKnownClaimStatus(previous, noLongerEligible).claimedViaInvite, undefined);
});

test('retries hydration only for an eligible delivered sender text drop without a known claim', () => {
  assert.equal(needsSenderClaimStatusRetry(letter('ordinary'), false), true);
  assert.equal(needsSenderClaimStatusRetry(letter('claimed', { claimedViaInvite: true }), false), false);
  assert.equal(needsSenderClaimStatusRetry(letter('ordinary'), true), false);
  assert.equal(needsSenderClaimStatusRetry(letter('pending', { status: 'claim_pending' }), false), false);
  assert.equal(needsSenderClaimStatusRetry(letter('photo', { payloadKind: 'image' }), false), false);
  assert.equal(needsSenderClaimStatusRetry(letter('received', { direction: 'received' }), false), false);
  assert.equal(isEligibleSenderClaim(letter('ordinary')), true);
});
