import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createManageDropPushSubscriptionHandler } from '../supabase/functions/manage-drop-push-subscription/handler.ts';
import { createDropPushDispatcherHandler } from '../supabase/functions/dispatch-drop-push/handler.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const deliveryId = 7;
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const subscriptionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dispatchSecret = 'local-test-drop-push-dispatch-secret-32-bytes';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint-token';
const subscription = {
  endpoint,
  keys: {
    p256dh: 'A'.repeat(87),
    auth: 'B'.repeat(22),
  },
};
const delivery = {
  delivery_id: deliveryId,
  lease_token: leaseToken,
  attempts: 1,
  event_id: eventId,
  subscription_id: subscriptionId,
  endpoint,
  p256dh: subscription.keys.p256dh,
  auth_secret: subscription.keys.auth,
};

function makeRequest(body, headers = {}) {
  return new Request('https://drop.example.test/functions/v1/manage-drop-push-subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function assertManagerCors(response) {
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(response.headers.get('access-control-allow-methods')?.split(',').map((item) => item.trim()), ['POST', 'OPTIONS']);
  const allowedHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map((item) => item.trim());
  for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info', 'x-supabase-api-version']) {
    assert.ok(allowedHeaders?.includes(header), `CORS response must allow ${header}`);
  }
}

function managerHarness({ user = { id: userId }, authError = null, rpcData = true } = {}) {
  const calls = [];
  const deps = {
    getEnv: (name) => ({
      SUPABASE_URL: 'https://drop.example.test',
      SUPABASE_ANON_KEY: 'local-anon-key',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'local-service-role-key' }),
    })[name],
    createClient(url, key, options) {
      calls.push(['client', url, key, options]);
      if (key === 'local-anon-key') {
        return {
          auth: {
            async getUser(token) {
              calls.push(['getUser', token]);
              return { data: { user }, error: authError };
            },
          },
        };
      }
      return {
        async rpc(name, args) {
          calls.push(['rpc', name, args]);
          return { data: rpcData, error: null };
        },
      };
    },
  };
  return { calls, handler: createManageDropPushSubscriptionHandler(deps) };
}

function makeDispatchRequest(secret = dispatchSecret, options = {}) {
  return new Request('https://drop.example.test/functions/v1/dispatch-drop-push', {
    method: options.method || 'POST',
    headers: {
      ...(secret === null ? {} : { 'x-drop-push-dispatch-secret': secret }),
      ...(options.headers || {}),
    },
    body: options.body,
  });
}

function dispatcherHarness({
  rows = [delivery],
  sendNotification = async () => {},
  rpcError = null,
  env = {},
} = {}) {
  const calls = [];
  const sent = [];
  const dependencies = {
    getEnv: (name) => ({
      DROP_PUSH_DISPATCH_SECRET: dispatchSecret,
      DROP_PUSH_VAPID_PUBLIC_KEY: 'local-vapid-public-key',
      DROP_PUSH_VAPID_PRIVATE_KEY: 'local-vapid-private-key',
      DROP_PUSH_VAPID_SUBJECT: 'mailto:pilot@example.test',
      SUPABASE_URL: 'https://drop.example.test',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'local-service-role-key' }),
      ...env,
    })[name],
    createClient(url, key, options) {
      calls.push(['client', url, key, options]);
      return {
        async rpc(name, args) {
          calls.push(['rpc', name, args]);
          if (name === 'lease_drop_push_deliveries') return { data: rows, error: rpcError };
          if (name === 'finish_drop_push_delivery') return { data: true, error: null };
          throw new Error(`Unexpected RPC: ${name}`);
        },
      };
    },
    async sendNotification(pushSubscription, payload, options) {
      sent.push({ pushSubscription, payload, options });
      return sendNotification(pushSubscription, payload, options);
    },
  };
  return { calls, sent, handler: createDropPushDispatcherHandler(dependencies) };
}

test('requires a bearer token and verifies it before creating a service client', async () => {
  const { calls, handler } = managerHarness();
  const response = await handler(makeRequest({ action: 'status' }));

  assert.equal(response.status, 401);
  assertManagerCors(response);
  assert.deepEqual(calls, []);
});

