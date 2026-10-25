import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../tailwind.config.ts';

test('loads the Tailwind config as ESM with the animation plugin enabled', () => {
  assert.equal(Array.isArray(config.plugins), true);
  assert.equal(config.plugins.length, 1);
  assert.equal(typeof config.plugins[0].handler, 'function');
});
