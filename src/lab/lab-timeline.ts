/**
 * Clip timing for the asset lab.
 *
 * Animation here is a held frame index, never an interpolation: the art is
 * authored on whole pixels and a frame either shows or it does not. Keeping the
 * arithmetic pure means "which frame is on screen at t?" is a test, which is
 * what makes a capture at a given time comparable with the next one.
 */

export function clipDurationMs(frameCount: number, frameDurationMs: number): number {
  assertClip(frameCount, frameDurationMs);
  return frameCount * frameDurationMs;
}

/** Frame showing at `elapsedMs`, looping forever. Negative time runs the clip backwards. */
export function frameIndexAt(
  elapsedMs: number,
  frameCount: number,
  frameDurationMs: number,
): number {
  assertClip(frameCount, frameDurationMs);
  const raw = Math.floor(elapsedMs / frameDurationMs);
  return ((raw % frameCount) + frameCount) % frameCount;
}

/** Start of a frame's hold — where a paused lab parks the clock when you step. */
export function timeForFrame(frameIndex: number, frameDurationMs: number): number {
  if (frameDurationMs <= 0) {
    throw new Error("Frame duration must be greater than zero");
  }
  return Math.trunc(frameIndex) * frameDurationMs;
}

/** Move `delta` frames from `current`, wrapping at both ends. */
export function stepFrame(current: number, delta: number, frameCount: number): number {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("A clip must have at least one frame");
  }
  const next = Math.trunc(current) + Math.trunc(delta);
  return ((next % frameCount) + frameCount) % frameCount;
}

function assertClip(frameCount: number, frameDurationMs: number): void {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("A clip must have at least one frame");
  }
  if (frameDurationMs <= 0) {
    throw new Error("Frame duration must be greater than zero");
  }
}
