import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { getJourneyLetters } from '../lib/journeyView.ts';

register(new URL('./dropMediaFinalizeLoader.mjs', import.meta.url));

const { getRelayHandoffPresentation, getRelayRecipientCollection, mergeRelayRecipientCollectionState, relayToTrackingEvents } = await import('../lib/relayStore.ts');

function relay(id, activityAt, overrides = {}) {
  return {
    id,
    recipient: 'you',
    direction: 'sent',
    date: 'Oct 19, 2026',
    activityAt,
    status: 'dispatched',
    excerpt: '',
    subject: id,
    deliveryMode: 'relay',
    ...overrides,
  };
}

test('lists only real sent relays, merges remote copies, and sorts by activity time', () => {
  const local = [
    relay('same-id', '2026-10-15T00:00:00.000Z', { subject: 'local copy' }),
    relay('newest', '2026-10-18T00:00:00.000Z'),
    relay('delivered-relay', '2026-10-19T00:00:00.000Z', { status: 'delivered' }),
    relay('legacy-dispatched', '2026-10-17T00:00:00.000Z', { deliveryMode: 'instant' }),
    relay('missing-time', ''),
    relay('sample', '2026-10-19T00:00:00.000Z', { sample: true }),
    relay('local-demo', '2026-10-19T00:00:00.000Z', { localDemo: true }),
    relay('instant', '2026-10-19T00:00:00.000Z', { deliveryMode: 'instant', status: 'delivered' }),
    relay('draft', '2026-10-19T00:00:00.000Z', { status: 'draft' }),
    relay('sealed', '2026-10-19T00:00:00.000Z', { status: 'sealed' }),
    relay('received', '2026-10-19T00:00:00.000Z', { direction: 'received' }),
  ];
  const remote = [
    relay('same-id', '2026-10-16T00:00:00.000Z', { subject: 'remote copy' }),
    relay('older', '2026-10-14T00:00:00.000Z'),
  ];

  assert.deepEqual(getJourneyLetters(local, remote).map(({ id, subject }) => [id, subject]), [
    ['delivered-relay', 'delivered-relay'],
    ['newest', 'newest'],
    ['legacy-dispatched', 'legacy-dispatched'],
    ['same-id', 'remote copy'],
    ['older', 'older'],
    ['missing-time', 'missing-time'],
  ]);
});

test('keeps local sent relays when remote data is unavailable', () => {
  assert.deepEqual(getJourneyLetters([relay('local', '2026-10-19T00:00:00.000Z')], null).map((letter) => letter.id), ['local']);
});

test('projects collection only for a delivered relay and preserves its durable activity time', () => {
  const activityAt = '2026-10-23T08:42:00.000Z';

  assert.deepEqual(getRelayRecipientCollection({
    direction: 'sent',
    deliveryMode: 'relay',
    status: 'delivered',
    activityAt,
  }), {
    isCollected: true,
    collectedAt: activityAt,
  });
  assert.equal(getRelayRecipientCollection({ direction: 'sent', deliveryMode: 'relay', status: 'dispatched', activityAt }), undefined);
  assert.equal(getRelayRecipientCollection({ direction: 'sent', deliveryMode: 'instant', status: 'delivered', activityAt }), undefined);
  assert.equal(getRelayRecipientCollection({ deliveryMode: 'relay', status: 'delivered', activityAt }), undefined);
  assert.equal(getRelayRecipientCollection({ direction: 'received', deliveryMode: 'relay', status: 'delivered', activityAt }), undefined);
  assert.equal(getRelayRecipientCollection(undefined), undefined);
});

test('preserves last-known collection when a sender status refresh is unavailable', () => {
  const previous = {
    letterId: 'drop-1',
    collection: { isCollected: true, collectedAt: '2026-10-23T08:42:00.000Z' },
  };

  assert.deepEqual(mergeRelayRecipientCollectionState(previous, 'drop-1', null), previous);
  assert.equal(mergeRelayRecipientCollectionState(null, 'drop-1', null), null);
  assert.equal(mergeRelayRecipientCollectionState(previous, 'drop-2', null), null);
});

test('a collected recipient is complete in both the relay chain and custody timeline', () => {
  const relayState = {
    letterId: 'drop-1',
    subject: 'A tiny good thing',
    recipient: 'Mina',
    passcode: 'unused',
    startedAt: '2026-10-22T10:00:00.000Z',
    durationHours: 0,
    handoffs: [
      {
        id: 'origin-drop-1',
        name: 'You',
        role: 'sender',
        location: 'Your desk',
        note: 'The relay begins with you.',
        createdAt: '2026-10-22T10:00:00.000Z',
      },
      {
        id: 'recipient-drop-1',
        name: 'Mina',
        role: 'recipient',
        location: 'Mina',
        note: 'Waiting at the end of the route.',
        createdAt: '2026-10-22T10:00:00.000Z',
        next: true,
      },
    ],
  };

  assert.deepEqual(getRelayHandoffPresentation(relayState.handoffs[1]), {
    isNext: true,
    isCollected: false,
    isComplete: false,
    label: 'Next stop',
  });
  const dispatchedEvents = relayToTrackingEvents(relayState);
  assert.equal(dispatchedEvents[1].status, 'Waiting for Mina');
  assert.equal(dispatchedEvents[1].done, false);

  const collection = { isCollected: true, collectedAt: '2026-10-23T08:42:00.000Z' };
  assert.deepEqual(getRelayHandoffPresentation(relayState.handoffs[1], collection), {
    isNext: false,
    isCollected: true,
    isComplete: true,
    label: 'Collected',
  });
  const collectedEvents = relayToTrackingEvents(relayState, collection);
  assert.equal(collectedEvents[1].status, 'Drop collected');
  assert.equal(collectedEvents[1].note, 'Mina collected this drop.');
  assert.equal(collectedEvents[1].date, 'Oct 23');
  assert.equal(collectedEvents[1].done, true);
  assert.equal(collectedEvents[1].current, false);
  assert.deepEqual(relayToTrackingEvents(relayState, collection), collectedEvents);
  assert.equal(relayState.handoffs[1].next, true);
});
