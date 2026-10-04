/**
 * Caves: where their mouths are on the planet, and the chamber behind each.
 *
 * A mouth is a point feature like a lake or a landform - a seeded lattice of
 * planet cells, one candidate per cell, dropped where land or water is in the
 * way - plus one placed by hand beside where a session opens, so the first
 * walk finds one. Walk onto a mouth and you are inside (`realm.ts`).
 *
 * The inside is a pocket, not more planet. The hero keeps his planet point -
 * which is what lets him walk out where he walked in - but while he is in the
 * cave the overworld is not what he walks on: the chamber is a disc of
 * `CHAMBER_RADIUS` tiles round the mouth, and its wall is the one thing that
 * stops him (`chamberBlocked`). The mouth is also the way out: stand on it
 * again, from inside, and you are back under the sky.
 *
 * The mouth's *art* never turns (`cave-entrance-art.ts`): it is a flat 2.5D
 * prop facing the camera from every heading, so whichever way the hero came
 * at it, the opening is the side he sees.
 */

import { blockedGround, nearLake } from "./lakes";
import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "./planet";
import { pixelHash } from "./transforms";

export interface Cave extends PlanetPoint {
  /** Stable across sessions: the cell it was hashed from. */
  readonly id: number;
  readonly seed: number;
}

/** Planet tiles per lattice cell: one candidate mouth in each. */
export const CAVE_CELL = 64;

/** Share of cells that hold a mouth. */
const CAVE_DENSITY = 0.6;

const CAVE_SEED = 0xca7e;

/** Tiles from a mouth's foot within which a walker goes in (or, from inside, out). */
export const CAVE_MOUTH = 0.6;

/** Tiles from the mouth to the chamber's wall. */
export const CHAMBER_RADIUS = 6.5;

/** Tiles round the way out lit by the day behind it. */
export const EXIT_GLOW = 1.25;

/** Tiles a mouth keeps clear of a lake's water. */
const LAKE_BANK = 2;

/**
 * Beside the opening spot (`demo-scene.ts` `START`), a few tiles ahead of
 * where the hero first faces, so the first walk finds a cave.
 */
const LANDMARKS: readonly PlanetPoint[] = [{ x: 128, y: 134 }];

/** Ids at and above this are landmarks rather than lattice cells. */
const LANDMARK_ID = 1 << 16;

let caves: readonly Cave[] | undefined;

/** Every cave on the planet, placed once. */
export function planetCaves(): readonly Cave[] {
  if (caves === undefined) {
    const cells = PLANET_TILES / CAVE_CELL;
    const found: Cave[] = LANDMARKS.map((point, index) => ({
      ...openMouth(point),
      id: LANDMARK_ID + index,
      seed: Math.floor(pixelHash(index, 0, CAVE_SEED, 9) * 0xffff),
    }));
    for (let cellY = 0; cellY < cells; cellY += 1) {
      for (let cellX = 0; cellX < cells; cellX += 1) {
        const cave = caveIn(cellX, cellY);
        if (cave !== undefined && found.every((other) => caveDistance(other, cave) > CHAMBER_RADIUS * 2)) {
          found.push(cave);
        }
      }
    }
    caves = found;
  }
  return caves;
}

/** The mouth one lattice cell holds, if any. */
export function caveIn(cellX: number, cellY: number): Cave | undefined {
  if (pixelHash(cellX, cellY, CAVE_SEED, 1) >= CAVE_DENSITY) {
    return undefined;
  }
  const margin = 4;
  const span = CAVE_CELL - margin * 2;
  const point = {
    x: wrapTile(cellX * CAVE_CELL + margin + pixelHash(cellX, cellY, CAVE_SEED, 2) * span),
    y: wrapTile(cellY * CAVE_CELL + margin + pixelHash(cellX, cellY, CAVE_SEED, 3) * span),
  };
  if (!openForMouth(point)) {
    return undefined;
  }
  return {
    ...point,
    id: cellY * (PLANET_TILES / CAVE_CELL) + cellX,
    seed: Math.floor(pixelHash(cellX, cellY, CAVE_SEED, 4) * 0xffff),
  };
}

/** Whether a mouth may open here: on dry, walkable ground, clear of any lake. */
export function openForMouth(point: PlanetPoint): boolean {
  return !blockedGround(point) && !nearLake(point, LAKE_BANK);
}

/** The nearest point to `near` a mouth may open on, searched outward in rings. */
function openMouth(near: PlanetPoint): PlanetPoint {
  for (let radius = 0; radius < 32; radius += 1) {
    const steps = Math.max(1, radius * 6);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = { x: wrapTile(near.x + Math.cos(angle) * radius), y: wrapTile(near.y + Math.sin(angle) * radius) };
      if (openForMouth(point)) {
        return point;
      }
    }
  }
  return near;
}

/** Tiles from a cave's mouth to a planet point, across the wrap. */
export function caveDistance(cave: PlanetPoint, point: PlanetPoint): number {
  return Math.hypot(wrapDelta(point.x, cave.x), wrapDelta(point.y, cave.y));
}

/** Every cave whose mouth is within `reach` tiles of a point - a square, so it does not depend on the heading. */
export function cavesNear(centre: PlanetPoint, reach: number): Cave[] {
  return planetCaves().filter(
    (cave) => Math.abs(wrapDelta(cave.x, centre.x)) <= reach && Math.abs(wrapDelta(cave.y, centre.y)) <= reach,
  );
}

/** The cave whose mouth a point stands in, if any. */
export function caveMouthAt(point: PlanetPoint): Cave | undefined {
  return planetCaves().find((cave) => caveDistance(cave, point) < CAVE_MOUTH);
}

/** Tiles round a mouth kept clear of trees, rocks and puddles, so nothing stands in front of it. */
export const MOUTH_CLEARING = 2.5;

/** Whether a point is in the clearing before some cave's mouth: no place for a tree or a puddle. */
export function nearCaveMouth(point: PlanetPoint): boolean {
  return planetCaves().some((cave) => caveDistance(cave, point) < MOUTH_CLEARING);
}

/** Whether a point stands in this cave's mouth: the way in from outside, and out from inside. */
export function inMouth(cave: PlanetPoint, point: PlanetPoint): boolean {
  return caveDistance(cave, point) < CAVE_MOUTH;
}

/** Whether a point is past the chamber's wall: what stops a walker inside. */
export function chamberBlocked(cave: PlanetPoint, point: PlanetPoint): boolean {
  return caveDistance(cave, point) > CHAMBER_RADIUS;
}
