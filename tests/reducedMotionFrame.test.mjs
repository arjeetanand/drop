import assert from 'node:assert/strict';
import test from 'node:test';
import { getReducedMotionFrameSize, MAX_REDUCED_MOTION_FRAME_DIMENSION } from '../lib/reducedMotionFrame.ts';

test('scales large reduced-motion stills to 1600px without changing aspect ratio', () => {
  assert.deepEqual(getReducedMotionFrameSize(4800, 3200), { width: 1600, height: 1066 });
  assert.deepEqual(getReducedMotionFrameSize(3200, 6400), { width: 800, height: 1600 });
  assert.deepEqual(getReducedMotionFrameSize(800, 600), { width: 800, height: 600 });
  assert.ok(MAX_REDUCED_MOTION_FRAME_DIMENSION * MAX_REDUCED_MOTION_FRAME_DIMENSION < 40_000_000);
});

test('rejects unusable source dimensions so the caller can show its paused fallback', () => {
  assert.equal(getReducedMotionFrameSize(0, 100), null);
  assert.equal(getReducedMotionFrameSize(Number.POSITIVE_INFINITY, 100), null);
});
