/**
 * The weather and the water it leaves, for the low-poly skin: how hard it is
 * raining, how soaked the ground is, and the rings feet and slimes leave in it.
 *
 * Everything decided here is read from the shared simulation - the sky from
 * `weatherAt` (or a `?weather=` pin), the soaking from `stepWetness`, the
 * footfalls from `stepWake`, where water stands from `puddleDepth` and the
 * lakes - so a ring only ever opens where the picture shows water. No GL here:
 * the renderer is handed `water(...)` and draws it.
 */

import { fromLocal, type PlanetPoint, type PlanetPose } from "../../game/planet";
import { wadeDepth } from "../../game/lakes";
import { createWake, stepWake } from "../../game/water/wake";
import { puddleDepth, waterLevel } from "../../game/water/puddle-field";
import { stepWetness, weatherAt, type WeatherState } from "../../game/water/schedule";
import type { WaterState } from "./renderer";
import { RippleRing } from "./ripples";

/** The shader's clock wraps at this, seconds, so a float keeps its precision all session. */
export const CLOCK_WRAP_S = 600;

/** How far either side of his centre a foot lands, tiles. */
const FOOT_SPREAD = 0.12;

/** Ring strength for a footstep, a foot settling while he stands, and a landing slime. */
const STEP_RING = 1;
const IDLE_RING = 0.45;
const LANDING_RING = 0.7;

/** The shader's clock for a world time, seconds. */
export function shaderSeconds(elapsedMs: number): number {
  return (elapsedMs / 1000) % CLOCK_WRAP_S;
}

export class WetWorld {
  readonly ripples = new RippleRing();
  private readonly wake = createWake();
  private soaked: number;
  private sky: WeatherState;

  /** `pinned` is a `?weather=` preset: the sky never changes, and the ground starts as soaked as it makes it. */
  constructor(private readonly pinned: WeatherState | undefined) {
    this.sky = pinned ?? weatherAt(0);
    this.soaked = pinned === undefined ? 0 : Math.min(pinned.rain * 1.15, 1);
  }

  get weather(): WeatherState {
    return this.sky;
  }

  get wetness(): number {
    return this.soaked;
  }

  /** Whether a planet point is standing in water: a lake's reach, or a puddle at this wetness. */
  isWet(point: PlanetPoint): boolean {
    return wadeDepth(point) > 0 || puddleDepth(point, this.soaked) > 0;
  }

  /**
   * One frame: the sky, the soaking, and the rings. `hero` is his live pose and
   * the tiles he has walked; `landings` are planet points where slimes came down.
   */
  step(elapsedMs: number, deltaMs: number, hero: { pose: PlanetPose; walked: number }, landings: readonly PlanetPoint[]): void {
    this.sky = this.pinned ?? weatherAt(elapsedMs);
    this.soaked = stepWetness(this.soaked, this.sky.rain, deltaMs);
    const seconds = shaderSeconds(elapsedMs);
    const beat = stepWake(this.wake, hero.walked, this.isWet(hero.pose), deltaMs);
    if (beat?.kind === "step") {
      this.ripples.add(fromLocal(hero.pose, { x: beat.side * FOOT_SPREAD, y: 0 }), seconds, STEP_RING);
    } else if (beat?.kind === "lap") {
      this.ripples.add(hero.pose, seconds, IDLE_RING);
    }
    for (const landing of landings) {
      if (this.isWet(landing)) {
        this.ripples.add(landing, seconds, LANDING_RING);
      }
    }
  }

  /** The water as the renderer draws it this frame. */
  water(hero: PlanetPoint, elapsedMs: number): WaterState {
    return {
      hero: [hero.x, hero.y],
      level: waterLevel(this.soaked),
      wetness: this.soaked,
      rain: this.sky.rain,
      seconds: shaderSeconds(elapsedMs),
      ripples: this.ripples.slots,
    };
  }
}
