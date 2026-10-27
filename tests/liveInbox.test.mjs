import assert from 'node:assert/strict';
import test from 'node:test';
import { dropInboxTopic, subscribeToDropInbox } from '../lib/dropInboxRealtime.ts';
import { applyRecipientDropRead, applyRecipientDropReadEvents, getLiveInboxUpdate, mergeInboxLetters } from '../lib/liveInboxState.ts';
import { startVisibleDataRefresh } from '../lib/relayRouteRefresh.ts';

function letter(id, direction, extra = {}) {
  return { id, direction, sample: false, status: 'delivered', subject: id, ...extra };
}

test('first inbox sync establishes a baseline without announcing old drops', () => {
  const existing = letter('existing', 'received');
  const update = getLiveInboxUpdate([existing], null);

  assert.equal(update.arrival, null);
  assert.equal(update.newCount, 0);
  assert.deepEqual([...update.receivedIds], ['existing']);
});

test('a signaled drop in the first inbox result is not hidden by the initial baseline', () => {
  const newDrop = letter('new', 'received');
  const update = getLiveInboxUpdate([newDrop], null, new Set(['new']));

  assert.equal(update.arrival, newDrop);
  assert.equal(update.newCount, 1);
});

test('later sync summarizes unseen received drops and selects the newest', () => {
  const oldDrop = letter('old', 'received');
  const newPhoto = letter('photo', 'received', { payloadKind: 'image' });
  const newGif = letter('gif', 'received', { payloadKind: 'gif' });
  const sent = letter('sent', 'sent');
  const sample = letter('sample', 'received', { sample: true });
  const update = getLiveInboxUpdate(
    [newGif, newPhoto, sent, sample, oldDrop],
    new Set(['old']),
  );

  assert.equal(update.arrival, newGif);
  assert.equal(update.newCount, 2);
  assert.deepEqual([...update.receivedIds], ['gif', 'photo', 'old']);
});

test('only dispatched or delivered received drops can trigger an arrival', () => {
  const update = getLiveInboxUpdate([
    letter('sealed', 'received', { status: 'sealed' }),
    letter('draft', 'received', { status: 'draft' }),
    letter('delivered', 'received'),
  ], new Set());

  assert.equal(update.arrival.id, 'delivered');
  assert.equal(update.newCount, 1);
  assert.deepEqual([...update.receivedIds], ['delivered']);
});

test('mailbox merge keeps local drafts and lets remote rows replace matching samples', () => {
  const localDraft = letter('draft', 'sent');
  const localSample = letter('same-id', 'received', { sample: true });
  const remote = letter('same-id', 'received', { subject: 'Real drop', sample: false });
  const merged = mergeInboxLetters([localDraft, localSample], [remote]);

  assert.deepEqual(merged.map((item) => item.id), ['draft', 'same-id']);
  assert.equal(merged[1].subject, 'Real drop');
});

test('refreshes a local sent receipt without dropping remote mailbox rows', () => {
  const localReceipt = letter('local-sent', 'sent', { status: 'delivered' });
  const remoteReceived = letter('remote-received', 'received');
  const merged = mergeInboxLetters([localReceipt], [remoteReceived], [remoteReceived], [remoteReceived]);

  assert.deepEqual(new Set(merged.map(({ id }) => id)), new Set(['local-sent', 'remote-received']));
  assert.equal(merged.find(({ id }) => id === 'local-sent')?.status, 'delivered');
});

test('retains a known claimed badge when a later mailbox refresh cannot hydrate claim status', () => {
  const eligibility = { deliveryMode: 'instant', payloadKind: 'text' };
  const previouslyClaimed = letter('claimed', 'sent', { ...eligibility, claimedViaInvite: true });
  const refreshed = letter('claimed', 'sent', eligibility);
  const merged = mergeInboxLetters([], [refreshed], [previouslyClaimed]);

  assert.equal(merged[0].claimedViaInvite, true);
});

test('keeps durable read state across stale, null, or unavailable mailbox merges', () => {
  const readAt = '2026-10-25T10:00:00.000Z';
  const previouslyRead = letter('read', 'received', { recipientReadAt: readAt });
  const staleUnread = letter('read', 'received', { recipientReadAt: null });
  const unavailable = letter('read', 'received', { recipientReadAt: undefined });
  const mergedStale = mergeInboxLetters([], [staleUnread], [], [previouslyRead]);
  const mergedUnavailable = mergeInboxLetters([], [unavailable], [], [previouslyRead]);

  assert.equal(mergedStale[0].recipientReadAt, readAt);
  assert.equal(mergedUnavailable[0].recipientReadAt, readAt);
  assert.equal(mergeInboxLetters([], [unavailable], [], [letter('read', 'received', { recipientReadAt: null })])[0].recipientReadAt, null);
  assert.equal(mergeInboxLetters([], [letter('read', 'received', { recipientReadAt: '2026-10-25T11:00:00.000Z' })], [], [letter('read', 'received', { recipientReadAt: null })])[0].recipientReadAt, '2026-10-25T11:00:00.000Z');
});

