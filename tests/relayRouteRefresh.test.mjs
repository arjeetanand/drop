import assert from 'node:assert/strict';
import test from 'node:test';
import { RELAY_ROUTE_REFRESH_INTERVAL_MS, startRelayRouteRefresh } from '../lib/relayRouteRefresh.ts';

function fakeRuntime(initiallyVisible = true) {
  let visible = initiallyVisible;
  let nextIntervalId = 0;
  const intervals = [];
  const visibilityListeners = new Set();
  const focusListeners = new Set();

  const runtime = {
    isVisible: () => visible,
    setInterval(callback, delayMs) {
      const interval = { id: ++nextIntervalId, callback, delayMs, active: true };
      intervals.push(interval);
      return interval;
    },
    clearInterval(interval) {
      interval.active = false;
    },
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    onFocus(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
  };

  return {
    runtime,
    intervals,
    activeIntervals: () => intervals.filter((interval) => interval.active),
    tick() {
      for (const interval of intervals.filter((item) => item.active)) interval.callback();
    },
    tickInterval(interval) {
      interval?.callback();
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      for (const listener of [...visibilityListeners]) listener();
    },
    focus() {
      for (const listener of [...focusListeners]) listener();
    },
    listenerCount: () => visibilityListeners.size + focusListeners.size,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('refreshes immediately and installs one bounded visible interval', async () => {
  const rig = fakeRuntime();
  let reads = 0;
  const updates = [];
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: async () => [{ id: `handoff-${++reads}` }],
    onData: (data) => updates.push(data),
  });

  assert.equal(reads, 1);
  assert.equal(rig.activeIntervals().length, 1);
  assert.equal(rig.activeIntervals()[0].delayMs, RELAY_ROUTE_REFRESH_INTERVAL_MS);
  await flushPromises();
  assert.deepEqual(updates, [[{ id: 'handoff-1' }]]);

  controller.refresh();
  assert.equal(reads, 2);
  await flushPromises();

  rig.tick();
  assert.equal(reads, 3);
  await flushPromises();
  assert.deepEqual(updates.map((items) => items[0].id), ['handoff-1', 'handoff-2', 'handoff-3']);
  controller.stop();
});

test('pauses while hidden and refreshes when visible or focused', async () => {
  const rig = fakeRuntime(false);
  let reads = 0;
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: async () => { reads += 1; return []; },
    onData: () => {},
  });

  assert.equal(reads, 0);
  assert.equal(rig.activeIntervals().length, 0);
  rig.focus();
  assert.equal(reads, 0);

  rig.setVisible(true);
  assert.equal(reads, 1);
  assert.equal(rig.activeIntervals().length, 1);
  await flushPromises();
  rig.setVisible(false);
  assert.equal(rig.activeIntervals().length, 0);
  rig.tickInterval(rig.intervals[0]);
  assert.equal(reads, 1);

  rig.setVisible(true);
  assert.equal(reads, 2);
  await flushPromises();
  rig.focus();
  assert.equal(reads, 3);
  controller.stop();
});

test('coalesces interval and focus refreshes while a read is in flight', async () => {
  const rig = fakeRuntime();
  const pending = deferred();
  let reads = 0;
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: () => {
      reads += 1;
      return reads === 1 ? pending.promise : Promise.resolve([]);
    },
    onData: () => {},
  });

  controller.refresh();
  rig.tick();
  rig.focus();
  assert.equal(reads, 1);

  pending.resolve([]);
  await flushPromises();
  rig.tick();
  assert.equal(reads, 2);
  await flushPromises();
  controller.stop();
});

test('manual refreshes share the in-flight promise and resolve after data is applied', async () => {
  const rig = fakeRuntime();
  const pending = deferred();
  const updates = [];
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: () => pending.promise,
    onData: (data) => updates.push(data),
  });

  const initialRefresh = controller.refresh();
  assert.equal(controller.refresh(), initialRefresh);
  assert.deepEqual(updates, []);

  pending.resolve([{ id: 'handoff-1' }]);
  await initialRefresh;
  assert.deepEqual(updates, [[{ id: 'handoff-1' }]]);
  controller.stop();
});

test('cleanup removes listeners and suppresses pending and stale refresh callbacks', async () => {
  const rig = fakeRuntime();
  const pending = deferred();
  let reads = 0;
  const updates = [];
  const errors = [];
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: () => { reads += 1; return pending.promise; },
    onData: (data) => updates.push(data),
    onError: (error) => errors.push(error),
  });
  const staleInterval = rig.intervals[0];

  controller.stop();
  controller.stop();
  rig.tickInterval(staleInterval);
  pending.resolve([{ id: 'late' }]);
  await flushPromises();

  assert.equal(reads, 1);
  assert.equal(rig.activeIntervals().length, 0);
  assert.equal(rig.listenerCount(), 0);
  assert.deepEqual(updates, []);
  assert.deepEqual(errors, []);
});

test('reports read errors without replacing caller state and resumes on later success', async () => {
  const rig = fakeRuntime();
  const failure = new Error('temporary relay read failure');
  const results = [
    Promise.resolve([{ id: 'known' }]),
    Promise.reject(failure),
    Promise.resolve([{ id: 'new' }]),
  ];
  let state = [{ id: 'initial' }];
  const errors = [];
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: () => results.shift(),
    onData: (data) => { state = data; },
    onError: (error) => errors.push(error),
  });

  await flushPromises();
  assert.deepEqual(state, [{ id: 'known' }]);
  rig.tick();
  await flushPromises();
  assert.deepEqual(state, [{ id: 'known' }]);
  assert.deepEqual(errors, [failure]);

  rig.tick();
  await flushPromises();
  assert.deepEqual(state, [{ id: 'new' }]);
  controller.stop();
});

test('treats an unavailable read as no update and keeps caller state intact', async () => {
  const rig = fakeRuntime();
  const errors = [];
  let state = [{ id: 'known' }];
  const controller = startRelayRouteRefresh({
    runtime: rig.runtime,
    load: async () => null,
    onData: (data) => { state = data; },
    onError: (error) => errors.push(error),
  });

  await flushPromises();
  assert.deepEqual(state, [{ id: 'known' }]);
  assert.deepEqual(errors, []);
  controller.stop();
});
