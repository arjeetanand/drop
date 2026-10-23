import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidCleanupJob,
  reconcileAndLeaseCleanupJobs,
  removeOrConfirmAbsent,
  validJobPath,
} from '../supabase/functions/cleanup-expired-drop-media/cleanup.ts';

const senderId = '11111111-1111-4111-8111-111111111111';
const leaseToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const objectId = '550e8400-e29b-41d4-a716-446655440000';
const validJob = {
  job_id: 1,
  lease_token: leaseToken,
  letter_id: 'draft-1',
  sender_id: senderId,
  media_path: `${senderId}/draft-1/${objectId}`,
};

test('validates cleanup RPC job and path fields before path processing', () => {
  assert.equal(isValidCleanupJob(validJob), true);
  assert.equal(validJobPath(validJob), true);
  assert.equal(validJobPath({ ...validJob, media_path: null }), false);
  assert.equal(validJobPath({ ...validJob, media_path: 3 }), false);
  assert.equal(validJobPath({ ...validJob, letter_id: '../other' }), false);
  assert.equal(validJobPath({ ...validJob, media_path: `${senderId}/draft-1/${objectId}/extra` }), false);
  assert.equal(isValidCleanupJob({ ...validJob, job_id: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(isValidCleanupJob({ ...validJob, lease_token: 'bad' }), false);
  assert.equal(isValidCleanupJob(null), false);
});

test('reconciles orphan objects before leasing the cleanup queue', async () => {
  const calls = [];
  const result = await reconcileAndLeaseCleanupJobs(
    async () => {
      calls.push('reconcile');
      return { data: 2, error: null };
    },
    async () => {
      calls.push('lease');
      return { data: [validJob], error: null };
    },
    25,
  );

  assert.deepEqual(calls, ['reconcile', 'lease']);
  assert.equal(result.reconciled, 2);
  assert.deepEqual(result.data, [validJob]);
  assert.equal(result.error, null);
});

test('keeps existing cleanup work running when orphan reconciliation fails or returns an invalid count', async () => {
  let leaseCalls = 0;
  const failed = await reconcileAndLeaseCleanupJobs(
    async () => ({ data: null, error: new Error('database unavailable') }),
    async () => {
      leaseCalls += 1;
      return { data: [validJob], error: null };
    },
    25,
  );
  const thrown = await reconcileAndLeaseCleanupJobs(
    async () => { throw new Error('database unavailable'); },
    async () => {
      leaseCalls += 1;
      return { data: [validJob], error: null };
    },
    25,
  );
  const invalid = await reconcileAndLeaseCleanupJobs(
    async () => ({ data: 26, error: null }),
    async () => {
      leaseCalls += 1;
      return { data: [validJob], error: null };
    },
    25,
  );

  assert.equal(failed.error, null);
  assert.equal(thrown.error, null);
  assert.equal(invalid.error, null);
  assert.ok(failed.reconciliationError);
  assert.ok(thrown.reconciliationError);
  assert.ok(invalid.reconciliationError);
  assert.deepEqual(failed.data, [validJob]);
  assert.deepEqual(thrown.data, [validJob]);
  assert.deepEqual(invalid.data, [validJob]);
  assert.equal(leaseCalls, 3);
});

test('leases the existing queue when orphan reconciliation finds nothing', async () => {
  const result = await reconcileAndLeaseCleanupJobs(
    async () => ({ data: 0, error: null }),
    async () => ({ data: [validJob], error: null }),
    25,
  );

  assert.equal(result.reconciled, 0);
  assert.equal(result.reconciliationError, null);
  assert.deepEqual(result.data, [validJob]);
  assert.equal(result.error, null);
});

test('rejects unsafe cleanup batch sizes before either RPC runs', async () => {
  let rpcCalls = 0;
  const result = await reconcileAndLeaseCleanupJobs(
    async () => {
      rpcCalls += 1;
      return { data: 0, error: null };
    },
    async () => {
      rpcCalls += 1;
      return { data: [validJob], error: null };
    },
    26,
  );

  assert.equal(rpcCalls, 0);
  assert.ok(result.error);
  assert.equal(result.reconciliationError, null);
  assert.equal(result.data, null);
});

test('accepts confirmed absence without making a Storage remove request', async () => {
  let removeCalls = 0;
  const bucket = {
    async exists() { return { data: false, error: null }; },
    async remove() { removeCalls += 1; return { error: null }; },
  };
  assert.equal(await removeOrConfirmAbsent(bucket, validJob.media_path), true);
  assert.equal(removeCalls, 0);
});

test('treats a remove error as complete only when Storage confirms the object is gone', async () => {
  let existsCalls = 0;
  const bucket = {
    async exists() {
      existsCalls += 1;
      return existsCalls === 1 ? { data: true, error: null } : { data: false, error: null };
    },
    async remove() { return { error: new Error('ambiguous remove response') }; },
  };
  assert.equal(await removeOrConfirmAbsent(bucket, validJob.media_path), true);
  assert.equal(existsCalls, 2);
});

test('keeps cleanup retryable when removal failed and the object still exists', async () => {
  const bucket = {
    async exists() { return { data: true, error: null }; },
    async remove() { return { error: new Error('storage unavailable') }; },
  };
  assert.equal(await removeOrConfirmAbsent(bucket, validJob.media_path), false);
});

test('does not treat a failed existence check as proof that an object is absent', async () => {
  const bucket = {
    async exists() { return { data: false, error: new Error('network unavailable') }; },
    async remove() { return { error: new Error('storage unavailable') }; },
  };
  assert.equal(await removeOrConfirmAbsent(bucket, validJob.media_path), false);
});
