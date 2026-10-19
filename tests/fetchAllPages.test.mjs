import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllPages } from '../lib/fetchAllPages.ts';

test('reads every full page and stops after the final partial page', async () => {
  const ranges = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    if (from === 0) return Array.from({ length: 1000 }, (_, index) => index);
    return [1000];
  });

  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1), 1000);
});

test('stops and reports unavailable data after a page read fails', async () => {
  const ranges = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return from === 0 ? Array.from({ length: 1000 }, (_, index) => index) : null;
  });

  assert.equal(rows, null);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});
