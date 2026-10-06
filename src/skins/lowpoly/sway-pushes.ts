/**
 * What pushes the plants this frame (`sway.ts`), read off the shared fight:
 * the hero, his swing, the bursts, the fireballs in flight and the slimes
 * nearest him. Each is a ring - a centre, a front radius, a strength - and the
 * shader leans every plant away from it.
 *
 * Stateless: every push is a function of the simulation's own clocks (a
 * swing's progress, a burst's age), so the grass can never disagree with the
 * fight about what happened. Something new that should part the grass is one
 * more line in `pushesOf`.
 */

import type { Burst } from "../../game/encounter-sim";
import { BURST_MS } from "../../game/encounter-sim";
import type { Slime } from "../../game/creatures/slime-brain";
import { fireballPoint, type Fireball } from "../../game/fire/fireball";
import { wrapDelta, type PlanetPoint } from "../../game/planet";
import { attackProgress, type PlayerState } from "../../game/player";
import { MAX_PUSHES } from "./sway";

/** How far a swing's sweep reaches round him, tiles. */
const SWING_REACH = 1.3;
/** A body's push: the hero, a slime, a fireball skimming over the grass. */
const HERO_PUSH = 0.9;
const SLIME_PUSH = 0.7;
const FIREBALL_PUSH = 1.4;
const SWING_PUSH = 1.6;
const BURST_PUSH: Readonly<Record<Burst["kind"], number>> = { blast: 3.2, nova: 2.6 };

export interface PushInput {
  readonly player: PlayerState;
  /** His live planet point: every push is measured from it. */
  readonly live: PlanetPoint;
  readonly slimes: readonly Slime[];
  readonly fireballs: readonly Fireball[];
  readonly bursts: readonly Burst[];
}

/**
 * This frame's pushes, most important first so the slots that run out are the
 * ones that matter least: the hero, his swing, the bursts, the fireballs, then
 * the slimes nearest him.
 */
export function pushesOf(input: PushInput, out: Float32Array = new Float32Array(MAX_PUSHES * 4)): Float32Array {
  out.fill(0);
  let slot = 0;
  const push = (at: PlanetPoint | readonly [number, number], front: number, strength: number): void => {
    if (slot >= MAX_PUSHES || strength <= 0) {
      return;
    }
    const [x, y] = "x" in at ? [wrapDelta(at.x, input.live.x), wrapDelta(at.y, input.live.y)] : at;
    out.set([x, y, front, strength], slot * 4);
    slot += 1;
  };
  push([0, 0], 0, HERO_PUSH);
  const swing = attackProgress(input.player);
  if (swing !== undefined) {
    // The sweep races out from him and is spent by the end of the blow.
    push([0, 0], SWING_REACH * Math.sqrt(swing), SWING_PUSH * Math.sin(Math.PI * swing));
  }
  for (const burst of input.bursts) {
    const t = Math.min(burst.ageMs / BURST_MS[burst.kind], 1);
    push(burst.at, burst.radius * Math.sqrt(t), BURST_PUSH[burst.kind] * (1 - t));
  }
  for (const ball of input.fireballs) {
    if (ball.flying) {
      push(fireballPoint(ball), 0, FIREBALL_PUSH);
    }
  }
  const near = input.slimes
    .filter((slime) => slime.mode !== "dying")
    .map((slime) => ({ at: slime.at, d: Math.hypot(wrapDelta(slime.at.x, input.live.x), wrapDelta(slime.at.y, input.live.y)) }))
    .sort((a, b) => a.d - b.d);
  for (const slime of near) {
    push(slime.at, 0, SLIME_PUSH);
  }
  return out;
}
