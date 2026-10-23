import assert from 'node:assert/strict';
import test from 'node:test';
import { canOfferPrivateClaimInvite, getClaimInviteExpiryDuration, getClaimedDropLabel, getConfirmedMediaRetryUploadId, isEligiblePendingSenderClaim, isEligibleSenderClaim, markSenderClaimedDrops, needsSenderClaimStatusRetry, retainKnownClaimStatus } from '../lib/claimInviteStatus.ts';

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

test('attaches durable claim status only to matching delivered sender instant drops', () => {
  const letters = [
    letter('claimed'),
    letter('ordinary'),
    letter('pending', { status: 'claim_pending' }),
    letter('received', { direction: 'received' }),
    letter('relay', { deliveryMode: 'relay' }),
    letter('photo', { payloadKind: 'image' }),
    letter('gif', { payloadKind: 'gif' }),
    letter('sample', { sample: true }),
    letter('demo', { localDemo: true }),
  ];

  const updated = markSenderClaimedDrops(letters, ['claimed', 'pending', 'received', 'relay', 'photo', 'gif', 'sample', 'demo']);

  assert.equal(updated[0].claimedViaInvite, true);
  assert.equal(updated[5].claimedViaInvite, true);
  assert.equal(updated[6].claimedViaInvite, true);
  assert.deepEqual([updated[1], updated[2], updated[3], updated[4], updated[7], updated[8]].map((drop) => drop.claimedViaInvite), Array(6).fill(undefined));
  assert.equal(letters[0].claimedViaInvite, undefined, 'The mapping does not mutate the mailbox snapshot.');
});

test('keeps the claim label tied to a confirmed delivered private claim', () => {
  assert.equal(getClaimedDropLabel(letter('claimed', { claimedViaInvite: true })), 'Claimed by New Friend');
  assert.equal(getClaimedDropLabel(letter('ordinary')), null);
  assert.equal(getClaimedDropLabel(letter('pending', { status: 'claim_pending', claimedViaInvite: true })), null);
  assert.equal(getClaimedDropLabel(letter('received', { direction: 'received', claimedViaInvite: true })), null);
  assert.equal(getClaimedDropLabel(letter('photo', { payloadKind: 'image', claimedViaInvite: true })), 'Claimed by New Friend');
  assert.equal(getClaimedDropLabel(letter('gif', { payloadKind: 'gif', claimedViaInvite: true })), 'Claimed by New Friend');
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

test('retries hydration only for an eligible delivered sender drop without a known claim', () => {
  assert.equal(needsSenderClaimStatusRetry(letter('ordinary'), false), true);
  assert.equal(needsSenderClaimStatusRetry(letter('claimed', { claimedViaInvite: true }), false), false);
  assert.equal(needsSenderClaimStatusRetry(letter('ordinary'), true), false);
  assert.equal(needsSenderClaimStatusRetry(letter('pending', { status: 'claim_pending' }), false), false);
  assert.equal(needsSenderClaimStatusRetry(letter('photo', { payloadKind: 'image' }), false), true);
  assert.equal(needsSenderClaimStatusRetry(letter('gif', { payloadKind: 'gif' }), false), true);
  assert.equal(needsSenderClaimStatusRetry(letter('received', { direction: 'received' }), false), false);
  assert.equal(isEligibleSenderClaim(letter('ordinary')), true);
});

test('offers a sender claim link only while an eligible instant claim remains unclaimed', () => {
  assert.equal(isEligiblePendingSenderClaim(letter('pending', { status: 'claim_pending' })), true);
  assert.equal(isEligiblePendingSenderClaim(letter('photo-pending', { status: 'claim_pending', payloadKind: 'image' })), true);
  assert.equal(isEligiblePendingSenderClaim(letter('gif-pending', { status: 'claim_pending', payloadKind: 'gif' })), true);
  assert.equal(isEligiblePendingSenderClaim(letter('relay-pending', { status: 'claim_pending', deliveryMode: 'relay' })), false);
  assert.equal(isEligiblePendingSenderClaim(letter('delivered', { status: 'delivered' })), false);
  assert.equal(isEligiblePendingSenderClaim(letter('received', { status: 'claim_pending', direction: 'received' })), false);
  assert.equal(isEligiblePendingSenderClaim(letter('sample', { status: 'claim_pending', sample: true })), false);
});

test('keeps text claim links at seven days and caps media links at the immutable media deadline', () => {
  assert.equal(getClaimInviteExpiryDuration('text'), 'lasts 7 days');
  assert.equal(getClaimInviteExpiryDuration('image'), 'lasts up to 7 days, with a 30-day claim cutoff');
  assert.equal(getClaimInviteExpiryDuration('gif'), 'lasts up to 7 days, with a 30-day claim cutoff');
});

test('uses a fresh media upload ID only after cleanup is confirmed', () => {
  const currentUploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const retryUploadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  assert.equal(getConfirmedMediaRetryUploadId({ retryUploadId }, currentUploadId), null);
  assert.equal(getConfirmedMediaRetryUploadId({ cleanupQueued: true }, currentUploadId), null);
  assert.equal(getConfirmedMediaRetryUploadId({ cleanupQueued: true, retryUploadId: currentUploadId }, currentUploadId), null);
  assert.equal(getConfirmedMediaRetryUploadId({ cleanupQueued: true, retryUploadId }, currentUploadId), retryUploadId);
});

test('offers a private claim send only for the current missing handle and a ready instant payload', () => {
  const base = {
    accountConnected: true,
    recipientStatus: 'not-found',
    recipientUsername: 'new.friend',
    checkedUsername: 'new.friend',
    deliveryMode: 'instant',
    payloadKind: 'image',
    hasText: false,
    hasMedia: true,
    attachmentSaved: true,
    attachmentBusy: false,
  };

  assert.equal(canOfferPrivateClaimInvite(base), true, 'a saved photo can use a claim link without a caption');
  assert.equal(canOfferPrivateClaimInvite({ ...base, payloadKind: 'gif' }), true);
  assert.equal(canOfferPrivateClaimInvite({ ...base, attachmentSaved: false }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, attachmentBusy: true }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, accountConnected: false }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, recipientStatus: 'error' }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, recipientStatus: 'found' }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, checkedUsername: 'someone.else' }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, deliveryMode: 'relay' }), false);
  assert.equal(canOfferPrivateClaimInvite({ ...base, hasMedia: false }), false);

  assert.equal(canOfferPrivateClaimInvite({
    ...base,
    payloadKind: 'text',
    hasText: true,
    hasMedia: false,
    attachmentSaved: false,
  }), true, 'the existing text claim path remains available');
  assert.equal(canOfferPrivateClaimInvite({ ...base, payloadKind: 'text', hasText: false, hasMedia: false }), false);
});
