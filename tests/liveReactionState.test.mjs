import assert from 'node:assert/strict';
import test from 'node:test';
import { dropReactionTopic, subscribeToDropReactions } from '../lib/dropReactionRealtime.ts';
import { getInitialSenderReactionBaseline, getLiveReactionUpdate, getSenderReactionReadUpdate } from '../lib/liveReactionState.ts';

function letter(id, reaction, extra = {}) {
  return { id, direction: 'sent', sample: false, status: 'delivered', subject: id, reaction, ...extra };
}

test('incoming and signed-out routes skip awaiting the sender-only reaction baseline', async () => {
  for (const direction of ['received', 'signed-out']) {
    let readStarted = false;
    const baselineRead = {
      then() {
        readStarted = true;
      },
    };

    assert.equal(await getInitialSenderReactionBaseline(direction, baselineRead), null);
    assert.equal(readStarted, false);
  }
});

test('the first reaction read establishes a baseline without announcing old reactions', () => {
  const oldReaction = letter('old', '💜');
  const update = getLiveReactionUpdate([oldReaction], null);

  assert.deepEqual(update.reactions, []);
  assert.deepEqual([...update.reactionMap], [['old', '💜']]);
  assert.deepEqual([...update.matchedSignalIds], []);
});

test('a single-drop recovery read after failed mailbox hydration baselines old reactions and announces later changes', () => {
  const baseline = getSenderReactionReadUpdate(
    { available: true, reaction: '💜' }, 0, 0, null, true, 0,
  );
  assert.deepEqual(baseline, {
    outcome: 'available', reaction: '💜', announce: false,
    baselinePending: false, consumedSignalGeneration: 0,
  });

  const changed = getSenderReactionReadUpdate(
    { available: true, reaction: '🔥' }, 0, 0,
    baseline.reaction, baseline.baselinePending, baseline.consumedSignalGeneration,
  );
  assert.equal(changed.announce, true);
  assert.equal(changed.reaction, '🔥');
  assert.equal(changed.baselinePending, false);
});

test('a stale in-flight read cannot consume a reaction signal that arrived after the read began', () => {
  const stale = getSenderReactionReadUpdate(
    { available: true, reaction: '💜' }, 0, 1, '💜', false, 0,
  );
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.baselinePending, false);
  assert.equal(stale.consumedSignalGeneration, 0);

  const queued = getSenderReactionReadUpdate(
    { available: true, reaction: '🔥' }, 1, 1, '💜', stale.baselinePending, stale.consumedSignalGeneration,
  );
  assert.equal(queued.outcome, 'available');
  assert.equal(queued.announce, true);
  assert.equal(queued.consumedSignalGeneration, 1);
});

test('unavailable sender reads preserve a pending baseline, while a first signal can announce it', () => {
  const failed = getSenderReactionReadUpdate(
    { available: false, reaction: null }, 0, 0, null, true, 0,
  );
  assert.equal(failed.outcome, 'unavailable');
  assert.equal(failed.baselinePending, true);
  assert.equal(failed.consumedSignalGeneration, 0);

  const signaled = getSenderReactionReadUpdate(
    { available: true, reaction: '🫶' }, 1, 1, null,
    failed.baselinePending, failed.consumedSignalGeneration,
  );
  assert.equal(signaled.announce, true);
  assert.equal(signaled.baselinePending, false);
  assert.equal(signaled.consumedSignalGeneration, 1);
});

test('a reaction written during channel startup is announced by comparing reaction values', () => {
  const missedBroadcast = getSenderReactionReadUpdate(
    { available: true, reaction: '🫶' }, 0, 0, null, true, 0,
    { available: true, reaction: null },
  );
  const existingReaction = getSenderReactionReadUpdate(
    { available: true, reaction: '💜' }, 0, 0, '💜', true, 0,
    { available: true, reaction: '💜' },
  );

  assert.equal(missedBroadcast.announce, true);
  assert.equal(existingReaction.announce, false);
});

test('an unavailable startup baseline waits for a signal instead of announcing an old reaction', () => {
  const withoutSignal = getSenderReactionReadUpdate(
    { available: true, reaction: '💜' }, 0, 0, '💜', true, 0, null,
  );
  const withSignal = getSenderReactionReadUpdate(
    { available: true, reaction: '🫶' }, 1, 1, '💜', true, 0, null,
  );

  assert.equal(withoutSignal.announce, false);
  assert.equal(withSignal.announce, true);
});

