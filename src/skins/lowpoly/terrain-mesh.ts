/**
 * The ground and the landforms, as faceted geometry over the planet. A lake is
 * not geometry: the ground shader draws its water (`water-texels.ts`), as it
 * draws a puddle, so it bends over the horizon's lip with the ground under it.
 *
 * Nothing is decided here about *where* anything is: grass or path is
 * `terrainAt`, a lake is `planetLakes`, a mountain's every height is its
 * `landformField` - the very grid the pixel skin marches and the hero collides
 * with. So a cliff you cannot walk up is exactly where this skin draws one.
 *
 * Every coordinate is planet tiles from a chunk's origin (`world-chunks.ts`),
 * so a chunk can be placed anywhere round the wrap by moving its origin.
 */

import { lakeDistance, type Lake } from "../../game/lakes";
import {
  CLIFF,
  GRASS,
  landformField,
  ROCK,
  ROOF,
  SNOW,
  WALL,
  fieldHeight,
  fieldSample,
  type Landform,
} from "../../game/landforms";
import { PLANET_TILES, wrapTile, type PlanetPoint } from "../../game/planet";
import { WALL_RISE } from "../../game/projection";
import { terrainAt } from "../../game/terrain";
import { Kind, MeshBuilder, mixRgb, type Rgb, type Vec3 } from "./mesh";
import { faceTint, hash01, LOWPOLY, seedOf } from "./palette";

/** How far a ground vertex may wander off its lattice point, tiles: enough to break the grid. */
const GROUND_JITTER = 0.32;
/** How far up or down, tiles: a whisper of relief so facets catch the light, never enough to float a foot. */
const GROUND_RELIEF = 0.035;
/** Shore sand round a lake's water, tiles. */
const SHORE = 0.9;

const TAU = Math.PI * 2;

/**
 * A ground vertex: the lattice point at planet `(px, py)`, jittered by a hash
 * of its *wrapped* coordinates - so the chunk on either side of a seam puts the
 * shared vertex in the same place, and the planet's wrap has no crack.
 */
function groundVertex(px: number, py: number, origin: PlanetPoint): Vec3 {
  const wx = wrapTile(px);
  const wy = wrapTile(py);
  const seed = seedOf(wx, wy, 0x9e0);
  return [
    px - origin.x + (hash01(seed) * 2 - 1) * GROUND_JITTER,
    py - origin.y + (hash01(seed + 1) * 2 - 1) * GROUND_JITTER,
    (hash01(seed + 2) * 2 - 1) * GROUND_RELIEF,
  ];
}

/** A slow, seamless variation over the planet, 0..1: where the grass is a little drier. */
function dryness(point: PlanetPoint): number {
  const u = (TAU * point.x) / PLANET_TILES;
  const v = (TAU * point.y) / PLANET_TILES;
  return 0.5 + 0.25 * Math.sin(3 * u + 2 * v) + 0.25 * Math.sin(5 * v - 4 * u + 1.3);
}

/**
 * What the ground is at a planet point, as this skin colours it. A lake's bed is
 * its shore's sand: the ground shader draws the water over it as it draws a
 * puddle over grass (`waterAt`), so a face the shore line cuts through is sand
 * on both sides of it rather than a block of bed colour out on the bank.
 */
export function groundColour(point: PlanetPoint, lakes: readonly Lake[]): Rgb {
  for (const lake of lakes) {
    if (lakeDistance(lake, point) < lake.reach + SHORE) {
      return LOWPOLY.shore;
    }
  }
  if (terrainAt(point) === "dirt") {
    return LOWPOLY.path;
  }
  const dry = Math.max(0, dryness(point) - 0.55) * 1.6;
  return mixRgb(LOWPOLY.grass, LOWPOLY.grassDry, Math.min(dry, 0.7));
}

/** A `size`-tile square of ground with its corner at `origin`, two faceted triangles a tile. */
export function groundMesh(solid: MeshBuilder, origin: PlanetPoint, size: number, lakes: readonly Lake[]): void {
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const px = origin.x + i;
      const py = origin.y + j;
      const a = groundVertex(px, py, origin);
      const b = groundVertex(px + 1, py, origin);
      const c = groundVertex(px + 1, py + 1, origin);
      const d = groundVertex(px, py + 1, origin);
      // Alternate the diagonal by hash, so the field is triangles, not a quilt.
      const seed = seedOf(wrapTile(px), wrapTile(py), 0x7a1);
      const halves: [Vec3, Vec3, Vec3][] = hash01(seed) < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      halves.forEach(([p, q, r], half) => {
        const centre = { x: wrapTile(origin.x + (p[0] + q[0] + r[0]) / 3), y: wrapTile(origin.y + (p[1] + q[1] + r[1]) / 3) };
        const colour = faceTint(groundColour(centre, lakes), seed + half * 17);
        solid.tri(p, q, r, { colour, kind: Kind.ground });
      });
    }
  }
}

/** A landform's surface colour, by the material its field says it is. */
function materialColour(material: number, kind: Landform["kind"]): Rgb {
  switch (material) {
    case GRASS:
      return kind === "mesa" ? LOWPOLY.mesaTop : LOWPOLY.grass;
    case ROCK:
      return LOWPOLY.rock;
    case SNOW:
      return LOWPOLY.snow;
    case CLIFF:
      return LOWPOLY.cliff;
    case WALL:
      return LOWPOLY.wall;
    case ROOF:
      return LOWPOLY.roof;
    default:
      return LOWPOLY.rockDark;
  }
}

/** Below this, tiles, a landform's face is the ground's business and is not drawn. */
const FLAT = 0.02;

/**
 * The tiles between samples a landform is meshed at: coarse on a mountain,
 * where big facets are the look, fine on a tower, which needs its walls.
 */
export function landformStep(landform: Landform): number {
  return Math.min(Math.max(landform.radius / 9, 0.3), 1.25);
}

/** A landform as a faceted heightfield over its own footprint. */
export function landformMesh(solid: MeshBuilder, landform: Landform, origin: PlanetPoint): void {
  const field = landformField(landform);
  const step = landformStep(landform);
  const cells = Math.ceil((field.half * 2) / step);
  const start = -cells * step * 0.5;
  const cx = landform.x - origin.x;
  const cy = landform.y - origin.y;
  const vertex = (i: number, j: number): Vec3 => {
    const dx = start + i * step;
    const dy = start + j * step;
    return [cx + dx, cy + dy, fieldHeight(field, dx, dy) / WALL_RISE];
  };
  const rows: Vec3[][] = Array.from({ length: cells + 1 }, (_, j) => Array.from({ length: cells + 1 }, (_, i) => vertex(i, j)));
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = rows[j]![i]!;
      const b = rows[j]![i + 1]!;
      const c = rows[j + 1]![i + 1]!;
      const d = rows[j + 1]![i]!;
      for (const [p, q, r] of [[a, b, c], [a, c, d]] as const) {
        if (p[2] < FLAT && q[2] < FLAT && r[2] < FLAT) {
          continue;
        }
        const mx = (p[0] + q[0] + r[0]) / 3 - cx;
        const my = (p[1] + q[1] + r[1]) / 3 - cy;
        const sample = fieldSample(field, mx, my);
        const material = sample < 0 ? ROCK : (field.materials[sample] ?? ROCK);
        const colour = faceTint(materialColour(material, landform.kind), seedOf(landform.seed, i, j, r === c ? 0 : 1));
        // A heightfield's normal always has some up in it: face away from a point far below.
        solid.tri(p, q, r, { colour, kind: Kind.body, inside: [mx + cx, my + cy, -1000] });
      }
    }
  }
}
