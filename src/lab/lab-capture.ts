/**
 * The capture `window.assetLab.snapshot()` returns.
 *
 * `LabScene.setState` moves game objects, and the canvas only changes when Phaser
 * draws them, which happens inside `game.loop`. An extension-driven tab is usually
 * hidden, so Chrome freezes `requestAnimationFrame` and the loop never runs. Reading
 * the canvas there returned the same frame for all 16 frames of `hero-facings-free`.
 * So the capture draws the frame first. `step` with a zero delta runs every system
 * without advancing time, which leaves a paused view exactly where `apply` put it.
 */

/** The part of `Phaser.Game` a capture needs, so a test can stand in for it. */
export interface CaptureTarget {
  readonly isBooted: boolean;
  readonly canvas: { toDataURL(type: string): string };
  step(time: number, delta: number): void;
}

/** Draw the current state, then return it as a PNG data URL. */
export function captureNow(game: CaptureTarget, now: () => number = () => performance.now()): string {
  // Before boot there is no scene to draw, and `step` would run systems that do not exist yet.
  if (game.isBooted) {
    game.step(now(), 0);
  }
  return game.canvas.toDataURL("image/png");
}