test('answers CORS preflight without authentication or privileged client creation', async () => {
  const { calls, handler } = managerHarness();
  const response = await handler(new Request('https://drop.example.test/functions/v1/manage-drop-push-subscription', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:4004',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    },
  }));

  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assertManagerCors(response);
  assert.deepEqual(calls, []);
});

test('includes CORS headers on successful and error responses', async () => {
  const { handler } = managerHarness();
  const success = await handler(makeRequest({ action: 'status' }, {
    authorization: 'Bearer verified-user-token',
  }));
  const error = await handler(makeRequest({ action: 'status' }));

  assert.equal(success.status, 200);
  assert.equal(error.status, 401);
  assertManagerCors(success);
  assertManagerCors(error);
});

test('rejects an invalid verified-user lookup without using service credentials', async () => {
  const { calls, handler } = managerHarness({ authError: new Error('invalid JWT') });
  const response = await handler(makeRequest({ action: 'status' }, { authorization: 'Bearer bad-token' }));

  assert.equal(response.status, 401);
  assert.deepEqual(calls.map(([kind]) => kind), ['client', 'getUser']);
  assert.equal(calls.some(([kind, , key]) => kind === 'client' && key === 'local-service-role-key'), false);
});

test('status and enable use only the verified JWT user ID and expose only enabled', async () => {
  const { calls, handler } = managerHarness({ user: { id: userId }, rpcData: true });
  const response = await handler(makeRequest({ action: 'enable', subscription, user_id: '22222222-2222-4222-8222-222222222222' }, {
    authorization: 'Bearer verified-user-token',
  }));

  assert.equal(response.status, 400);
  assert.equal(calls.some(([kind]) => kind === 'rpc'), false);
});

test('registers a subscription only after verified auth and returns no subscription material', async () => {
  const { calls, handler } = managerHarness({ rpcData: true });
  const response = await handler(makeRequest({ action: 'enable', subscription }, {
    authorization: 'Bearer verified-user-token',
  }));

  assert.equal(response.status, 200);
  const responseText = await response.text();
  assert.deepEqual(JSON.parse(responseText), { enabled: true });
  const userClient = calls.find(([kind, , key]) => kind === 'client' && key === 'local-anon-key');
  assert.ok(userClient);
  assert.deepEqual(calls.find(([kind]) => kind === 'getUser'), ['getUser', 'verified-user-token']);
  const rpc = calls.find(([kind]) => kind === 'rpc');
  assert.deepEqual(rpc, ['rpc', 'manage_drop_push_subscription', {
    p_action: 'enable',
    p_user_id: userId,
    p_endpoint: endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth: subscription.keys.auth,
  }]);
  assert.equal(responseText.includes(endpoint), false);
  assert.equal(responseText.includes(subscription.keys.auth), false);
});

