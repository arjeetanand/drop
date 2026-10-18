import type { MockLetter } from '@/data/mockData';

export type MailboxFilter = 'all' | 'samples' | 'transit' | 'received' | 'sent' | 'drafts';

export function getMailboxCounts(letters: MockLetter[]) {
  const realDrops = letters.filter((letter) => !letter.sample);
  return {
    total: realDrops.length,
    transit: realDrops.filter((letter) => letter.status === 'dispatched').length,
    received: realDrops.filter((letter) => letter.direction === 'received').length,
    sent: realDrops.filter((letter) => !letter.localDemo && letter.direction !== 'received' && letter.status !== 'draft' && letter.status !== 'sealed').length,
    drafts: realDrops.filter((letter) => letter.status === 'draft' || letter.status === 'sealed').length,
    samples: letters.filter((letter) => letter.sample).length,
  };
}

export function filterMailboxLetters(letters: MockLetter[], filter: MailboxFilter, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  return letters.filter((letter) => {
    if (filter === 'samples' ? !letter.sample : letter.sample) return false;
    if (filter === 'transit' && letter.status !== 'dispatched') return false;
    if (filter === 'received' && letter.direction !== 'received') return false;
    if (filter === 'sent' && (letter.localDemo || letter.direction === 'received' || letter.status === 'draft' || letter.status === 'sealed')) return false;
    if (filter === 'drafts' && letter.status !== 'draft' && letter.status !== 'sealed') return false;
    if (!query) return true;
    return [letter.subject, letter.recipient, letter.sender, letter.excerpt]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query));
  });
}
