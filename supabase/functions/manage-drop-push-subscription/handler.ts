type User = { id: string };

type SupabaseClient = {
  auth?: {
    getUser(token: string): Promise<{ data: { user: User | null }; error: unknown }>;
  };
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

type ClientOptions = {
  auth: { autoRefreshToken: false; persistSession: false };
};

export type ManageDropPushDependencies = {
  getEnv(name: string): string | undefined;
  createClient(url: string, key: string, options: ClientOptions): SupabaseClient;
};

const MAX_BODY_BYTES = 8_192;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
      ...CORS_HEADERS,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonBody(request: Request): Promise<{ data: unknown; error: 'too_large' | 'invalid_json' | null }> {
  if (!request.body) return { data: null, error: 'invalid_json' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { data: null, error: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { data: null, error: 'invalid_json' };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { data: JSON.parse(new TextDecoder().decode(bytes)), error: null };
  } catch {
    return { data: null, error: 'invalid_json' };
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: string[]) {
  return Object.keys(record).every((key) => allowed.includes(key));
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

function validPushKey(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length >= minLength
    && value.length <= maxLength
    && BASE64URL.test(value);
}

function publishableKey(getEnv: ManageDropPushDependencies['getEnv']) {
  return getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_PUBLISHABLE_KEY') || null;
}

function serviceKey(getEnv: ManageDropPushDependencies['getEnv']) {
  const secretKeys = getEnv('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      if (typeof parsed.default === 'string' && parsed.default.length > 0) return parsed.default;
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  return getEnv('SUPABASE_SERVICE_ROLE_KEY') || null;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match && match[1].length <= 4_096 ? match[1] : null;
}

type ParsedAction = {
  action: 'status' | 'enable' | 'disable';
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

function parseAction(body: unknown): ParsedAction | null {
  if (!isRecord(body) || typeof body.action !== 'string') return null;

  if (body.action === 'status') {
    if (!hasOnlyKeys(body, ['action', 'endpoint'])) return null;
    if (body.endpoint === undefined) return { action: 'status', endpoint: null, p256dh: null, auth: null };
    if (!isAllowedEndpoint(body.endpoint)) return null;
    return { action: 'status', endpoint: body.endpoint, p256dh: null, auth: null };
  }

  if (body.action === 'enable') {
    if (!hasOnlyKeys(body, ['action', 'subscription']) || !isRecord(body.subscription)) return null;
    const { subscription } = body;
    const endpoint = subscription.endpoint;
    const keys = subscription.keys;
    if (!isAllowedEndpoint(endpoint) || !isRecord(keys)) return null;
    const p256dh = keys.p256dh;
    const auth = keys.auth;
    if (!validPushKey(p256dh, 40, 128) || !validPushKey(auth, 16, 128)) return null;
    return {
      action: 'enable',
      endpoint,
      p256dh,
      auth,
    };
  }

  if (body.action === 'disable') {
    if (!hasOnlyKeys(body, ['action', 'endpoint']) || !isAllowedEndpoint(body.endpoint)) return null;
    return { action: 'disable', endpoint: body.endpoint, p256dh: null, auth: null };
  }

  return null;
}

export function createManageDropPushSubscriptionHandler(dependencies: ManageDropPushDependencies) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json(415, { error: 'A JSON request is required.' });
    }

    const { data: body, error: bodyError } = await readJsonBody(request);
    if (bodyError === 'too_large') return json(413, { error: 'Request too large.' });
    if (bodyError) return json(400, { error: 'Invalid request.' });
    const action = parseAction(body);
    if (!action) return json(400, { error: 'Invalid request.' });

    const token = bearerToken(request);
    if (!token) return json(401, { error: 'Unauthorized.' });
    const url = dependencies.getEnv('SUPABASE_URL');
    const anonKey = publishableKey(dependencies.getEnv);
    if (!url || !anonKey) return json(503, { error: 'Push subscription service is not configured.' });

    let verifiedUser: User | null = null;
    try {
      const authClient = dependencies.createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const result = await authClient.auth?.getUser(token);
      if (!result || result.error || !result.data.user || !UUID.test(result.data.user.id)) {
        return json(401, { error: 'Unauthorized.' });
      }
      verifiedUser = result.data.user;
    } catch {
      return json(401, { error: 'Unauthorized.' });
    }

    const key = serviceKey(dependencies.getEnv);
    if (!key) return json(503, { error: 'Push subscription service is not configured.' });

    try {
      const adminClient = dependencies.createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const result = await adminClient.rpc?.('manage_drop_push_subscription', {
        p_action: action.action,
        p_user_id: verifiedUser.id,
        p_endpoint: action.endpoint,
        p_p256dh: action.p256dh,
        p_auth: action.auth,
      });
      if (!result || result.error || typeof result.data !== 'boolean') {
        return json(503, { error: 'Push subscription could not be updated.' });
      }
      return json(200, { enabled: result.data });
    } catch {
      return json(503, { error: 'Push subscription could not be updated.' });
    }
  };
}