test('checks only this browser subscription when status includes its endpoint', async () => {
  const { calls, handler } = managerHarness({ rpcData: false });
  const response = await handler(makeRequest({ action: 'status', endpoint }, {
    authorization: 'Bearer verified-user-token',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false });
  assert.deepEqual(calls.find(([kind]) => kind === 'rpc'), ['rpc', 'manage_drop_push_subscription', {
    p_action: 'status',
    p_user_id: userId,
    p_endpoint: endpoint,
    p_p256dh: null,
    p_auth: null,
  }]);
});

test('rejects local, non-HTTPS, and unsupported push endpoints before service access', async (t) => {
  const badSubscriptions = [
    { ...subscription, endpoint: 'http://127.0.0.1:54321/functions/v1/admin' },
    { ...subscription, endpoint: 'https://example.com/push-token' },
    { ...subscription, endpoint: 'https://user@fcm.googleapis.com/fcm/send/token' },
  ];
  for (const badSubscription of badSubscriptions) {
    await t.test(badSubscription.endpoint, async () => {
      const { calls, handler } = managerHarness();
      const response = await handler(makeRequest({ action: 'enable', subscription: badSubscription }, {
        authorization: 'Bearer verified-user-token',
      }));
      assert.equal(response.status, 400);
      assert.equal(calls.some(([kind]) => kind === 'rpc'), false);
    });
  }
});

test('disables only the supplied endpoint and reports this device as disabled', async () => {
  const { calls, handler } = managerHarness({ rpcData: false });
  const response = await handler(makeRequest({ action: 'disable', endpoint }, {
    authorization: 'Bearer verified-user-token',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false });
  assert.deepEqual(calls.find(([kind]) => kind === 'rpc'), ['rpc', 'manage_drop_push_subscription', {
    p_action: 'disable',
    p_user_id: userId,
    p_endpoint: endpoint,
    p_p256dh: null,
    p_auth: null,
  }]);
});

test('rejects unsupported endpoint actions and malformed request shapes', async () => {
  const { handler } = managerHarness();
  const auth = { authorization: 'Bearer verified-user-token' };
  for (const body of [
    { action: 'remove' },
    { action: 'status', subscription },
    { action: 'enable' },
  ]) {
    const response = await handler(makeRequest(body, auth));
    assert.equal(response.status, 400);
  }
});

test('constant-time dispatcher guard rejects unauthorized requests before service access', async (t) => {
  const cases = [
    { name: 'wrong secret', secret: 'wrong' },
    { name: 'missing secret', secret: null },
    { name: 'short configured secret', secret: dispatchSecret, env: { DROP_PUSH_DISPATCH_SECRET: 'short' } },
    { name: 'wrong method', secret: dispatchSecret, method: 'GET' },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { calls, handler } = dispatcherHarness({ env: item.env });
      const response = await handler(makeDispatchRequest(item.secret, { method: item.method }));
      assert.notEqual(response.status, 200);
      assert.equal(calls.length, 0);
    });
  }
});

test('leases a bounded batch and sends only generic, content-free payloads', async () => {
  const { calls, sent, handler } = dispatcherHarness();
  const response = await handler(makeDispatchRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { leased: 1, sent: 1, retried: 0, removed: 0, failed: 0 });
  assert.deepEqual(calls.find(([kind]) => kind === 'rpc'), ['rpc', 'lease_drop_push_deliveries', { p_limit: 25 }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].pushSubscription, { endpoint, keys: subscription.keys });
  const pushBody = JSON.parse(sent[0].payload);
  assert.deepEqual(Object.keys(pushBody).sort(), ['tag', 'type']);
  assert.equal(pushBody.type, 'drop-arrived');
  assert.equal(pushBody.tag, `drop-arrival-${eventId}`);
  for (const privateValue of ['subject', 'content', 'sender', 'media', 'claim', 'token']) {
    assert.equal(sent[0].payload.toLowerCase().includes(privateValue), false);
  }
  const finish = calls.find(([, name]) => name === 'finish_drop_push_delivery');
  assert.deepEqual(finish[2], {
    p_delivery_id: deliveryId,
    p_lease_token: leaseToken,
    p_outcome: 'sent',
    p_retry_after_seconds: null,
    p_error_code: null,
  });
});

test('retries transient provider failures with a bounded delay and sanitized code', async () => {
  const { calls, handler } = dispatcherHarness({
    sendNotification: async () => {
      const error = new Error('provider returned private diagnostic text');
      error.statusCode = 429;
      error.headers = { 'retry-after': '90000' };
      throw error;
    },
  });
  const response = await handler(makeDispatchRequest());

  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.deepEqual(responseBody, { leased: 1, sent: 0, retried: 1, removed: 0, failed: 0 });
  const finish = calls.find(([, name]) => name === 'finish_drop_push_delivery');
  assert.equal(finish[2].p_outcome, 'retry');
  assert.equal(finish[2].p_retry_after_seconds <= 3600, true);
  assert.equal(finish[2].p_error_code, 'rate_limited');
  assert.equal(JSON.stringify(responseBody).includes('private diagnostic'), false);
});

