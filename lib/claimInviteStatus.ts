import type { MockLetter } from '@/data/mockData';

export function getClaimInviteExpiryDuration(payloadKind?: MockLetter['payloadKind']): string {
  return payloadKind === 'image' || payloadKind === 'gif'
    ? 'lasts up to 7 days, with a 30-day claim cutoff'
    : 'lasts 7 days';
}

export function getConfirmedMediaRetryUploadId(
  receipt: { cleanupQueued?: boolean; retryUploadId?: string },
  currentUploadId?: string,
): string | null {
  const retryUploadId = receipt.retryUploadId?.trim();
  return receipt.cleanupQueued === true && retryUploadId && retryUploadId !== currentUploadId
    ? retryUploadId
    : null;
}

type PrivateClaimInviteEligibility = {
  accountConnected: boolean;
  recipientStatus: string;
  recipientUsername: string | null;
  checkedUsername: string | null;
  shareWithoutHandle?: boolean;
  deliveryMode?: MockLetter['deliveryMode'];
  payloadKind?: MockLetter['payloadKind'];
  hasText: boolean;
  hasMedia: boolean;
  attachmentSaved: boolean;
  attachmentBusy: boolean;
};

function hasEligiblePrivateClaimRecipientAndPayload(input: PrivateClaimInviteEligibility): boolean {
  const unaddressedLink = input.shareWithoutHandle === true
    && input.recipientStatus === 'idle'
    && !input.recipientUsername
    && !input.checkedUsername;
  const checkedMissingHandle = input.recipientStatus === 'not-found'
    && Boolean(input.recipientUsername)
    && input.checkedUsername === input.recipientUsername;
  if (!input.accountConnected || (!unaddressedLink && !checkedMissingHandle) || input.attachmentBusy) return false;

  const payloadKind = input.payloadKind || 'text';
  return payloadKind === 'text'
    ? input.hasText && !input.hasMedia
    : input.hasMedia && input.attachmentSaved;
}

export function canOfferPrivateClaimInvite(input: PrivateClaimInviteEligibility): boolean {
  return input.deliveryMode === 'instant' && hasEligiblePrivateClaimRecipientAndPayload(input);
}

export function canOfferInstantClaimSwitch(input: PrivateClaimInviteEligibility): boolean {
  return input.deliveryMode === 'relay' && hasEligiblePrivateClaimRecipientAndPayload(input);
}

export function isEligibleSenderClaim(letter: MockLetter): boolean {
  return letter.direction === 'sent'
    && letter.status === 'delivered'
    && letter.deliveryMode === 'instant'
    && ['text', 'image', 'gif'].includes(letter.payloadKind || 'text')
    && !letter.sample
    && !letter.localDemo;
}

export function isEligiblePendingSenderClaim(letter: MockLetter): boolean {
  return letter.direction === 'sent'
    && letter.status === 'claim_pending'
    && letter.deliveryMode === 'instant'
    && ['text', 'image', 'gif'].includes(letter.payloadKind || 'text')
    && !letter.sample
    && !letter.localDemo;
}

export function needsSenderClaimStatusRetry(letter: MockLetter | null, statusHydrated: boolean): boolean {
  return !statusHydrated && Boolean(letter && isEligibleSenderClaim(letter) && !letter.claimedViaInvite);
}

export function markSenderClaimedDrops(
  letters: MockLetter[],
  claimedLetterIds: readonly string[] | null,
): MockLetter[] {
  if (!claimedLetterIds?.length) return letters;
  const claimedIds = new Set(claimedLetterIds);
  return letters.map((letter) => (
    isEligibleSenderClaim(letter) && claimedIds.has(letter.id)
      ? { ...letter, claimedViaInvite: true }
      : letter
  ));
}

export function getClaimedDropLabel(letter: MockLetter): string | null {
  return letter.claimedViaInvite && isEligibleSenderClaim(letter)
    ? `Claimed by ${letter.recipient || 'your recipient'}`
    : null;
}

export function retainKnownClaimStatus(previous: MockLetter | null, refreshed: MockLetter): MockLetter {
  return previous?.id === refreshed.id
    && previous.claimedViaInvite
    && isEligibleSenderClaim(refreshed)
    && !refreshed.claimedViaInvite
    ? { ...refreshed, claimedViaInvite: true }
    : refreshed;
}
