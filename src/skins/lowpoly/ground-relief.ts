/**
 * The height field of the ground this skin draws: a lattice of planet points,
 * each jittered off its grid and lifted by the look's hills. How the points are
 * joined into faces - and so where a foot stands - is `ground-facets.ts`.
 *
 * The hills are the painted look's (`look.ts`); the flat look keeps the field
 * level but for a hair of relief, exactly as before. Hills are a picture, not
 * terrain: nothing walks slower up one, and every placement is still the shared
 * simulation's.
 *
 * Three places stay level because something else lies on them flat:
 *
 * | Where | Why |
 * | --- | --- |
 * | a puddle's basin (`basinAt`) | water is drawn on the ground and mirrored about height 0; a tilted puddle would show the world displaced |
 * | a lake and its shore | the same, at lake size |
 * | round a landform's foot | its mesh starts at height 0; a hill there would poke through its lower slope |
 *
 * So the hills rise where the ground is driest - which is where they would be:
 * the puddles collect in the hollows between them.
 */

import { lakeDistance, planetLakes } from "../../game/lakes";
import { planetLandforms } from "../../game/landforms";
import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "../../game/planet";
import { terrainAt } from "../../game/terrain";
import { basinAt } from "../../game/water/puddle-field";
import type { Look } from "./look";
import type { Vec3 } from "./mesh";
import { hash01, seedOf } from "./palette";

/** How far a ground vertex may wander off its lattice point, tiles: enough to break the grid. */
const GROUND_JITTER = 0.32;

/** Shore sand round a lake's water, tiles. */
export const SHORE = 0.9;

/** A basin this full is level ground: water may stand at the next (`SOAKED_LEVEL` is 0.62). */
const WET_BASIN = 0.58;
/** A basin this empty is ground at its tallest. */
const DRY_BASIN = 0.3;
/** Above this the ground's relief starts to settle, so a puddle's rim is flat before its water. */
const DAMP_BASIN = 0.46;

/** Tiles over which the ground settles to level beside a landform's footprint, and a lake's shore. */
const LANDFORM_SETTLE = 5;
const LAKE_SETTLE = 4;

/** Rolling cells a planet lap: the slow swell that makes one hill taller than the next. */
const ROLL_CELLS = 24;

/**
 * Per lattice point: how tall a hill stands there (0..1), how free it is to
 * wobble at all, and how far it is from settling for a lake or a landform.
 */
interface Relief {
  readonly hill: Float32Array;
  readonly calm: Float32Array;
  readonly away: Float32Array;
}

let relief: Relief | undefined;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Smooth value noise on a wrapping lattice of `cells` a lap: seamless at the planet's seam. */
function rolling(x: number, y: number): number {
  const u = (x / PLANET_TILES) * ROLL_CELLS;
  const v = (y / PLANET_TILES) * ROLL_CELLS;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const at = (a: number, b: number): number => hash01(seedOf(((a % ROLL_CELLS) + ROLL_CELLS) % ROLL_CELLS, ((b % ROLL_CELLS) + ROLL_CELLS) % ROLL_CELLS, 0x4111));
  const fx = smoothstep(0, 1, u - i);
  const fy = smoothstep(0, 1, v - j);
  const near = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
  const far = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
  return near + (far - near) * fy;
}

/**
 * The whole planet's lattice, worked out on first use and kept. Each landform
 * and lake settles the points round its own footprint, rather than every point
 * asking every one of them - `puddle-field.ts`'s trick.
 */
