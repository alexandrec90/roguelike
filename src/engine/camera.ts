/**
 * The camera: a scroll for the shake, a fade for the reveal, and the colour
 * behind everything. The world itself never moves the camera - the hero is
 * nailed to the screen and the planet turns under him - so this is all a
 * camera has to be here.
 */

export interface Fade {
  readonly from: number;
  readonly to: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/** The fade's black at `nowMs`, 0..1. Pure. */
export function fadeLevel(fade: Fade | undefined, nowMs: number): number {
  if (fade === undefined) {
    return 0;
  }
  if (fade.durationMs <= 0) {
    return fade.to;
  }
  const t = Math.min(Math.max((nowMs - fade.startMs) / fade.durationMs, 0), 1);
  return fade.from + (fade.to - fade.from) * t;
}

export class Camera {
  scrollX = 0;
  scrollY = 0;
  backgroundColor = 0x000000;
  private fade: Fade | undefined;
  private now = 0;

  setScroll(x: number, y: number): this {
    this.scrollX = x;
    this.scrollY = y;
    return this;
  }

  setBackgroundColor(color: number | string): this {
    this.backgroundColor = typeof color === "number" ? color : Number.parseInt(color.replace("#", ""), 16);
    return this;
  }

  /** Fade to black over `durationMs`. */
  fadeOut(durationMs: number): this {
    this.fade = { from: this.fadeAmount(), to: 1, startMs: this.now, durationMs };
    return this;
  }

  /** Fade from black over `durationMs`. */
  fadeIn(durationMs: number): this {
    this.fade = { from: 1, to: 0, startMs: this.now, durationMs };
    return this;
  }

  /** Called by the game with the loop's clock, before the scene updates. */
  tick(nowMs: number): void {
    this.now = nowMs;
  }

  /** How much black lies over the frame now, 0..1. */
  fadeAmount(): number {
    return fadeLevel(this.fade, this.now);
  }
}
