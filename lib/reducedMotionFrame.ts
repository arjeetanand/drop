export const MAX_REDUCED_MOTION_FRAME_DIMENSION = 1600;

export function getReducedMotionFrameSize(sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;

  const scale = Math.min(1, MAX_REDUCED_MOTION_FRAME_DIMENSION / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}
