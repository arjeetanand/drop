import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBoundedJson, RequestBodyTooLargeError } from '../lib/readBoundedJson.ts';

test('reads bounded JSON without relying on Content-Length', async () => {
  const request = new Request('https://drop.test', { method: 'POST', body: JSON.stringify({ ok: true }) });
  assert.deepEqual(await readBoundedJson(request, 32), { ok: true });
});

test('rejects streamed JSON once it exceeds the byte limit', async () => {
  const request = new Request('https://drop.test', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(64) }) });
  await assert.rejects(readBoundedJson(request, 16), RequestBodyTooLargeError);
});
