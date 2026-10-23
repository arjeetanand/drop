import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidCleanupJob, removeOrConfirmAbsent, validJobPath } from '../supabase/functions/cleanup-expired-drop-media/cleanup.ts';

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
