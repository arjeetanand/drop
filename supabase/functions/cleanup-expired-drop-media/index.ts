import { createClient } from 'npm:@supabase/supabase-js@2';
import { isValidCleanupJob, removeOrConfirmAbsent, validJobPath } from './cleanup.ts';

const MAX_BATCH_SIZE = 25;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function timingSafeEqual(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function serviceKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      const defaultKey = parsed.default;
      if (typeof defaultKey === 'string' && defaultKey.length > 0) return defaultKey;
    } catch {
      // Fall back to the legacy service-role environment value below.
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const configuredSecret = Deno.env.get('DROP_MEDIA_CLEANUP_SECRET');
  if (!configuredSecret || configuredSecret.length < 32) return json(503, { error: 'Cleanup worker is not configured.' });
  const suppliedSecret = request.headers.get('x-drop-cleanup-secret') || '';
  if (!timingSafeEqual(suppliedSecret, configuredSecret)) return json(401, { error: 'Unauthorized.' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  if (!url || !key) return json(503, { error: 'Cleanup worker is not configured.' });

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1024)) {
    return json(413, { error: 'Request too large.' });
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc('lease_expired_drop_media_cleanup_jobs', { p_limit: MAX_BATCH_SIZE });
  if (error || !Array.isArray(data)) {
    return json(503, { error: 'Cleanup jobs could not be leased.' });
  }

  let removed = 0;
  let retried = 0;
  let finishFailures = 0;
  for (const candidate of data as unknown[]) {
    let removedFromStorage = false;
    let errorCode: 'invalid_path' | 'storage_remove_failed' | null = null;

    if (!isValidCleanupJob(candidate)) {
      finishFailures += 1;
      continue;
    }
    const job = candidate;

    if (!validJobPath(job)) {
      errorCode = 'invalid_path';
    } else {
      removedFromStorage = await removeOrConfirmAbsent(supabase.storage.from('drop-media'), job.media_path);
      if (!removedFromStorage) errorCode = 'storage_remove_failed';
    }

    let finishFailed = false;
    try {
      const { data: finished, error: rpcError } = await supabase.rpc('finish_expired_drop_media_cleanup_job', {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_removed: removedFromStorage,
        p_error_code: errorCode,
      });
      finishFailed = Boolean(rpcError) || finished !== true;
    } catch {
      finishFailed = true;
    }

    if (finishFailed) {
      finishFailures += 1;
      continue;
    }
    if (removedFromStorage) removed += 1;
    else retried += 1;
  }

  if (finishFailures > 0) return json(503, { processed: data.length, removed, retried, finishFailures });
  return json(200, { processed: data.length, removed, retried });
});
