/**
 * Volcano smoke as impostor balls, rebuilt every frame from the shared plume
 * (`volcanoes.ts`): where each puff is, how big and how old, all from the
 * clock - this file only decides which plumes can be seen and lays their puffs
 * out far to near, so the volume pass can blend them in order.
 *
 * Every puff of a plume is anchored at its vent, so on the lip the whole
 * column shrinks and sinks as one body, as a tree does about its foot, and
 * never shears away from the crater it leaves.
 */

import { rowsToSink } from "../../game/horizon";
import { wrapDelta, type PlanetPoint } from "../../game/planet";
import { WALL_RISE } from "../../game/projection";
import { plumePuffs, RISE_TILES, TOP_RADIUS, volcanoVents, type SmokePuff } from "../../game/volcanoes";
import type { ImpostorBuilder } from "./impostor";
import { Kind } from "./mesh";
import { LOWPOLY } from "./palette";
import type { FieldRows } from "./world-chunks";

interface Placed {
  readonly ahead: number;
  readonly foot: readonly [number, number];
  readonly puff: SmokePuff;
}

const scratch: SmokePuff[] = [];

/**
 * Every puff of every plume in sight, far to near, into `out`, in planet tiles
 * from the hero as the actor buffers are; `rows` is the field the view shows.
 * Returns how many puffs it laid.
 */
export function plumeBalls(out: ImpostorBuilder, hero: PlanetPoint, turn: number, elapsedMs: number, wind: number, rows: FieldRows): number {
  const sin = Math.sin(turn);
  const cos = Math.cos(turn);
  const placed: Placed[] = [];
  for (const vent of volcanoVents()) {
    const x = wrapDelta(vent.x, hero.x);
    const y = wrapDelta(vent.y, hero.y);
    const ahead = x * sin + y * cos;
    const top = (vent.z + RISE_TILES * 1.15 + TOP_RADIUS) * WALL_RISE;
    if (ahead < -rows.behind - TOP_RADIUS * 2 || ahead > rows.ahead + rowsToSink(top)) {
      continue;
    }
    for (const puff of plumePuffs(vent, elapsedMs, wind, scratch)) {
      placed.push({ ahead: (x + puff.dx) * sin + (y + puff.dy) * cos, foot: [x, y], puff });
    }
  }
  placed.sort((a, b) => b.ahead - a.ahead);
  for (const { foot, puff } of placed) {
    out.ball({
      centre: [foot[0] + puff.dx, foot[1] + puff.dy, puff.z],
      foot,
      radius: puff.radius,
      colour: LOWPOLY.smoke,
      kind: Kind.smoke,
      seed: puff.seed,
      age: puff.age,
    });
  }
  return placed.length;
}