function planetRelief(): Relief {
  if (relief !== undefined) {
    return relief;
  }
  const size = PLANET_TILES * PLANET_TILES;
  const away = new Float32Array(size).fill(1);
  const settle = (cx: number, cy: number, reach: number, factor: (point: PlanetPoint) => number): void => {
    for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y += 1) {
      for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x += 1) {
        const wx = wrapTile(x);
        const wy = wrapTile(y);
        const index = wy * PLANET_TILES + wx;
        away[index] = away[index]! * factor({ x: wx, y: wy });
      }
    }
  };
  for (const landform of planetLandforms()) {
    const reach = landform.radius + 2 + LANDFORM_SETTLE;
    settle(landform.x, landform.y, reach, (p) =>
      smoothstep(landform.radius + 2, reach, Math.hypot(wrapDelta(p.x, landform.x), wrapDelta(p.y, landform.y))),
    );
  }
  for (const lake of planetLakes()) {
    const reach = lake.reach + SHORE + LAKE_SETTLE;
    settle(lake.x, lake.y, reach, (p) => smoothstep(lake.reach + SHORE, reach, lakeDistance(lake, p)));
  }
  const hill = new Float32Array(size);
  const calm = new Float32Array(size);
  for (let y = 0; y < PLANET_TILES; y += 1) {
    for (let x = 0; x < PLANET_TILES; x += 1) {
      const index = y * PLANET_TILES + x;
      const point = { x, y };
      const basin = basinAt(point, terrainAt(point) === "dirt");
      calm[index] = away[index]! * (1 - smoothstep(DAMP_BASIN, WET_BASIN, basin));
      hill[index] = away[index]! * (1 - smoothstep(DRY_BASIN, WET_BASIN, basin)) * (0.55 + 0.45 * rolling(x, y));
    }
  }
  relief = { hill, calm, away };
  return relief;
}

/**
 * The lattice point at planet `(px, py)` - whole tiles, unwrapped - jittered by
 * a hash of its *wrapped* coordinates, so the chunk on either side of a seam
 * puts the shared point in the same place, and the planet's wrap has no crack.
 * Its height is the look's hill there plus its own wobble. This is the raw
 * point; `ground-facets.ts` may slide it onto a merged plane's edge.
 */
export function latticeVertex(px: number, py: number, look: Look): Vec3 {
  const wx = wrapTile(px);
  const wy = wrapTile(py);
  const seed = seedOf(wx, wy, 0x9e0);
  const wobble = (hash01(seed + 2) * 2 - 1) * look.relief;
  let lift = wobble;
  if (look.hills > 0) {
    const { hill, calm } = planetRelief();
    const index = wy * PLANET_TILES + wx;
    lift = look.hills * hill[index]! + wobble * calm[index]!;
  }
  return [px + (hash01(seed) * 2 - 1) * GROUND_JITTER, py + (hash01(seed + 1) * 2 - 1) * GROUND_JITTER, lift];
}

/**
 * How free the ground at lattice point `(px, py)` is to wobble, 0..1: 0 where
 * water can stand or beside a lake or a landform, 1 on dry open ground.
 */
export function calmAt(px: number, py: number): number {
  return planetRelief().calm[wrapTile(py) * PLANET_TILES + wrapTile(px)]!;
}

/** Samples a tile, each way, at which `freeToTilt` asks whether water could stand. */
const TILT_SAMPLES = 2;

/**
 * Whether the `size`-tile square at lattice point `(x0, y0)` may be drawn as a
 * plane - or bumped - away from the hills under it: no water can stand anywhere
 * in it, asked every half tile, since a tilted puddle would mirror the world
 * displaced; and none of its points is on a landform's foot or a lake's shore,
 * where the ground is held at 0 - a plane there would stand over the foot. The
 * band where the ground settles toward one is fine: it is low there already.
 */
export function freeToTilt(x0: number, y0: number, size: number): boolean {
  const { away } = planetRelief();
  for (let j = 0; j <= size; j += 1) {
    for (let i = 0; i <= size; i += 1) {
      if (away[wrapTile(y0 + j) * PLANET_TILES + wrapTile(x0 + i)]! <= 0) {
        return false;
      }
    }
  }
  for (let j = 0; j <= size * TILT_SAMPLES; j += 1) {
    for (let i = 0; i <= size * TILT_SAMPLES; i += 1) {
      const point = { x: wrapTile(x0 + i / TILT_SAMPLES), y: wrapTile(y0 + j / TILT_SAMPLES) };
      if (basinAt(point, terrainAt(point) === "dirt") >= WET_BASIN) {
        return false;
      }
    }
  }
  return true;
}
