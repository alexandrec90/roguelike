/**
 * The frame clock: what `delta` the scene is handed each frame.
 *
 * The raw gap between two animation frames jitters - a frame delivered late,
 * then one early - and a world stepped by the raw gap stutters with it. So, as
 * Phaser's `smoothStep` did, the delta is the mean of the last few gaps, and no
 * single gap counts for more than `MAX_DELTA_MS`: a tab returned to after a
 * minute moves the world one long frame, not a minute.
 */

/** No frame is stepped by more than this, ms. */
export const MAX_DELTA_MS = 200;
/** Gaps averaged into one delta. */
export const SMOOTHING_FRAMES = 10;

export class FrameClock {
  private readonly history: number[] = [];
  private last: number | undefined;

  /** The smoothed delta for a frame arriving at `nowMs`; 0 for the first frame. */
  tick(nowMs: number): number {
    const raw = this.last === undefined ? 0 : Math.min(Math.max(nowMs - this.last, 0), MAX_DELTA_MS);
    this.last = nowMs;
    if (raw > 0) {
      this.history.push(raw);
      if (this.history.length > SMOOTHING_FRAMES) {
        this.history.shift();
      }
    }
    if (this.history.length === 0) {
      return 0;
    }
    return this.history.reduce((sum, gap) => sum + gap, 0) / this.history.length;
  }

  /** Forget the history - after the tab was hidden, the old gaps say nothing. */
  reset(): void {
    this.history.length = 0;
    this.last = undefined;
  }
}
