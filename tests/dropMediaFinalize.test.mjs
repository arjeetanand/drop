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

test('a retry after losing the finalize response reuses its stable final object with a fresh attempt path', async () => {
  const mediaBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const retryStagedPath = `${userId}/pending/draft-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  const stagedObjects = new Map([[stagedPath, mediaBytes]]);
  const finalObjects = new Map();
  let finalObjectsWritten = 0;
  const retryServiceClient = {
    storage: {
      from: () => ({
        download: async (path) => {
          const bytes = stagedObjects.get(path) ?? finalObjects.get(path);
          return bytes
            ? { data: new Blob([bytes]), error: null }
            : { data: null, error: new Error('Object not found') };
        },
        upload: async (path, blob) => {
          if (finalObjects.has(path)) return { error: new Error('Object already exists') };
          finalObjects.set(path, Buffer.from(await blob.arrayBuffer()));
          finalObjectsWritten += 1;
          return { error: null };
        },
        remove: async (paths) => {
          for (const path of paths) stagedObjects.delete(path);
          return { error: null };
        },
      }),
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: null, error: null }),
    }),
  };
  globalThis.__dropFinalizeSupabaseFactory = (_url, key) => key === 'local-anon' ? authClient : retryServiceClient;

  const finalize = (path) => POST(new Request('http://localhost/api/drop-media/finalize', {
    method: 'POST',
    headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
    body: JSON.stringify({ stagedPath: path, payloadKind: 'gif' }),
  }));

  await finalize(stagedPath); // The client loses this response before linking the letter row.
  // A retry uses a fresh staging key but retains the draft's final-media ID.
  stagedObjects.set(retryStagedPath, mediaBytes);
  const retryResponse = await finalize(retryStagedPath);
  const result = await retryResponse.json();

  assert.equal(retryResponse.status, 200);
  assert.equal(result.mediaPath, `${userId}/draft-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
  assert.equal(finalObjectsWritten, 1);
  assert.equal(finalObjects.size, 1);
});

test('a linked drop retry returns its saved final path even when the attempt path differs', async () => {
  const mediaBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const retryStagedPath = `${userId}/pending/draft-1/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  const savedFinalPath = `${userId}/draft-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const removedPaths = [];
  const linkedDropServiceClient = {
    storage: {
      from: () => ({
        download: async (path) => path === retryStagedPath || path === savedFinalPath
          ? { data: new Blob([mediaBytes]), error: null }
          : { data: null, error: new Error('Object not found') },
        upload: async () => { throw new Error('An already-linked media path must not be rewritten'); },
        remove: async (paths) => { removedPaths.push(...paths); return { error: null }; },
      }),
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({
        data: { media_path: savedFinalPath, media_mime_type: 'image/gif', media_size_bytes: mediaBytes.length },
        error: null,
      }),
    }),
  };
  globalThis.__dropFinalizeSupabaseFactory = (_url, key) => key === 'local-anon' ? authClient : linkedDropServiceClient;

  const response = await POST(new Request('http://localhost/api/drop-media/finalize', {
    method: 'POST',
    headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
    body: JSON.stringify({ stagedPath: retryStagedPath, payloadKind: 'gif' }),
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).mediaPath, savedFinalPath);
  assert.deepEqual(removedPaths, [retryStagedPath]);
});

test('a linked drop conflict removes the newly staged attachment', async () => {
  const mediaBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const mismatchedBytes = Buffer.from(mediaBytes);
  mismatchedBytes[0] ^= 1;
  const finalPath = `${userId}/draft-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const stagedObjects = new Map([[stagedPath, mediaBytes]]);
  const removedPaths = [];
  const linkedDropServiceClient = {
    storage: {
      from: () => ({
        download: async (path) => {
          const bytes = path === stagedPath ? stagedObjects.get(path) : mismatchedBytes;
          return { data: new Blob([bytes]), error: null };
        },
        upload: async () => { throw new Error('A linked drop must not be overwritten'); },
        remove: async (paths) => {
          removedPaths.push(...paths);
          for (const path of paths) stagedObjects.delete(path);
          return { error: null };
        },
      }),
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({
        data: { media_path: finalPath, media_mime_type: 'image/gif', media_size_bytes: mediaBytes.length },
        error: null,
      }),
    }),
  };
  globalThis.__dropFinalizeSupabaseFactory = (_url, key) => key === 'local-anon' ? authClient : linkedDropServiceClient;

  const response = await POST(new Request('http://localhost/api/drop-media/finalize', {
    method: 'POST',
    headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(removedPaths, [stagedPath]);
  assert.equal(stagedObjects.has(stagedPath), false);
});