test('removes subscriptions rejected as stale by the push provider', async () => {
  const { calls, handler } = dispatcherHarness({
    sendNotification: async () => {
      const error = new Error('stale endpoint details');
      error.statusCode = 410;
      throw error;
    },
  });
  const response = await handler(makeDispatchRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { leased: 1, sent: 0, retried: 0, removed: 1, failed: 0 });
  const finish = calls.find(([, name]) => name === 'finish_drop_push_delivery');
  assert.equal(finish[2].p_outcome, 'gone');
  assert.equal(finish[2].p_error_code, 'endpoint_gone');
});

test('does not send or mark success when the leased endpoint is malformed', async () => {
  const { calls, sent, handler } = dispatcherHarness({ rows: [{ ...delivery, endpoint: 'http://127.0.0.1/admin' }] });
  const response = await handler(makeDispatchRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { leased: 1, sent: 0, retried: 0, removed: 0, failed: 1 });
  assert.equal(sent.length, 0);
  const finish = calls.find(([, name]) => name === 'finish_drop_push_delivery');
  assert.equal(finish[2].p_outcome, 'failed');
  assert.equal(finish[2].p_error_code, 'invalid_subscription');
});

test('rejects an oversized lease result instead of processing an unbounded batch', async () => {
  const rows = Array.from({ length: 26 }, (_, index) => ({ ...delivery, delivery_id: index + 1 }));
  const { calls, sent, handler } = dispatcherHarness({ rows });
  const response = await handler(makeDispatchRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Push deliveries could not be leased.' });
  assert.equal(sent.length, 0);
  assert.equal(calls.filter(([, name]) => name === 'finish_drop_push_delivery').length, 0);
});

test('migration keeps delivered-event creation idempotent and leases rows with skip-locked semantics', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261026110000_drop_push_notifications.sql', import.meta.url), 'utf8');

  assert.match(migration, /unique\s*\(\s*letter_id\s*,\s*recipient_id\s*\)/i);
  assert.match(migration, /new\.status\s+is\s+distinct\s+from\s+'delivered'/i);
  assert.match(migration, /new\.recipient_id\s+is\s+not\s+distinct\s+from\s+new\.sender_id/i);
  assert.match(migration, /for\s+update\s+skip\s+locked/i);
  assert.match(migration, /make_interval\(secs\s*=>\s*least\(3600,\s*greatest\(/i);
  assert.doesNotMatch(migration, /pg_catalog\.(?:least|greatest)\s*\(/i);
  assert.match(migration, /lease_expires_at/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.lease_drop_push_deliveries\(integer\)\s+to\s+service_role/i);
  assert.match(migration, /revoke\s+all\s+on\s+table\s+private\.drop_push_outbox\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
});

test('endpoint transfer retires old-owner deliveries and leases only the current recipient', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261026120000_drop_push_recipient_scoped_delivery.sql', import.meta.url), 'utf8');
  const managerFunction = migration.split('create or replace function public.lease_drop_push_deliveries')[0];

  assert.match(managerFunction, /select\s+s\.id\s+into\s+v_subscription_id[\s\S]*?where\s+s\.endpoint\s*=\s*p_endpoint/i);
  assert.doesNotMatch(managerFunction, /for\s+update/i);
  assert.match(migration, /delete\s+from\s+private\.drop_push_deliveries[\s\S]*?o\.recipient_id\s+is\s+distinct\s+from\s+p_user_id[\s\S]*?d\.state\s+in\s*\(\s*'pending'\s*,\s*'leased'\s*\)/i);
  assert.match(migration, /update\s+private\.drop_push_deliveries\s+d\s+set\s+state\s*=\s*'dead'[\s\S]*?from\s+private\.drop_push_outbox\s+o\s*,\s*private\.drop_push_subscriptions\s+s[\s\S]*?o\.recipient_id\s+is\s+distinct\s+from\s+s\.user_id/i);
  assert.match(migration, /join\s+private\.drop_push_outbox\s+o\s+on\s+o\.id\s*=\s*d\.event_id[\s\S]*?join\s+private\.drop_push_subscriptions\s+s\s+on\s+s\.id\s*=\s*d\.subscription_id[\s\S]*?o\.recipient_id\s*=\s*s\.user_id/i);
});
