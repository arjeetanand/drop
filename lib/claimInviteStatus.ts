import type { MockLetter } from '@/data/mockData';

export function isEligibleSenderClaim(letter: MockLetter): boolean {
  return letter.direction === 'sent'
    && letter.status === 'delivered'
    && letter.deliveryMode === 'instant'
    && letter.payloadKind === 'text'
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
