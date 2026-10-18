import assert from 'node:assert/strict';
import test from 'node:test';
import { mockLetters } from '../data/mockData.ts';
import { filterMailboxLetters, getMailboxCounts } from '../lib/mailboxView.ts';

const drops = [
  { id: 'real-in', subject: 'A note', recipient: 'me', direction: 'received', status: 'delivered' },
  { id: 'real-out', subject: 'A send', recipient: 'you', direction: 'sent', status: 'delivered' },
  { id: 'real-draft', subject: 'In progress', recipient: 'you', direction: 'sent', status: 'draft' },
  { id: 'sample-in', subject: 'Example', recipient: 'me', direction: 'received', status: 'delivered', sample: true },
];

test('keeps legacy seeded letters out of real mailbox totals on first use', () => {
  assert.deepEqual(getMailboxCounts(mockLetters), { total: 1, transit: 0, received: 0, sent: 0, drafts: 1, samples: 6 });
  assert.deepEqual(filterMailboxLetters(mockLetters, 'all', '').map((letter) => letter.id), ['3']);
  assert.deepEqual(filterMailboxLetters(mockLetters, 'samples', '').map((letter) => letter.id), ['incoming-1', 'incoming-gif', '1', '2', '4', '5']);
});

test('keeps sample drops out of mailbox totals and received filters while preserving an opt-in sample list', () => {
  assert.deepEqual(getMailboxCounts(drops), { total: 3, transit: 0, received: 1, sent: 1, drafts: 1, samples: 1 });
  assert.deepEqual(filterMailboxLetters(drops, 'all', '').map((letter) => letter.id), ['real-in', 'real-out', 'real-draft']);
  assert.deepEqual(filterMailboxLetters(drops, 'received', '').map((letter) => letter.id), ['real-in']);
  assert.deepEqual(filterMailboxLetters(drops, 'samples', '').map((letter) => letter.id), ['sample-in']);
  assert.deepEqual(filterMailboxLetters(drops, 'samples', 'Example').map((letter) => letter.id), ['sample-in']);
});
