import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register(new URL('./dropMediaFinalizeLoader.mjs', import.meta.url));

const userId = '11111111-1111-4111-8111-111111111111';
const stagedPath = userId + '/pending/draft-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let uploads = 0;

const authClient = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
};
const serviceClient = {
  storage: {
    from: () => ({
      download: async () => ({
        data: new Blob([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')]),
        error: null,
      }),
      upload: async () => { uploads += 1; return { error: null }; },
      remove: async () => ({ error: null }),
    }),
  },
  from: () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: new Error('temporary lookup failure') }),
  }),
};

globalThis.__dropFinalizeCreateCount = 0;
globalThis.__dropFinalizeSupabaseFactory = () => globalThis.__dropFinalizeCreateCount++ === 0 ? authClient : serviceClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'local-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-service-role';

const { POST } = await import('../app/api/drop-media/finalize/route.ts');

test('a failed existing-drop lookup returns a retryable response without creating a final object', async () => {
  uploads = 0;
  globalThis.__dropFinalizeCreateCount = 0;
  const request = new Request('http://localhost/api/drop-media/finalize', {
    method: 'POST',
    headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  });

  const response = await POST(request);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /confirm.*media state.*retry/i);
  assert.equal(uploads, 0);
});
