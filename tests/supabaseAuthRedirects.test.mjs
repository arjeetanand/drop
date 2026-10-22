import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const authBlock = config.match(/^\[auth\]\r?\n([\s\S]*?)(?=^\[)/m)?.[1];
const redirectArray = authBlock?.match(/additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/)?.[1];
const redirectUrls = [...(redirectArray ?? '').matchAll(/"([^"]+)"/g)].map(([, url]) => url);

test('local Supabase allows Drop auth callbacks on the documented app ports', () => {
  assert.ok(authBlock, 'Supabase auth config should exist');
  assert.ok(redirectArray, 'Supabase auth redirect allow-list should exist');
  assert.match(authBlock, /^site_url = "http:\/\/localhost:4004"$/m);

  for (const port of [4004, 5004, 6004]) {
    for (const host of ['localhost', '127.0.0.1']) {
      assert.ok(
        redirectUrls.includes(`http://${host}:${port}/**`),
        `the ${host}:${port} local callback should be allowed`,
      );
    }
  }

  assert.ok(redirectUrls.includes('http://localhost:3000/auth/callback'));
  assert.ok(redirectUrls.includes('http://127.0.0.1:3000/auth/callback'));
  assert.ok(redirectUrls.every((value) => {
    const url = new URL(value.replace('/**', '/auth/callback'));
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  }), 'local redirect patterns should never allow an external host');
});
