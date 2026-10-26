import type { MockLetter } from '@/data/mockData';
import { isEligibleReceivedDrop } from './mailboxView.ts';
import { retainKnownClaimStatus } from './claimInviteStatus.ts';
import type { RecipientDropReadEventDetail } from './recipientDropReadEvent.ts';

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
  previousReadStateLetters: MockLetter[] = previousLetters,
) {
  const merged = new Map(localLetters.map((letter) => [letter.id, letter]));
  const previouslyClaimed = new Map(previousLetters
    .filter((letter) => letter.claimedViaInvite)
    .map((letter) => [letter.id, letter]));
  const previouslyReadState = new Map(previousReadStateLetters.map((letter) => [letter.id, letter]));
  remoteLetters.forEach((letter) => {
    const durableStatus = retainKnownClaimStatus(previouslyClaimed.get(letter.id) || null, letter);
    const previousReadAt = previouslyReadState.get(letter.id)?.recipientReadAt;
    const recipientReadAt = previousReadAt !== undefined && letter.recipientReadAt === undefined
      ? previousReadAt
      : typeof previousReadAt === 'string' && previousReadAt.length > 0
        ? previousReadAt
        : letter.recipientReadAt;
    merged.set(durableStatus.id, recipientReadAt === undefined
      ? durableStatus
      : { ...durableStatus, recipientReadAt });
  });
  return Array.from(merged.values());
}

/** Apply a confirmed server receipt without allowing an older receipt to replace it. */
export function applyRecipientDropRead(
  letters: MockLetter[],
  detail: RecipientDropReadEventDetail,
) {
  return letters.map((letter) => {
    if (letter.id !== detail.letterId || !isEligibleReceivedDrop(letter)) return letter;
    const recipientReadAt = typeof letter.recipientReadAt === 'string' && letter.recipientReadAt.length > 0
      ? letter.recipientReadAt
      : detail.readAt;
    return { ...letter, recipientReadAt };
  });
}

/** Replay confirmed receipts that arrived before their mailbox rows were loaded. */
export function applyRecipientDropReadEvents(
  letters: MockLetter[],
  events: Iterable<RecipientDropReadEventDetail>,
) {
  return Array.from(events).reduce(
    (updatedLetters, event) => applyRecipientDropRead(updatedLetters, event),
    letters,
  );
}
