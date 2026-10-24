import assert from 'node:assert/strict';
import test from 'node:test';
import { createStagedDropMediaAttemptPath, createStagedDropMediaPath, isDropMediaFinalPath, resolveDropMediaPaths } from '../lib/dropMediaStorage.ts';

const ownerId = '11111111-1111-4111-8111-111111111111';
const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('creates a safe staged path and resolves its private final path', () => {
  const stagedPath = createStagedDropMediaPath(ownerId, 'draft-1', uploadId);
  assert.equal(stagedPath, `${ownerId}/pending/draft-1/${uploadId}`);
  assert.deepEqual(resolveDropMediaPaths(stagedPath, ownerId), {
    stagedPath,
    draftId: 'draft-1',
    finalPath: `${ownerId}/draft-1/${uploadId}`,
  });
  assert.equal(isDropMediaFinalPath(`${ownerId}/draft-1/${uploadId}`, ownerId, 'draft-1'), true);
  assert.equal(isDropMediaFinalPath(`${ownerId}/other/${uploadId}`, ownerId, 'draft-1'), false);
  assert.equal(createStagedDropMediaPath(ownerId, 'draft:1', uploadId), null);
});

test('rejects paths outside the authenticated staging prefix', () => {
  for (const path of [
    `${ownerId}/other/draft/${uploadId}`,
    `22222222-2222-4222-8222-222222222222/pending/draft/${uploadId}`,
    `${ownerId}/pending/../${uploadId}`,
    `${ownerId}/pending/draft/${uploadId}/extra`,
    `${ownerId}/pending/draft/${uploadId}/not-a-uuid`,
    `${ownerId}/pending/draft/not-a-uuid`,
    null,
  ]) {
    assert.equal(resolveDropMediaPaths(path, ownerId), null);
  }
});

test('creates a fresh staged media path for each upload attempt of one draft', () => {
  const finalUploadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const firstPath = createStagedDropMediaAttemptPath(ownerId, 'draft-1', finalUploadId);
  const retryPath = createStagedDropMediaAttemptPath(ownerId, 'draft-1', finalUploadId);
  const firstFinalPath = resolveDropMediaPaths(firstPath, ownerId)?.finalPath;
  const retryFinalPath = resolveDropMediaPaths(retryPath, ownerId)?.finalPath;

  assert.ok(firstPath);
  assert.ok(retryPath);
  assert.notEqual(firstPath, retryPath);
  assert.equal(firstFinalPath, retryFinalPath);
  assert.equal(firstFinalPath, `${ownerId}/draft-1/${finalUploadId}`);
  assert.equal(isDropMediaFinalPath(firstFinalPath, ownerId, 'draft-1'), true);
  assert.equal(resolveDropMediaPaths(firstPath, ownerId)?.draftId, 'draft-1');
  assert.equal(resolveDropMediaPaths(retryPath, ownerId)?.draftId, 'draft-1');
});
