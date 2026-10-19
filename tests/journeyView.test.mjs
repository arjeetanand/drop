import assert from 'node:assert/strict';
import test from 'node:test';
import { getJourneyLetters } from '../lib/journeyView.ts';

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
