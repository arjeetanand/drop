import type { MockLetter } from '@/data/mockData';

export type MailboxFilter = 'all' | 'samples' | 'transit' | 'received' | 'sent' | 'drafts';

export type MailboxEmptyState =
  | { kind: 'search'; title: string; description: string }
  | { kind: 'action'; title: string; description: string; actionLabel: string; actionHref: string };

const searchDescriptions: Record<MailboxFilter, string> = {
  all: 'Try another search, or clear it to see all drops again.',
  samples: 'Try another search, or clear it to see your sample drops again.',
  transit: 'Try another search, or clear it to see drops on their journeys again.',
  received: 'Try another search, or clear it to see your received drops again.',
  sent: 'Try another search, or clear it to see your sent drops again.',
  drafts: 'Try another search, or clear it to see your drafts again.',
};

const emptyStates: Record<MailboxFilter, Omit<Extract<MailboxEmptyState, { kind: 'action' }>, 'kind'>> = {
  all: {
    title: 'Your mailbox is ready for its first drop.',
    description: 'Send a note, photo, or GIF to get things rolling.',
    actionLabel: 'Make a drop',
    actionHref: '/compose?new=1',
  },
  samples: {
    title: 'No sample drops in this corner.',
    description: 'Send something of your own to start your collection.',
    actionLabel: 'Make a drop',
    actionHref: '/compose?new=1',
  },
  transit: {
    title: 'No drops are on the move.',
    description: 'Start a hand-to-hand relay and see where it goes.',
    actionLabel: 'Start a journey',
    actionHref: '/compose?new=1&mode=relay',
  },
  received: {
    title: 'No drops have landed yet.',
    description: 'Pick a handle so your people can find you and send something your way.',
    actionLabel: 'Set up your handle',
    actionHref: '/profile',
  },
  sent: {
    title: 'Nothing sent yet.',
    description: 'Send a note, photo, or GIF to someone.',
    actionLabel: 'Make a drop',
    actionHref: '/compose?new=1',
  },
  drafts: {
    title: 'No drafts on hold.',
    description: 'Start a drop now, then come back when you’re ready.',
    actionLabel: 'Start a drop',
    actionHref: '/compose?new=1',
  },
};

export function getMailboxEmptyState(filter: MailboxFilter, searchQuery: string): MailboxEmptyState {
  if (searchQuery.trim()) {
    return {
      kind: 'search',
      title: 'No drops match that search.',
      description: searchDescriptions[filter],
    };
  }

  return { kind: 'action', ...emptyStates[filter] };
}

export function getMailboxCounts(letters: MockLetter[]) {
  const realDrops = letters.filter((letter) => !letter.sample);
  return {
    total: realDrops.length,
    transit: realDrops.filter((letter) => letter.status === 'dispatched').length,
    received: realDrops.filter((letter) => letter.direction === 'received' && letter.status === 'delivered').length,
    sent: realDrops.filter((letter) => !letter.localDemo && letter.direction !== 'received' && letter.status !== 'draft' && letter.status !== 'sealed').length,
    drafts: realDrops.filter((letter) => letter.status === 'draft' || letter.status === 'sealed').length,
    samples: letters.filter((letter) => letter.sample).length,
  };
}

/** A real delivered recipient drop is eligible for a durable read receipt. */
export function isEligibleReceivedDrop(letter: MockLetter) {
  return letter.direction === 'received'
    && letter.status === 'delivered'
    && !letter.sample
    && !letter.localDemo;
}

/** Only an authoritative null means unread; undefined means the lookup was unavailable. */
export function isUnreadReceivedDrop(letter: MockLetter) {
  return isEligibleReceivedDrop(letter) && letter.recipientReadAt === null;
}

/** Return null until the durable read-state lookup has completed successfully. */
export function getUnreadReceivedCount(letters: MockLetter[], recipientReadStatesHydrated: boolean) {
  return recipientReadStatesHydrated
    ? letters.filter(isUnreadReceivedDrop).length
    : null;
}

export function filterMailboxLetters(letters: MockLetter[], filter: MailboxFilter, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  return letters.filter((letter) => {
    if (filter === 'samples' ? !letter.sample : letter.sample) return false;
    if (filter === 'transit' && letter.status !== 'dispatched') return false;
    if (filter === 'received' && (letter.direction !== 'received' || letter.status !== 'delivered')) return false;
    if (filter === 'sent' && (letter.localDemo || letter.direction === 'received' || letter.status === 'draft' || letter.status === 'sealed')) return false;
    if (filter === 'drafts' && letter.status !== 'draft' && letter.status !== 'sealed') return false;
    if (!query) return true;
    return [letter.subject, letter.recipient, letter.sender, letter.excerpt]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query));
  });
}
