import assert from 'node:assert/strict';
import test from 'node:test';
import { createStagedDropMediaPath, isDropMediaFinalPath, resolveDropMediaPaths } from '../lib/dropMediaStorage.ts';

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
    `${ownerId}/pending/draft/not-a-uuid`,
    null,
  ]) {
    assert.equal(resolveDropMediaPaths(path, ownerId), null);
  }
});
