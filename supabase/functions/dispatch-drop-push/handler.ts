type PushDelivery = {
  delivery_id: number;
  lease_token: string;
  attempts: number;
  event_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

type SupabaseClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

type ClientOptions = {
  auth: { autoRefreshToken: false; persistSession: false };
};

type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type WebPushOptions = {
  vapidDetails: { subject: string; publicKey: string; privateKey: string };
  TTL: number;
  urgency: 'normal';
  timeout: number;
};

type PushError = {
  statusCode?: unknown;
  status?: unknown;
  headers?: unknown;
};

export type DropPushDispatcherDependencies = {
  getEnv(name: string): string | undefined;
  createClient(url: string, key: string, options: ClientOptions): SupabaseClient;
  sendNotification(
    subscription: WebPushSubscription,
    payload: string,
    options: WebPushOptions,
  ): Promise<unknown>;
};

const MAX_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const MAX_BODY_BYTES = 1_024;
const LEASE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function serviceKey(getEnv: DropPushDispatcherDependencies['getEnv']) {
  const secretKeys = getEnv('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      if (typeof parsed.default === 'string' && parsed.default.length > 0) return parsed.default;
    } catch {
      // Fall back to the legacy service-role key below.
    }
  }
  return getEnv('SUPABASE_SERVICE_ROLE_KEY') || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function constantTimeSecretMatch(actual: string | null, expected: string) {
  if (!actual || actual.length > 1_024) return false;
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function bodyWithinLimit(request: Request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return false;
  }
  if (!request.body) return true;

  const reader = request.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return false;
      }
    }
  } catch {
    return false;
  }
}

function isUuid(value: unknown) {
  return typeof value === 'string' && LEASE_TOKEN.test(value);
}

function isAllowedEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && ALLOWED_PUSH_HOSTS.has(url.hostname.toLowerCase())
      && url.pathname.length > 1
      && !/[\r\n\s]/.test(value);
  } catch {
    return false;
  }
}

function validPushKey(value: unknown, minLength: number, maxLength: number) {
  return typeof value === 'string'
    && value.length >= minLength
    && value.length <= maxLength
    && BASE64URL.test(value);
}

function hasLeaseIdentity(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.delivery_id)
    && Number(value.delivery_id) > 0
    && isUuid(value.lease_token);
}

function isValidDelivery(value: unknown): value is PushDelivery {
  if (!hasLeaseIdentity(value) || !isRecord(value)) return false;
  return Number.isSafeInteger(value.attempts)
    && Number(value.attempts) >= 1
    && Number(value.attempts) <= MAX_ATTEMPTS
    && isUuid(value.event_id)
    && isUuid(value.subscription_id)
    && isAllowedEndpoint(value.endpoint)
    && validPushKey(value.p256dh, 40, 128)
    && validPushKey(value.auth_secret, 16, 128);
}

function genericPayload(eventId: string) {
  return JSON.stringify({
    type: 'drop-arrived',
    tag: `drop-arrival-${eventId}`,
  });
}

