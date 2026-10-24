import assert from 'node:assert/strict';
import test from 'node:test';
import { withFallbackTimeout } from '../lib/withFallbackTimeout.ts';

test('returns an available result before the timeout', async () => {
  const result = await withFallbackTimeout(Promise.resolve('ready'), 50, 'fallback');
  assert.equal(result, 'ready');
});

test('returns the fallback when a request stays pending', async () => {
  const result = await withFallbackTimeout(new Promise(() => {}), 5, 'unavailable');
  assert.equal(result, 'unavailable');
});

test('preserves request errors for the caller to handle', async () => {
  await assert.rejects(
    withFallbackTimeout(Promise.reject(new Error('request failed')), 50, 'fallback'),
    /request failed/,
  );
});
