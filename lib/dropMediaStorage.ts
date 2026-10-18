const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createStagedDropMediaPath(userId: string, draftId: string, uploadId: string) {
  if (!PATH_SEGMENT.test(draftId) || !UUID.test(uploadId)) return null;
  return `${userId}/pending/${draftId}/${uploadId}`;
}

export function resolveDropMediaPaths(stagedPath: unknown, userId: string) {
  if (typeof stagedPath !== 'string') return null;
  const [ownerId, folder, draftId, uploadId, extra] = stagedPath.split('/');
  if (ownerId !== userId || folder !== 'pending' || !PATH_SEGMENT.test(draftId || '') || !UUID.test(uploadId || '') || extra !== undefined) return null;

  return { stagedPath, draftId, finalPath: `${ownerId}/${draftId}/${uploadId}` };
}

export function isDropMediaFinalPath(path: unknown, userId: string, draftId: string) {
  if (typeof path !== 'string') return false;
  const [ownerId, pathDraftId, uploadId, extra] = path.split('/');
  return ownerId === userId && pathDraftId === draftId && UUID.test(uploadId || '') && extra === undefined;
}