test('an available empty reaction clears the baseline without announcing', () => {
  const empty = getSenderReactionReadUpdate(
    { available: true, reaction: null }, 0, 0, null, true, 0,
  );
  assert.equal(empty.outcome, 'available');
  assert.equal(empty.announce, false);
  assert.equal(empty.baselinePending, false);
});

test('a matching signal surfaces a reaction even on the first read', () => {
  const signaled = letter('signaled', '🫶');
  const unrelated = letter('old', '💜');
  const update = getLiveReactionUpdate([signaled, unrelated], null, new Set(['signaled', 'not-loaded']));

  assert.deepEqual(update.reactions, [signaled]);
  assert.deepEqual([...update.matchedSignalIds], ['signaled']);
  assert.deepEqual([...update.reactionMap], [['signaled', '🫶'], ['old', '💜']]);
});

test('a reaction changed during the initial subscription window is not absorbed into the baseline', () => {
  const windowStart = Date.parse('2026-10-23T04:00:00.000Z');
  const recent = letter('recent', '🫶', { reactionUpdatedAt: '2026-10-23T04:00:01.000Z' });
  const old = letter('old', '💜', { reactionUpdatedAt: '2026-10-23T03:58:00.000Z' });
  const update = getLiveReactionUpdate([recent, old], null, new Set(), windowStart);

  assert.deepEqual(update.reactions, [recent]);
  assert.deepEqual([...update.reactionMap], [['recent', '🫶'], ['old', '💜']]);
});

test('later reads surface only new or changed sender reactions', () => {
  const unchanged = letter('unchanged', '💜');
  const changed = letter('changed', '🔥');
  const added = letter('added', '😂');
  const incoming = letter('incoming', '🫶', { direction: 'received' });
  const sample = letter('sample', '🥹', { sample: true });
  const update = getLiveReactionUpdate(
    [unchanged, changed, added, incoming, sample],
    new Map([['unchanged', '💜'], ['changed', '💜']]),
  );

  assert.deepEqual(update.reactions, [changed, added]);
  assert.deepEqual([...update.reactionMap], [['unchanged', '💜'], ['changed', '🔥'], ['added', '😂']]);
});

test('new reaction cues select the most recently updated drop', () => {
  const earlier = letter('earlier', '💜', { reactionUpdatedAt: '2026-10-23T04:00:00.000Z' });
  const latest = letter('latest', '🔥', { reactionUpdatedAt: '2026-10-23T04:03:00.000Z' });
  const update = getLiveReactionUpdate([latest, earlier], new Map());

  assert.deepEqual(update.reactions, [latest, earlier]);
});

test('reaction subscription authenticates a private sender topic, recovers on reconnect, and cleans up', async () => {
  let onSignal;
  let onStatus;
  let subscribedTopic;
  let subscribedOptions;
  let authReady = false;
  let removed = 0;
  const ids = [];
  const channel = {
    on(type, filter, callback) {
      assert.equal(type, 'broadcast');
      assert.deepEqual(filter, { event: 'drop_reaction_received' });
      onSignal = callback;
      return this;
    },
    subscribe(callback) { onStatus = callback; return this; },
  };
  const client = {
    realtime: { async setAuth() { authReady = true; } },
    channel(topic, options) {
      assert.equal(authReady, true);
      subscribedTopic = topic;
      subscribedOptions = options;
      return channel;
    },
    async removeChannel(target) {
      assert.equal(target, channel);
      removed += 1;
      return 'ok';
    },
  };

  assert.equal(dropReactionTopic('sender-1'), 'user:sender-1:drop-reactions');
  let subscriptionReady = false;
  const subscription = subscribeToDropReactions(client, 'sender-1', (dropId) => ids.push(dropId))
    .then((stop) => { subscriptionReady = true; return stop; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(subscribedTopic, 'user:sender-1:drop-reactions');
  assert.deepEqual(subscribedOptions, { config: { private: true } });
  assert.equal(subscriptionReady, false);

  onStatus('SUBSCRIBED');
  const stop = await subscription;
  assert.equal(subscriptionReady, true);
  onSignal({ payload: { drop_id: 'drop-1' } });
  onStatus('CHANNEL_ERROR');
  onStatus('SUBSCRIBED');
  onSignal({ payload: { emoji: '🔥', content: 'must not be forwarded' } });
  assert.deepEqual(ids, [undefined, 'drop-1', undefined, undefined]);

  stop();
  stop();
  onSignal({ payload: { drop_id: 'late-drop' } });
  onStatus('SUBSCRIBED');
  assert.deepEqual(ids, [undefined, 'drop-1', undefined, undefined]);
  assert.equal(removed, 1);
});
