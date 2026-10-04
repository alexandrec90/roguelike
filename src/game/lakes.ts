/**
 * Lakes and ponds: standing water too big to be a puddle.
 *
 * A lake is drawn exactly as a puddle is - a seeded outline grown by
 * `createPuddle`, its body, glints, reflections and rain rings all from
 * `puddles.ts` and `water/` - so everything water already does, it does. What
 * this module adds is the planet's half: where the lakes are, and what they do
 * to anything walking.
 *
 * **Where.** One candidate per `LAKE_CELL` square of planet, jittered inside it
 * and kept clear of its neighbours, the way `landforms.ts` places mountains -
 * but on a lattice offset half a cell from theirs, so the two fall between each
 * other, and a candidate whose shore or bank would touch a landform is dropped.
 * Nothing else grows inside one: `terrain.ts` asks `nearLake` before it places
 * any feature, so no tree stands in the water and no puddle lies on it.
 *
 * **Deep and shallow.** The outline belongs to the screen, and the camera turns
 * with the hero, so the only promise a lake can make in planet coordinates is a
 * disc: its water covers at least `shore` tiles round its centre whichever way
 * the world has turned (`outlineExtent`). Inside that, a lake carries a deep
 * core - another disc, `deep` tiles across, drawn darker (a disc on the ground
 * is the same foreshortened ellipse from every heading, so the picture and the
 * rule always agree) - that nothing can wade into (`deepWater`). Between the
 * two is the shallows, where the hero wades, sinking deeper the farther in he
 * goes (`wadeDepth`). A pond is too small to have a core: wade straight across.
 */

import { landHeightAt, blockedByLand } from "./landforms";
import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "./planet";
import { TILE_WIDTH } from "./projection";
import { outlineExtent } from "./puddles";
import { pixelHash } from "./transforms";

export interface Lake extends PlanetPoint {
  /** Stable per lake, so its shore is the same every time it is grown. */
  readonly seed: number;
  /** Half-width of its outline before the shore's lobes, logical pixels: a puddle's `radius`. */
  readonly size: number;
  /** Half-width of its deep core, logical pixels; 0 for a pond. */
  readonly deepSize: number;
  /** Farthest its water reaches from the centre, tiles, whichever way the world has turned. */
  readonly reach: number;
  /** Nearest its shore comes to the centre, tiles, whichever way the world has turned. */
  readonly shore: number;
  /** Radius of the deep core, tiles; 0 for a pond. */
  readonly deep: number;
}

/** Planet tiles per side of one lake's cell: 256 divides into eight. */
export const LAKE_CELL = 32;

/** How deep compared to how wide a lake lies: round, where a puddle is a lens. */
export const LAKE_SPREAD = 1;

const LAKE_SEED = 0x1a4e;

/** Share of cells that hold water. */
const LAKE_DENSITY = 0.75;

/** Base half-widths, tiles. Below `DEEP_FROM` the water is a pond, shallow throughout. */
const MIN_RADIUS = 1.5;
const MAX_RADIUS = 5;
const DEEP_FROM = 2.75;

/**
 * The shallows kept between the nearest shore and the deep core, tiles: enough
 * to wade a step or two in from any side before the bottom drops away.
 */
const WADE_BAND = 1.1;

/** Clear ground round a lake, tiles: no landform, tree, den or campfire this close to its water. */
export const LAKE_BANK = 1.5;

/**
 * The farthest any lake's water reaches from its centre, tiles: the widest
 * outline, its lobes at their fullest, and the damp ring round it. How much
 * farther than a layer's own reach it must sweep for lake centres.
 */
export const LAKE_MAX_REACH = MAX_RADIUS * 1.4 + 0.25;

/** Kept out of the cell's edge so two neighbours' banks never meet. */
const CELL_MARGIN = LAKE_MAX_REACH + LAKE_BANK;

/** Where the lake lattice starts: half a cell off the landforms', so the two fall between each other. */
const LATTICE_OFFSET = LAKE_CELL / 2;

let lakes: readonly Lake[] | undefined;

/** Every lake on the planet, placed once. */
export function planetLakes(): readonly Lake[] {
  if (lakes === undefined) {
    const cells = PLANET_TILES / LAKE_CELL;
    const found: Lake[] = [];
    for (let cellY = 0; cellY < cells; cellY += 1) {
      for (let cellX = 0; cellX < cells; cellX += 1) {
        const lake = lakeIn(cellX, cellY);
        if (lake !== undefined) {
          found.push(lake);
        }
      }
    }
    lakes = found;
  }
  return lakes;
}

