import assert from 'node:assert/strict';
import test from 'node:test';
import { getDemoReactions, saveDemoReaction } from '../lib/demoReactionStore.ts';

function withLocalStorage(run, initial = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  });
  try {
    run(values);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
}

test('saves and reloads only allowed demo reactions for incoming drops', () => {
  withLocalStorage((values) => {
    assert.equal(saveDemoReaction('incoming-1', '🫶'), true);
    assert.deepEqual(getDemoReactions(), { 'incoming-1': '🫶' });
    assert.equal(saveDemoReaction('sent-1', '🔥'), false);
    assert.equal(saveDemoReaction('incoming-1', '💥'), false);
    assert.deepEqual(getDemoReactions(), { 'incoming-1': '🫶' });
    assert.ok([...values.values()][0].includes('incoming-1'));
  });
});

test('keeps local demo reactions private to this device and reloadable', () => {
  withLocalStorage((values) => {
    assert.equal(saveDemoReaction('3', '🫶', true), true);
    assert.deepEqual(getDemoReactions(), { '3': '🫶' });
    assert.equal(saveDemoReaction('3', '💥', true), false);
    assert.equal(saveDemoReaction('sent-1', '🔥'), false);
    assert.deepEqual(getDemoReactions(), { '3': '🫶' });
    assert.ok(values.get('dear-exe:demo-reactions:v1').includes('local-demo:3'));
  });
});

test('ignores invalid stored reaction data and reports storage failures', () => {
  withLocalStorage((values) => {
    values.set('dear-exe:demo-reactions:v1', JSON.stringify({ 'incoming-1': '💥', 'sent-1': '🔥' }));
    assert.deepEqual(getDemoReactions(), {});
  });

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => null, setItem: () => { throw new Error('storage full'); } } },
  });
  try {
    assert.equal(saveDemoReaction('incoming-1', '🔥'), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
});
