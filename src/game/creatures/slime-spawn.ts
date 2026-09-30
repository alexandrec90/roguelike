/**
 * Where slimes live: a seeded lattice of dens over the planet.
 *
 * The same pattern `terrain.ts` uses for trees and puddles — a planet cell
 * either carries a feature or it does not, decided by a hash of the cell, and
 * the feature is jittered inside it — so a den is a *place*: walk away and
 * back and the slime is still there, walk round the planet and it is there
 * again. What a den adds over a tree is a **generation**: kill its slime and,
 * some seconds later, the den spawns a new one, a little way off, with a new
 * seed and so possibly a new colour. The world restocks without ever being a
 * list somebody authored.
 */

import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "../planet";
import { isRockAt } from "../terrain";
import { pixelHash } from "../transforms";
import type { SlimeVariant } from "./slime-palette";

/** One seed for every den on the planet. */
export const SLIME_SEED = 0x511e;

/**
 * Share of planet cells that hold a den. A disc of 12 tiles holds ~450 cells,
 * so this is about five dens in reach of anywhere — a handful, never a crowd.
 */
export const DEN_DENSITY = 0.012;

/** How far from its den a respawned slime may appear, tiles. */
export const RESPAWN_SCATTER = 2.5;

/** What stops a slime: rock, unless a test says otherwise. */
export type Blocked = (point: PlanetPoint) => boolean;

export interface Den {
  /** Stable identity: the cell's index on the planet. */
  readonly key: number;
  readonly cellX: number;
  readonly cellY: number;
  /** Where its first slime stands. */
  readonly point: PlanetPoint;
}

/** The den a planet cell holds, or null. Pure: the same cell always answers the same. */
export function denAt(cellX: number, cellY: number, blocked: Blocked = isRockAt): Den | null {
  const x = wrapTile(Math.floor(cellX));
  const y = wrapTile(Math.floor(cellY));
  if (pixelHash(x, y, SLIME_SEED, 1) >= DEN_DENSITY) {
    return null;
  }
  const point = {
    x: wrapTile(x + pixelHash(x, y, SLIME_SEED, 2)),
    y: wrapTile(y + pixelHash(x, y, SLIME_SEED, 3)),
  };
  if (blocked(point)) {
    return null;
  }
  return { key: y * PLANET_TILES + x, cellX: x, cellY: y, point };
}

/** Planet distance between two points, across the seam. */
export function planetDistance(a: PlanetPoint, b: PlanetPoint): number {
  return Math.hypot(wrapDelta(a.x, b.x), wrapDelta(a.y, b.y));
}

/**
 * Every den within `reach` tiles of a point.
 *
 * A disc rather than the screen's box, for the reason `terrain.ts` gives: the
 * screen turns, and a den must not blink into existence because the hero did.
 */
export function densNear(centre: PlanetPoint, reach: number, blocked: Blocked = isRockAt): Den[] {
  const found: Den[] = [];
  const left = Math.floor(centre.x - reach);
  const top = Math.floor(centre.y - reach);
  const span = Math.ceil(reach * 2) + 1;
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const den = denAt(left + column, top + row, blocked);
      if (den !== null && planetDistance(den.point, centre) <= reach) {
        found.push(den);
      }
    }
  }
  return found;
}

/** The seed of a den's `generation`th slime. */
export function slimeSeed(den: Den, generation: number): number {
  return Math.floor(pixelHash(den.cellX, den.cellY, SLIME_SEED ^ generation, 4) * 0xffffff);
}

/** Mostly green; a fire, a frost or an arcane one about one time in ten each. */
export function variantOf(seed: number): SlimeVariant {
  const roll = pixelHash(seed, 0, SLIME_SEED, 5);
  if (roll < 0.1) {
    return "fire";
  }
  if (roll < 0.2) {
    return "frost";
  }
  if (roll < 0.28) {
    return "arcane";
  }
  return "green";
}

/**
 * Where a den's `generation`th slime appears.
 *
 * The first is at the den itself. Later ones scatter up to `RESPAWN_SCATTER`
 * tiles off it — "respawning elsewhere" — trying a few seeded spots and falling
 * back to the den when every one of them is rock.
 */
export function spawnPoint(den: Den, generation: number, blocked: Blocked = isRockAt): PlanetPoint {
  if (generation === 0) {
    return den.point;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = pixelHash(generation, attempt, den.key, 6) * Math.PI * 2;
    const distance = RESPAWN_SCATTER * (0.4 + 0.6 * pixelHash(generation, attempt, den.key, 7));
    const point = {
      x: wrapTile(den.point.x + Math.cos(angle) * distance),
      y: wrapTile(den.point.y + Math.sin(angle) * distance),
    };
    if (!blocked(point)) {
      return point;
    }
  }
  return den.point;
}
