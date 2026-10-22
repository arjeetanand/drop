import assert from 'node:assert/strict';
import test from 'node:test';
import { mockLetters } from '../data/mockData.ts';
import { filterMailboxLetters, getMailboxCounts, getMailboxEmptyState } from '../lib/mailboxView.ts';

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

test('shows search recovery without changing the active mailbox filter', () => {
  assert.deepEqual(getMailboxEmptyState('received', '  no match  '), {
    kind: 'search',
    title: 'No drops match that search.',
    description: 'Try another search, or clear it to see your received drops again.',
  });
});

test('treats whitespace-only search as an empty filter state', () => {
  assert.deepEqual(getMailboxEmptyState('received', '   '), {
    kind: 'action',
    title: 'No drops have landed yet.',
    description: 'Pick a handle so your people can find you and send something your way.',
    actionLabel: 'Set up your handle',
    actionHref: '/profile',
  });
});

test('gives the journey filter a relay-specific next step', () => {
  assert.deepEqual(getMailboxEmptyState('transit', ''), {
    kind: 'action',
    title: 'No drops are on the move.',
    description: 'Start a hand-to-hand relay and see where it goes.',
    actionLabel: 'Start a journey',
    actionHref: '/compose?new=1&mode=relay',
  });
});

test('keeps relevant create actions for the remaining mailbox filters', () => {
  const expectedStates = {
    all: {
      kind: 'action',
      title: 'Your mailbox is ready for its first drop.',
      description: 'Send a note, photo, or GIF to get things rolling.',
      actionLabel: 'Make a drop',
      actionHref: '/compose?new=1',
    },
    sent: {
      kind: 'action',
      title: 'Nothing sent yet.',
      description: 'Send a note, photo, or GIF to someone.',
      actionLabel: 'Make a drop',
      actionHref: '/compose?new=1',
    },
    drafts: {
      kind: 'action',
      title: 'No drafts on hold.',
      description: 'Start a drop now, then come back when you’re ready.',
      actionLabel: 'Start a drop',
      actionHref: '/compose?new=1',
    },
    samples: {
      kind: 'action',
      title: 'No sample drops in this corner.',
      description: 'Send something of your own to start your collection.',
      actionLabel: 'Make a drop',
      actionHref: '/compose?new=1',
    },
  };

  for (const [filter, expected] of Object.entries(expectedStates)) {
    assert.deepEqual(getMailboxEmptyState(filter, ''), expected);
  }
});

test('keeps no-result search copy specific to each mailbox filter', () => {
  const expectedDescriptions = {
    all: 'Try another search, or clear it to see all drops again.',
    samples: 'Try another search, or clear it to see your sample drops again.',
    transit: 'Try another search, or clear it to see drops on their journeys again.',
    received: 'Try another search, or clear it to see your received drops again.',
    sent: 'Try another search, or clear it to see your sent drops again.',
    drafts: 'Try another search, or clear it to see your drafts again.',
  };

  for (const [filter, description] of Object.entries(expectedDescriptions)) {
    assert.deepEqual(getMailboxEmptyState(filter, 'missing'), {
      kind: 'search',
      title: 'No drops match that search.',
      description,
    });
  }
});