function statusCode(error: unknown) {
  if (!isRecord(error)) return null;
  const value = error.statusCode ?? error.status;
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

function retryAfterHeader(error: unknown) {
  if (!isRecord(error)) return null;
  const headers = error.headers;
  let value: unknown = null;
  if (headers && typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function') {
    value = headers.get('retry-after');
  } else if (isRecord(headers)) {
    value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_600, Math.max(1, Math.ceil(seconds)));
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(3_600, Math.max(1, Math.ceil((dateMs - Date.now()) / 1_000)));
}

function retryDelay(attempt: number, error: unknown) {
  const providerDelay = retryAfterHeader(error);
  if (providerDelay !== null) return providerDelay;
  return Math.min(3_600, 30 * (2 ** Math.min(Math.max(attempt - 1, 0), 7)));
}

function errorKind(providerStatus: number | null) {
  if (providerStatus === 429) return 'rate_limited';
  if (providerStatus === 408 || (providerStatus !== null && providerStatus >= 500)) return 'provider_unavailable';
  if (providerStatus === null) return 'network_error';
  if (providerStatus === 404 || providerStatus === 410) return 'endpoint_gone';
  if (providerStatus >= 400) return 'provider_rejected';
  return 'provider_error';
}

function pushError(error: unknown, attempts: number) {
  const code = statusCode(error);
  if (code === 404 || code === 410) return { outcome: 'gone', retryAfterSeconds: null, errorCode: 'endpoint_gone' } as const;
  if (code === 429 || code === 408 || code === null || code >= 500) {
    return {
      outcome: 'retry',
      retryAfterSeconds: retryDelay(attempts, error),
      errorCode: errorKind(code),
    } as const;
  }
  return { outcome: 'failed', retryAfterSeconds: null, errorCode: errorKind(code) } as const;
}

function validVapidSubject(value: string) {
  if (value.startsWith('mailto:')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.slice('mailto:'.length));
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function finish(
  client: SupabaseClient,
  job: Record<string, unknown>,
  outcome: 'sent' | 'retry' | 'gone' | 'failed',
  retryAfterSeconds: number | null,
  errorCode: string | null,
) {
  const result = await client.rpc('finish_drop_push_delivery', {
    p_delivery_id: job.delivery_id,
    p_lease_token: job.lease_token,
    p_outcome: outcome,
    p_retry_after_seconds: retryAfterSeconds,
    p_error_code: errorCode,
  });
  return !result.error && result.data === true;
}

async function deliverOne(
  client: SupabaseClient,
  candidate: unknown,
  dependencies: DropPushDispatcherDependencies,
  vapid: { subject: string; publicKey: string; privateKey: string },
) {
  if (!hasLeaseIdentity(candidate)) return { sent: 0, retried: 0, removed: 0, failed: 1, finishFailure: true };
  const job = candidate;
  if (!isValidDelivery(job)) {
    try {
      const finished = await finish(client, job, 'failed', null, 'invalid_subscription');
      return { sent: 0, retried: 0, removed: 0, failed: 1, finishFailure: !finished };
    } catch {
      return { sent: 0, retried: 0, removed: 0, failed: 1, finishFailure: true };
    }
  }

  let action: ReturnType<typeof pushError> | { outcome: 'sent'; retryAfterSeconds: null; errorCode: null };
  try {
    const result = await dependencies.sendNotification(
      { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_secret } },
      genericPayload(job.event_id),
      { vapidDetails: vapid, TTL: 86_400, urgency: 'normal', timeout: 10_000 },
    );
    const deliveredStatus = statusCode(result);
    if (deliveredStatus !== null && (deliveredStatus < 200 || deliveredStatus >= 300)) {
      throw Object.assign(new Error('Push provider rejected the message.'), { statusCode: deliveredStatus, headers: isRecord(result) ? result.headers : undefined });
    }
    action = { outcome: 'sent', retryAfterSeconds: null, errorCode: null };
  } catch (error) {
    action = pushError(error, job.attempts);
  }

  try {
    const finished = await finish(client, job, action.outcome, action.retryAfterSeconds, action.errorCode);
    return {
      sent: action.outcome === 'sent' && finished ? 1 : 0,
      retried: action.outcome === 'retry' ? 1 : 0,
      removed: action.outcome === 'gone' ? 1 : 0,
      failed: action.outcome === 'failed' ? 1 : 0,
      finishFailure: !finished,
    };
  } catch {
    return {
      sent: 0,
      retried: action.outcome === 'retry' ? 1 : 0,
      removed: action.outcome === 'gone' ? 1 : 0,
      failed: action.outcome === 'failed' ? 1 : 0,
      finishFailure: true,
    };
  }
}

async function runBounded(items: unknown[], worker: (item: unknown) => Promise<Awaited<ReturnType<typeof deliverOne>>>, concurrency: number) {
  const results: Awaited<ReturnType<typeof deliverOne>>[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(worker)));
  }
  return results;
}

export function createDropPushDispatcherHandler(dependencies: DropPushDispatcherDependencies) {
  return async (request: Request) => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const configuredSecret = dependencies.getEnv('DROP_PUSH_DISPATCH_SECRET');
    if (!configuredSecret || configuredSecret.length < 32 || configuredSecret.length > 1_024) {
      return json(503, { error: 'Push dispatcher is not configured.' });
    }
    if (!await constantTimeSecretMatch(request.headers.get('x-drop-push-dispatch-secret'), configuredSecret)) {
      return json(401, { error: 'Unauthorized.' });
    }
    if (!await bodyWithinLimit(request)) return json(413, { error: 'Request too large.' });

    const url = dependencies.getEnv('SUPABASE_URL');
    const key = serviceKey(dependencies.getEnv);
    const publicKey = dependencies.getEnv('DROP_PUSH_VAPID_PUBLIC_KEY');
    const privateKey = dependencies.getEnv('DROP_PUSH_VAPID_PRIVATE_KEY');
    const subject = dependencies.getEnv('DROP_PUSH_VAPID_SUBJECT');
    if (!url || !key || !publicKey || !privateKey || !subject || !validVapidSubject(subject)) {
      return json(503, { error: 'Push dispatcher is not configured.' });
    }

    let client: SupabaseClient;
    let result: { data: unknown; error: unknown };
    try {
      client = dependencies.createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      result = await client.rpc('lease_drop_push_deliveries', { p_limit: MAX_BATCH_SIZE });
    } catch {
      return json(503, { error: 'Push deliveries could not be leased.' });
    }
    if (result.error || !Array.isArray(result.data) || result.data.length > MAX_BATCH_SIZE) {
      return json(503, { error: 'Push deliveries could not be leased.' });
    }

    const rows = await runBounded(result.data, (row) => deliverOne(
      client,
      row,
      dependencies,
      { subject, publicKey, privateKey },
    ), 5);
    const counts = rows.reduce((total, row) => ({
      sent: total.sent + row.sent,
      retried: total.retried + row.retried,
      removed: total.removed + row.removed,
      failed: total.failed + row.failed,
      finishFailures: total.finishFailures + Number(row.finishFailure),
    }), { sent: 0, retried: 0, removed: 0, failed: 0, finishFailures: 0 });

    if (counts.finishFailures > 0) {
      return json(503, {
        leased: result.data.length,
        sent: counts.sent,
        retried: counts.retried,
        removed: counts.removed,
        failed: counts.failed,
      });
    }
    return json(200, {
      leased: result.data.length,
      sent: counts.sent,
      retried: counts.retried,
      removed: counts.removed,
      failed: counts.failed,
    });
  };
}
