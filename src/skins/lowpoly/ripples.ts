/**
 * The rings footsteps and landings leave in standing water, as the shader
 * reads them: a fixed ring of `MAX_RIPPLES` slots, the oldest overwritten.
 *
 * Each slot is planet x, y, the second it was born and its strength - exactly
 * one `vec4` of `u_ripples`, so a frame hands the whole set over in one call.
 * A ring outlives its slot only if sixteen more land within its life, which a
 * hero and a few slimes never manage.
 */

import type { PlanetPoint } from "../../game/planet";
import { MAX_RIPPLES } from "./water-glsl";

export class RippleRing {
  readonly slots = new Float32Array(MAX_RIPPLES * 4);
  private next = 0;

  /** A ring born at `seconds` (the shader's clock) at a planet point. */
  add(at: PlanetPoint, seconds: number, strength: number): void {
    const base = this.next * 4;
    this.slots[base] = at.x;
    this.slots[base + 1] = at.y;
    this.slots[base + 2] = seconds;
    this.slots[base + 3] = strength;
    this.next = (this.next + 1) % MAX_RIPPLES;
  }
}
