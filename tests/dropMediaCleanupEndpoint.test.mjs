import assert from 'node:assert/strict';
import test from 'node:test';
import { createCleanupWorkerHandler } from '../supabase/functions/cleanup-expired-drop-media/handler.ts';

const cleanupSecret = 'local-test-cleanup-secret-with-32-bytes';
const senderId = '11111111-1111-4111-8111-111111111111';
const leaseToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const objectId = '550e8400-e29b-41d4-a716-446655440000';
const cleanupJob = {
  job_id: 7,
  lease_token: leaseToken,
  letter_id: 'draft-1',
  sender_id: senderId,
  media_path: `${senderId}/draft-1/${objectId}`,
};

function environment(overrides = {}) {
  return {
    DROP_MEDIA_CLEANUP_SECRET: cleanupSecret,
    SUPABASE_URL: 'https://drop.example.test',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'local-service-role-key' }),
    ...overrides,
  };
}

function request({ method = 'POST', headers = {} } = {}) {
  return new Request('https://drop.example.test/functions/v1/cleanup-expired-drop-media', {
    method,
    headers,
  });
}

function unusedClientFactory() {
  let clientCalls = 0;
  let rpcCalls = 0;
  let storageCalls = 0;
  const createClient = () => {
    clientCalls += 1;
    return {
      async rpc() {
        rpcCalls += 1;
        throw new Error('RPC must not run for a rejected request.');
      },
      storage: {
        from() {
          storageCalls += 1;
          throw new Error('Storage must not be used for a rejected request.');
        },
      },
    };
  };
  return { createClient, getCalls: () => ({ clientCalls, rpcCalls, storageCalls }) };
}

test('rejects unauthorized, unconfigured, and oversized endpoint requests before creating a service client', async (t) => {
  const cases = [
    { name: 'non-POST method', env: environment(), request: request({ method: 'GET' }), status: 405 },
    { name: 'missing secret', env: environment({ DROP_MEDIA_CLEANUP_SECRET: undefined }), request: request(), status: 503 },
    { name: 'short secret', env: environment({ DROP_MEDIA_CLEANUP_SECRET: 'too-short' }), request: request(), status: 503 },
    { name: 'missing request secret', env: environment(), request: request(), status: 401 },
    { name: 'wrong request secret', env: environment(), request: request({ headers: { 'x-drop-cleanup-secret': 'wrong' } }), status: 401 },
    { name: 'missing project URL', env: environment({ SUPABASE_URL: undefined }), request: request({ headers: { 'x-drop-cleanup-secret': cleanupSecret } }), status: 503 },
    { name: 'missing service key', env: environment({ SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }), request: request({ headers: { 'x-drop-cleanup-secret': cleanupSecret } }), status: 503 },
    { name: 'malformed Content-Length', env: environment(), request: request({ headers: { 'x-drop-cleanup-secret': cleanupSecret, 'content-length': '1.5' } }), status: 413 },
    { name: 'oversized Content-Length', env: environment(), request: request({ headers: { 'x-drop-cleanup-secret': cleanupSecret, 'content-length': '1025' } }), status: 413 },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const fake = unusedClientFactory();
      const handler = createCleanupWorkerHandler({
        getEnv: (name) => item.env[name],
        createClient: fake.createClient,
      });

      const response = await handler(item.request);

      assert.equal(response.status, item.status);
      assert.deepEqual(fake.getCalls(), { clientCalls: 0, rpcCalls: 0, storageCalls: 0 });
    });
  }
});

test('authorized request reconciles, leases, removes, and finishes one cleanup job', async () => {
  const calls = [];
  const handler = createCleanupWorkerHandler({
    getEnv: (name) => environment()[name],
    createClient: (url, key, options) => {
      calls.push(['client', url, key, options]);
      return {
        async rpc(name, args) {
          calls.push(['rpc', name, args]);
          if (name === 'reconcile_orphan_drop_media_cleanup_jobs') return { data: 1, error: null };
          if (name === 'lease_expired_drop_media_cleanup_jobs') return { data: [cleanupJob], error: null };
          if (name === 'finish_expired_drop_media_cleanup_job') return { data: true, error: null };
          throw new Error(`Unexpected RPC: ${name}`);
        },
        storage: {
          from(bucketName) {
            calls.push(['bucket', bucketName]);
            return {
              async exists(path) {
                calls.push(['exists', path]);
                return { data: true, error: null };
              },
              async remove(paths) {
                calls.push(['remove', paths]);
                return { error: null };
              },
            };
          },
        },
      };
    },
  });

  const response = await handler(request({ headers: { 'x-drop-cleanup-secret': cleanupSecret } }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reconciled: 1, processed: 1, removed: 1, retried: 0 });
  assert.deepEqual(calls.map(([kind, name]) => kind === 'rpc' ? name : kind), [
    'client',
    'reconcile_orphan_drop_media_cleanup_jobs',
    'lease_expired_drop_media_cleanup_jobs',
    'bucket',
    'exists',
    'remove',
    'finish_expired_drop_media_cleanup_job',
  ]);
  assert.deepEqual(calls[0], ['client', 'https://drop.example.test', 'local-service-role-key', {
    auth: { autoRefreshToken: false, persistSession: false },
  }]);
  assert.deepEqual(calls[1][2], { p_limit: 25 });
  assert.deepEqual(calls[2][2], { p_limit: 25 });
  assert.equal(calls[3][1], 'drop-media');
  assert.deepEqual(calls[4], ['exists', cleanupJob.media_path]);
  assert.deepEqual(calls[5], ['remove', [cleanupJob.media_path]]);
  assert.deepEqual(calls[6][2], {
    p_job_id: cleanupJob.job_id,
    p_lease_token: cleanupJob.lease_token,
    p_removed: true,
    p_error_code: null,
  });
});

test('returns a retryable 503 when a leased job cannot be finalized', async () => {
  const calls = [];
  const handler = createCleanupWorkerHandler({
    getEnv: (name) => environment()[name],
    createClient: () => ({
      async rpc(name) {
        calls.push(name);
        if (name === 'reconcile_orphan_drop_media_cleanup_jobs') return { data: 0, error: null };
        if (name === 'lease_expired_drop_media_cleanup_jobs') return { data: [cleanupJob], error: null };
        if (name === 'finish_expired_drop_media_cleanup_job') return { data: null, error: new Error('database unavailable') };
        throw new Error(`Unexpected RPC: ${name}`);
      },
      storage: {
        from() {
          return {
            async exists() { return { data: true, error: null }; },
            async remove() { return { error: null }; },
          };
        },
      },
    }),
  });

  const response = await handler(request({ headers: { 'x-drop-cleanup-secret': cleanupSecret } }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    reconciled: 0,
    reconciliationFailed: false,
    processed: 1,
    removed: 0,
    retried: 0,
    finishFailures: 1,
  });
  assert.deepEqual(calls, [
    'reconcile_orphan_drop_media_cleanup_jobs',
    'lease_expired_drop_media_cleanup_jobs',
    'finish_expired_drop_media_cleanup_job',
  ]);
});
