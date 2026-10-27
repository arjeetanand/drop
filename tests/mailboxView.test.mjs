import assert from 'node:assert/strict';
import test from 'node:test';
import { mockLetters } from '../data/mockData.ts';
import { filterMailboxLetters, getMailboxCounts, getMailboxEmptyState, getUnreadReceivedCount, isEligibleReceivedDrop, isUnreadReceivedDrop, selectFeaturedInboxDrop } from '../lib/mailboxView.ts';

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

test('keeps unclaimed private notes in Sent without treating them as drafts or journeys', () => {
  const pending = [
    { id: 'claim-pending', subject: 'A private note', recipient: 'your invited friend', direction: 'sent', status: 'claim_pending', deliveryMode: 'instant' },
  ];

  assert.deepEqual(getMailboxCounts(pending), { total: 1, transit: 0, received: 0, sent: 1, drafts: 0, samples: 0 });
  assert.deepEqual(filterMailboxLetters(pending, 'sent', '').map((letter) => letter.id), ['claim-pending']);
  assert.deepEqual(filterMailboxLetters(pending, 'drafts', ''), []);
  assert.deepEqual(filterMailboxLetters(pending, 'transit', ''), []);
});

test('keeps recipient relays in Transit until they collect the drop', () => {
  const relays = [
    { id: 'relay-in-transit', subject: 'On the way', recipient: 'me', direction: 'received', status: 'dispatched', deliveryMode: 'relay' },
    { id: 'legacy-relay-in-transit', subject: 'Still traveling', recipient: 'me', direction: 'received', status: 'dispatched', deliveryMode: 'instant' },
    { id: 'relay-collected', subject: 'It arrived', recipient: 'me', direction: 'received', status: 'delivered', deliveryMode: 'relay' },
    { id: 'relay-sent', subject: 'Sent out', recipient: 'you', direction: 'sent', status: 'dispatched', deliveryMode: 'relay' },
  ];

  assert.deepEqual(getMailboxCounts(relays), { total: 4, transit: 3, received: 1, sent: 1, drafts: 0, samples: 0 });
  assert.deepEqual(filterMailboxLetters(relays, 'received', '').map((letter) => letter.id), ['relay-collected']);
  assert.deepEqual(filterMailboxLetters(relays, 'transit', '').map((letter) => letter.id), ['relay-in-transit', 'legacy-relay-in-transit', 'relay-sent']);
});

test('counts only authoritatively unread real received drops after read-state hydration', () => {
  const unread = { id: 'unread', direction: 'received', status: 'delivered', recipientReadAt: null };
  const read = { id: 'read', direction: 'received', status: 'delivered', recipientReadAt: '2026-10-25T10:00:00Z' };
  const unknown = { id: 'unknown', direction: 'received', status: 'delivered' };
  const excluded = [
    { id: 'sent', direction: 'sent', status: 'delivered', recipientReadAt: null },
    { id: 'sample', direction: 'received', status: 'delivered', sample: true, recipientReadAt: null },
    { id: 'demo', direction: 'received', status: 'delivered', localDemo: true, recipientReadAt: null },
    { id: 'claim', direction: 'received', status: 'claim_pending', recipientReadAt: null },
    { id: 'transit', direction: 'received', status: 'dispatched', deliveryMode: 'relay', recipientReadAt: null },
  ];

  assert.equal(isEligibleReceivedDrop(unread), true);
  assert.equal(isUnreadReceivedDrop(unread), true);
  assert.equal(isUnreadReceivedDrop(read), false);
  assert.equal(isUnreadReceivedDrop(unknown), false);
  assert.equal(getUnreadReceivedCount([unread, read, unknown, ...excluded], false), null);
  assert.equal(getUnreadReceivedCount([unread, read, unknown, ...excluded], true), 1);
});

test('promotes only a hydrated unread drop on Home while preserving live-arrival priority', () => {
  const read = { id: 'read', direction: 'received', status: 'delivered', recipientReadAt: '2026-10-25T10:00:00Z' };
  const unread = { id: 'unread', direction: 'received', status: 'delivered', recipientReadAt: null };
  const unknown = { id: 'unknown', direction: 'received', status: 'delivered' };
  const arrival = { id: 'live-arrival', direction: 'received', status: 'delivered', recipientReadAt: null };

  assert.deepEqual(selectFeaturedInboxDrop([read, unread], null, true), { letter: unread, reason: 'unread' });
  assert.deepEqual(selectFeaturedInboxDrop([read, unread], arrival, true), { letter: arrival, reason: 'arrival' });
  assert.deepEqual(selectFeaturedInboxDrop([read, unread], null, false), { letter: read, reason: 'inbox' });
  assert.deepEqual(selectFeaturedInboxDrop([read, unknown], null, true), { letter: read, reason: 'inbox' });

  const excluded = [
    { id: 'sample', direction: 'received', status: 'delivered', sample: true, recipientReadAt: null },
    { id: 'demo', direction: 'received', status: 'delivered', localDemo: true, recipientReadAt: null },
    { id: 'claim', direction: 'received', status: 'claim_pending', recipientReadAt: null },
    { id: 'relay', direction: 'received', status: 'dispatched', deliveryMode: 'relay', recipientReadAt: null },
    { id: 'sent', direction: 'sent', status: 'delivered', recipientReadAt: null },
  ];
  for (const letter of excluded) {
    assert.notEqual(selectFeaturedInboxDrop([letter], null, true).reason, 'unread', `${letter.id} must not receive the unread treatment`);
  }
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
