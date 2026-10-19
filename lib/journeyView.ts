import type { MockLetter } from '../data/mockData.ts';

function activityTime(letter: MockLetter) {
  const time = Date.parse(letter.activityAt || '');
  return Number.isFinite(time) ? time : 0;
}

export function getJourneyLetters(localLetters: MockLetter[], remoteLetters: MockLetter[] | null) {
  const letters = new Map(localLetters.map((letter) => [letter.id, letter]));
  remoteLetters?.forEach((letter) => letters.set(letter.id, letter));

  return Array.from(letters.values())
    .filter((letter) => !letter.sample
      && !letter.localDemo
      && letter.direction === 'sent'
      && (letter.status === 'dispatched' || letter.status === 'delivered')
      // Older relay rows inherited the instant default when delivery mode was added.
      && (letter.deliveryMode === 'relay' || letter.status === 'dispatched'))
    .sort((a, b) => activityTime(b) - activityTime(a));
}
