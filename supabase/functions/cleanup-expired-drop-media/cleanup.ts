export type CleanupJob = {
  job_id: number;
  lease_token: string;
  letter_id: unknown;
  sender_id: unknown;
  media_path: unknown;
};
export type ValidCleanupJobPath = CleanupJob & {
  letter_id: string;
  sender_id: string;
  media_path: string;
};

export type CleanupStorageBucket = {
  exists(path: string): Promise<{ data: boolean | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
};

type CleanupRpcCall = () => Promise<{ data: unknown; error: unknown }>;

export type ReconciledCleanupLease = {
  data: unknown;
  error: unknown;
  reconciliationError: unknown;
  reconciled: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

export function isValidCleanupJob(candidate: unknown): candidate is CleanupJob {
  if (!candidate || typeof candidate !== 'object') return false;
  const job = candidate as Partial<CleanupJob>;
  return Number.isSafeInteger(job.job_id)
    && typeof job.lease_token === 'string'
    && UUID.test(job.lease_token);
}

export function validJobPath(job: CleanupJob): job is ValidCleanupJobPath {
  if (typeof job.sender_id !== 'string'
    || typeof job.letter_id !== 'string'
    || typeof job.media_path !== 'string') return false;
  const segments = job.media_path.split('/');
  return UUID.test(job.sender_id)
    && PATH_SEGMENT.test(job.letter_id)
    && segments.length === 3
    && segments[0] === job.sender_id
    && segments[1] === job.letter_id
    && UUID.test(segments[2]);
}

export async function reconcileAndLeaseCleanupJobs(
  reconcile: CleanupRpcCall,
  lease: CleanupRpcCall,
  limit: number,
): Promise<ReconciledCleanupLease> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    return { data: null, error: 'Invalid cleanup batch size.', reconciliationError: null, reconciled: 0 };
  }

  let reconciled = 0;
  let reconciliationError: unknown = null;
  try {
    try {
      const reconciliation = await reconcile();
      if (reconciliation.error) {
        reconciliationError = reconciliation.error;
      } else if (!Number.isSafeInteger(reconciliation.data)
        || (reconciliation.data as number) < 0
        || (reconciliation.data as number) > limit) {
        reconciliationError = 'Invalid cleanup reconciliation result.';
      } else {
        reconciled = reconciliation.data as number;
      }
    } catch (error) {
      reconciliationError = error;
    }

    const leasing = await lease();
    return { data: leasing.data, error: leasing.error, reconciliationError, reconciled };
  } catch (error) {
    return { data: null, error, reconciliationError, reconciled };
  }
}

export async function removeOrConfirmAbsent(bucket: CleanupStorageBucket, path: string) {
  try {
    const { data: exists, error: existsError } = await bucket.exists(path);
    if (!existsError && exists === false) return true;

    const { error: removeError } = await bucket.remove([path]);
    if (!removeError) return true;

    // A prior worker may have removed the object and lost its finish response.
    // Only accept absence when Storage confirms it; failed checks remain retryable.
    const { data: stillExists, error: confirmError } = await bucket.exists(path);
    return !confirmError && stillExists === false;
  } catch {
    return false;
  }
}
