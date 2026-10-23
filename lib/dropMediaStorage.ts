const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createStagedDropMediaPath(userId: string, draftId: string, finalUploadId: string, attemptId?: string) {
  if (!PATH_SEGMENT.test(draftId) || !UUID.test(finalUploadId) || (attemptId !== undefined && !UUID.test(attemptId))) return null;
  return `${userId}/pending/${draftId}/${finalUploadId}${attemptId ? `/${attemptId}` : ''}`;
}

export function createStagedDropMediaAttemptPath(userId: string, draftId: string, finalUploadId = crypto.randomUUID()) {
  return createStagedDropMediaPath(userId, draftId, finalUploadId, crypto.randomUUID());
}

export function resolveDropMediaPaths(stagedPath: unknown, userId: string) {
  if (typeof stagedPath !== 'string') return null;
  const [ownerId, folder, draftId, finalUploadId, attemptId, extra] = stagedPath.split('/');
  if (ownerId !== userId
    || folder !== 'pending'
    || !PATH_SEGMENT.test(draftId || '')
    || !UUID.test(finalUploadId || '')
    || (attemptId !== undefined && !UUID.test(attemptId))
    || extra !== undefined) return null;

  return { stagedPath, draftId, finalPath: `${ownerId}/${draftId}/${finalUploadId}` };
}

export function isDropMediaFinalPath(path: unknown, userId: string, draftId: string) {
  if (typeof path !== 'string') return false;
  const [ownerId, pathDraftId, uploadId, extra] = path.split('/');
  return ownerId === userId && pathDraftId === draftId && UUID.test(uploadId || '') && extra === undefined;
}