test('applies a confirmed read event without replacing an existing timestamp', () => {
  const previousAt = '2026-10-25T10:00:00.000Z';
  const letters = [letter('drop', 'received', { recipientReadAt: null }), letter('other', 'received')];
  const detail = { accountId: 'recipient-1', letterId: 'drop', readAt: '2026-10-25T11:00:00.000Z' };
  const updated = applyRecipientDropRead(letters, detail);

  assert.equal(updated[0].recipientReadAt, '2026-10-25T11:00:00.000Z');
  assert.equal(updated[1].recipientReadAt, undefined);
  assert.equal(applyRecipientDropRead([letter('drop', 'received', { recipientReadAt: previousAt })], detail)[0].recipientReadAt, previousAt);
  const senderCopy = letter('drop', 'sent', { recipientReadAt: null });
  assert.equal(applyRecipientDropRead([senderCopy], detail)[0].recipientReadAt, null);
});

test('replays a confirmed read event when its mailbox row arrives later', () => {
  const detail = { accountId: 'recipient-1', letterId: 'drop', readAt: '2026-10-25T11:00:00.000Z' };
  const snapshot = [letter('drop', 'received', { recipientReadAt: null })];
  const replayed = applyRecipientDropReadEvents(snapshot, [detail]);

  assert.equal(replayed[0].recipientReadAt, detail.readAt);
  assert.equal(snapshot[0].recipientReadAt, null);
});

test('drop inbox subscription is private, user-scoped, signal-only, and removable', async () => {
  let onSignal;
  let onStatus;
  let subscribedTopic;
  let subscribedOptions;
  let removed = 0;
  let signals = 0;
  const signalIds = [];
  let authReady = false;
  const channel = {
    on(type, filter, callback) {
      assert.equal(type, 'broadcast');
      assert.deepEqual(filter, { event: 'drop_received' });
      onSignal = callback;
      return this;
    },
    subscribe(callback) {
      onStatus = callback;
      return this;
    },
  };
  const client = {
    realtime: { async setAuth() { authReady = true; } },
    channel(topic, options) {
      assert.equal(authReady, true);
      subscribedTopic = topic;
      subscribedOptions = options;
      return channel;
    },
    async removeChannel(removedChannel) {
      assert.equal(removedChannel, channel);
      removed += 1;
      return 'ok';
    },
  };

  assert.equal(dropInboxTopic('recipient-1'), 'user:recipient-1:drop-inbox');
  const stop = await subscribeToDropInbox(client, 'recipient-1', (dropId) => { signals += 1; signalIds.push(dropId); });
  assert.equal(subscribedTopic, 'user:recipient-1:drop-inbox');
  assert.deepEqual(subscribedOptions, { config: { private: true } });

  onStatus('SUBSCRIBED');
  onSignal({ payload: { drop_id: 'new-drop' } });
  assert.equal(signals, 2);
  assert.deepEqual(signalIds, [undefined, 'new-drop']);

  stop();
  stop();
  onSignal({ payload: { drop_id: 'late-drop' } });
  assert.equal(signals, 2);
  assert.equal(removed, 1);
});

test('a broadcast during an in-flight inbox read triggers one follow-up sync', async () => {
  let resolveFirstRead;
  let onBroadcast;
  let reads = 0;
  let seenIds = null;
  let arrival = null;
  const signaledIds = new Set();
  let resolveArrival;
  const arrivalApplied = new Promise((resolve) => { resolveArrival = resolve; });
  const pendingRead = new Promise((resolve) => { resolveFirstRead = resolve; });
  const channel = {
    on(type, filter, callback) { onBroadcast = callback; return this; },
    subscribe() { return this; },
  };
  const client = {
    realtime: { async setAuth() {} },
    channel() { return channel; },
    async removeChannel() { return 'ok'; },
  };
  const runtime = {
    isVisible: () => true,
    setInterval: () => 1,
    clearInterval() {},
    onVisibilityChange: () => () => {},
    onFocus: () => () => {},
  };
  const controller = startVisibleDataRefresh({
    runtime,
    queueOneWhileInFlight: true,
    load: () => {
      reads += 1;
      return reads === 1 ? pendingRead : Promise.resolve([letter('new', 'received')]);
    },
    onData: (remoteLetters) => {
      const update = getLiveInboxUpdate(remoteLetters, seenIds, signaledIds);
      seenIds = update.receivedIds;
      remoteLetters.forEach((remoteLetter) => signaledIds.delete(remoteLetter.id));
      if (update.arrival) {
        arrival = update.arrival;
        resolveArrival();
      }
    },
  });
  const initialRead = controller.refresh();
  const stop = await subscribeToDropInbox(client, 'recipient-1', (dropId) => {
    if (dropId) signaledIds.add(dropId);
    void controller.refresh();
  });

  onBroadcast({ payload: { drop_id: 'new' } });
  resolveFirstRead([]);
  await initialRead;
  await arrivalApplied;

  assert.equal(reads, 2);
  assert.equal(arrival.id, 'new');
  stop();
  controller.stop();
});

test('visible refresh supports a low-frequency recovery interval and cleans up', async () => {
  let refreshes = 0;
  let intervalCallback;
  let removed = false;
  const listeners = new Set();
  const runtime = {
    isVisible: () => true,
    setInterval(callback, delayMs) {
      assert.equal(delayMs, 60_000);
      intervalCallback = callback;
      return 1;
    },
    clearInterval() { removed = true; },
    onVisibilityChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onFocus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  const refresh = startVisibleDataRefresh({
    runtime,
    intervalMs: 60_000,
    load: async () => { refreshes += 1; return []; },
    onData: () => {},
  });
  await Promise.resolve();
  await Promise.resolve();
  intervalCallback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(refreshes, 2);

  refresh.stop();
  assert.equal(removed, true);
  assert.equal(listeners.size, 0);
});
