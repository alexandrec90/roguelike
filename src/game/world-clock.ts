/**
 * The scene's clock: play time, the time of day, and the impulse that can stop
 * both for a heartbeat.
 *
 * Kept apart from `DemoScene` so the one question every layer depends on —
 * "what moment is it" — is answered by something that can be tested without a
 * canvas. A hit stop freezes *play* time (the world holds its breath for a few
 * frames when a blow lands), while the impulse's own clock keeps running so the
 * accompanying shake still plays out.
 */

import { atmosphereAt, clockHours, DEFAULT_START_HOURS, type Atmosphere } from "./atmosphere";
import {
  createImpulse,
  impulseSink,
  shakeOffset,
  stepImpulse,
  type ImpulseSink,
  type ImpulseState,
} from "./impulse";

/** No frame advances the world by more than this, however long the tab slept. */
export const MAX_FRAME_MS = 40;

export class WorldClock {
  private elapsed = 0;
  private delta = 0;
  private readonly impulse: ImpulseState = createImpulse();
  readonly sink: ImpulseSink = impulseSink(this.impulse);

  constructor(
    private readonly pinnedHours: number | undefined,
    private readonly dayMs: number,
    private readonly startHours: number = DEFAULT_START_HOURS,
  ) {}

  /** Advance by a real frame delta; returns the (possibly frozen) world delta. */
  tick(realDeltaMs: number): number {
    const real = Math.min(Math.max(realDeltaMs, 0), MAX_FRAME_MS);
    this.delta = stepImpulse(this.impulse, real);
    this.elapsed += this.delta;
    return this.delta;
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  get deltaMs(): number {
    return this.delta;
  }

  /** The hour of the day now: pinned, or run from the start hour. */
  hours(): number {
    return this.pinnedHours ?? clockHours(this.elapsed, this.startHours, this.dayMs);
  }

  atmosphere(overcast: number): Atmosphere {
    return atmosphereAt(this.hours(), overcast);
  }

  /** Where the camera is thrown this frame, whole pixels. */
  shake(): { readonly x: number; readonly y: number } {
    return shakeOffset(this.impulse);
  }
}