/** The lake one cell holds, if any: hashed, jittered, sized, and dropped if land is in the way. */
export function lakeIn(cellX: number, cellY: number): Lake | undefined {
  if (pixelHash(cellX, cellY, LAKE_SEED, 1) >= LAKE_DENSITY) {
    return undefined;
  }
  const span = LAKE_CELL - CELL_MARGIN * 2;
  const x = wrapTile(LATTICE_OFFSET + cellX * LAKE_CELL + CELL_MARGIN + pixelHash(cellX, cellY, LAKE_SEED, 2) * span);
  const y = wrapTile(LATTICE_OFFSET + cellY * LAKE_CELL + CELL_MARGIN + pixelHash(cellX, cellY, LAKE_SEED, 3) * span);
  const radius = MIN_RADIUS + pixelHash(cellX, cellY, LAKE_SEED, 4) * (MAX_RADIUS - MIN_RADIUS);
  const seed = Math.floor(pixelHash(cellX, cellY, LAKE_SEED, 5) * 0xffff);
  const size = Math.round(radius * TILE_WIDTH);
  const { nearest, farthest } = outlineExtent(size, seed, LAKE_SPREAD);
  const deep = radius >= DEEP_FROM ? Math.max(0, nearest - WADE_BAND) : 0;
  const lake: Lake = {
    x,
    y,
    seed,
    size,
    deepSize: Math.round(deep * TILE_WIDTH),
    // The damp ring round the water reaches a pixel or two farther.
    reach: farthest + 0.15,
    shore: nearest,
    deep: Math.round(deep * TILE_WIDTH) / TILE_WIDTH,
  };
  return landNear(lake) ? undefined : lake;
}

/** Whether any landform stands on the lake or its bank: sampled on rings out to the bank's edge. */
function landNear(lake: Lake): boolean {
  const outer = lake.reach + LAKE_BANK;
  if (landHeightAt(lake) > 0) {
    return true;
  }
  for (const share of [0.5, 1]) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      const point = {
        x: wrapTile(lake.x + Math.cos(angle) * outer * share),
        y: wrapTile(lake.y + Math.sin(angle) * outer * share),
      };
      if (landHeightAt(point) > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Every lake whose centre is within `reach` tiles of a planet point - a square,
 * so it does not depend on which way the hero faces. A layer that wants every
 * lake whose *water* it can see sweeps `LAKE_MAX_REACH` farther.
 */
export function lakesNear(centre: PlanetPoint, reach: number): Lake[] {
  return planetLakes().filter(
    (lake) => Math.abs(wrapDelta(lake.x, centre.x)) <= reach && Math.abs(wrapDelta(lake.y, centre.y)) <= reach,
  );
}

/** Tiles from a lake's centre to a planet point, across the wrap. */
export function lakeDistance(lake: PlanetPoint, point: PlanetPoint): number {
  return Math.hypot(wrapDelta(point.x, lake.x), wrapDelta(point.y, lake.y));
}

/** Whether a point is within `bank` tiles of any lake's water - no place for a tree, a den or a fire. */
export function nearLake(point: PlanetPoint, bank = 0): boolean {
  return planetLakes().some((lake) => lakeDistance(lake, point) < lake.reach + bank);
}

/** Whether a point is in a lake's deep core: too deep to wade. */
export function deepWater(point: PlanetPoint): boolean {
  return planetLakes().some((lake) => lake.deep > 0 && lakeDistance(lake, point) < lake.deep);
}

/** What stops a walker: land too steep to climb, or water too deep to wade. */
export function blockedGround(point: PlanetPoint): boolean {
  return deepWater(point) || blockedByLand(point);
}

/**
 * How far into a lake's shallows a point is, 0..1: 0 at its nearest shore (or
 * outside any lake), 1 at the edge of the deep core. A pond, which has none,
 * never gets past halfway. The water drawn on screen says *whether* a foot is
 * wet - this says how deep, which only a lake can.
 */
export function wadeDepth(point: PlanetPoint): number {
  let deepest = 0;
  for (const lake of planetLakes()) {
    const distance = lakeDistance(lake, point);
    if (distance >= lake.reach) {
      continue;
    }
    const floor = lake.deep > 0 ? lake.deep : 0;
    const share = (lake.shore - distance) / Math.max(lake.shore - floor, 0.01);
    const depth = Math.min(Math.max(share, 0), 1) * (lake.deep > 0 ? 1 : 0.5);
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}

/**
 * The nearest point to `near` that is open and dry: not in a landform, and not
 * in or beside a lake. `openGround`, with water - for a spawn or a campfire.
 */
export function dryGround(near: PlanetPoint): PlanetPoint {
  for (let radius = 0; radius < 64; radius += 1) {
    const steps = Math.max(1, radius * 6);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = {
        x: wrapTile(near.x + radius * Math.cos(angle)),
        y: wrapTile(near.y + radius * Math.sin(angle)),
      };
      if (!blockedByLand(point) && !nearLake(point, 1)) {
        return point;
      }
    }
  }
  return near;
}
