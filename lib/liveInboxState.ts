import type { MockLetter } from '@/data/mockData';
import { retainKnownClaimStatus } from './claimInviteStatus.ts';

export interface LiveInboxUpdate {
  arrival: MockLetter | null;
  newCount: number;
  receivedIds: Set<string>;
}

/** Ignore existing inbox rows on first sync and surface only later incoming drops. */
export function getLiveInboxUpdate(
  remoteLetters: MockLetter[],
  previousReceivedIds: ReadonlySet<string> | null,
  signaledDropIds: ReadonlySet<string> = new Set(),
): LiveInboxUpdate {
  const receivedLetters = remoteLetters.filter((letter) => (
    letter.direction === 'received'
    && !letter.sample
    && (letter.status === 'dispatched' || letter.status === 'delivered')
  ));
  const unseenLetters = previousReceivedIds
    ? receivedLetters.filter((letter) => !previousReceivedIds.has(letter.id))
    : receivedLetters.filter((letter) => signaledDropIds.has(letter.id));

  return {
    arrival: unseenLetters[0] ?? null,
    newCount: unseenLetters.length,
    receivedIds: new Set(receivedLetters.map((letter) => letter.id)),
  };
}

export function mergeInboxLetters(
  localLetters: MockLetter[],
  remoteLetters: MockLetter[],
  previousLetters: MockLetter[] = [],
) {
  const merged = new Map(localLetters.map((letter) => [letter.id, letter]));
  const previouslyClaimed = new Map(previousLetters
    .filter((letter) => letter.claimedViaInvite)
    .map((letter) => [letter.id, letter]));
  remoteLetters.forEach((letter) => {
    const durableStatus = retainKnownClaimStatus(previouslyClaimed.get(letter.id) || null, letter);
    merged.set(durableStatus.id, durableStatus);
  });
  return Array.from(merged.values());
}
