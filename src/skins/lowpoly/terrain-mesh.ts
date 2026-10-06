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
  planetLandforms,
  type Landform,
  type LandformField,
} from "../../game/landforms";
import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "../../game/planet";
import { WALL_RISE } from "../../game/projection";
import { terrainAt } from "../../game/terrain";
import { groundCell, groundSurface, SHORE } from "./ground-relief";
import { FLAT_LOOK, type Look } from "./look";
import { Kind, MeshBuilder, mixRgb, type Rgb, type Vec3 } from "./mesh";
import { faceTint, hash01, LOWPOLY, PAINT, seedOf } from "./palette";

const TAU = Math.PI * 2;

/** Tiles across a patch of the painted ground's colour. Divides `PLANET_TILES`, so patches close round the wrap. */
const PATCH_TILES = 4;
const PATCHES = PLANET_TILES / PATCH_TILES;

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
export function groundMesh(solid: MeshBuilder, origin: PlanetPoint, size: number, lakes: readonly Lake[], look: Look = FLAT_LOOK): void {
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const { seed, halves } = groundCell(origin.x + i, origin.y + j, origin, look);
      halves.forEach(([p, q, r], half) => {
        const centre = { x: wrapTile(origin.x + (p[0] + q[0] + r[0]) / 3), y: wrapTile(origin.y + (p[1] + q[1] + r[1]) / 3) };
        const colour = groundFace(groundColour(centre, lakes), centre, seed + half * 17, look);
        solid.tri(p, q, r, { colour, kind: Kind.ground });
      });
    }
  }
}

/**
 * A ground face's colour. Under the painted look its hue leans by *patch* - a
 * few tiles that share one drift colour, edges warped so they are not squares -
 * rather than by face, so the field reads as broad strokes, not confetti; the
 * face keeps its own brightness. The accent is the crowns' alone: a tile-sized
 * dab of it on the ground, every few tiles, was confetti again.
 */
function groundFace(colour: Rgb, centre: PlanetPoint, seed: number, look: Look): Rgb {
  if (look.hueDrift <= 0) {
    return faceTint(colour, seed, look);
  }
  // Whole waves to a lap, so the warp closes on itself at the seam.
  const wx = centre.x + 1.3 * Math.sin((TAU * 37 * centre.y) / PLANET_TILES);
  const wy = centre.y + 1.3 * Math.sin((TAU * 29 * centre.x) / PLANET_TILES);
  const cell = (v: number): number => ((Math.floor(v / PATCH_TILES) % PATCHES) + PATCHES) % PATCHES;
  const patch = seedOf(cell(wx), cell(wy), 0x9a7);
  const drift = PAINT.drift[Math.floor(hash01(patch) * PAINT.drift.length)]!;
  return faceTint(mixRgb(colour, drift, hash01(patch + 1) * look.hueDrift), seed, { ...look, hueDrift: 0 });
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

/** The lattice a landform is meshed on: `cells` squares of `step` tiles a side, from `start` off its centre. */
interface Lattice {
  readonly field: LandformField;
  readonly step: number;
  readonly cells: number;
  readonly start: number;
}

function landformLattice(landform: Landform): Lattice {
  const field = landformField(landform);
  const step = landformStep(landform);
  const cells = Math.ceil((field.half * 2) / step);
  return { field, step, cells, start: -cells * step * 0.5 };
}

/** Height of lattice point `(i, j)`, tiles. */
function latticeHeight(lattice: Lattice, i: number, j: number): number {
  return fieldHeight(lattice.field, lattice.start + i * lattice.step, lattice.start + j * lattice.step) / WALL_RISE;
}

/** A landform as a faceted heightfield over its own footprint. */
export function landformMesh(solid: MeshBuilder, landform: Landform, origin: PlanetPoint, look: Look = FLAT_LOOK): void {
  const lattice = landformLattice(landform);
  const { field, step, cells, start } = lattice;
  const cx = landform.x - origin.x;
  const cy = landform.y - origin.y;
  const vertex = (i: number, j: number): Vec3 => [cx + start + i * step, cy + start + j * step, latticeHeight(lattice, i, j)];
  const rows: Vec3[][] = Array.from({ length: cells + 1 }, (_, j) => Array.from({ length: cells + 1 }, (_, i) => vertex(i, j)));
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = rows[j]![i]!;
      const b = rows[j]![i + 1]!;
      const c = rows[j + 1]![i + 1]!;
      const d = rows[j + 1]![i]!;
      // The split `standingHeight` reads back: keep the two in step.
      for (const [p, q, r] of [[a, b, c], [a, c, d]] as const) {
        if (p[2] < FLAT && q[2] < FLAT && r[2] < FLAT) {
          continue;
        }
        const mx = (p[0] + q[0] + r[0]) / 3 - cx;
        const my = (p[1] + q[1] + r[1]) / 3 - cy;
        const sample = fieldSample(field, mx, my);
        const material = sample < 0 ? ROCK : (field.materials[sample] ?? ROCK);
        const colour = faceTint(materialColour(material, landform.kind), seedOf(landform.seed, i, j, r === c ? 0 : 1), look);
        // A heightfield's normal always has some up in it: face away from a point far below.
        solid.tri(p, q, r, { colour, kind: Kind.body, inside: [mx + cx, my + cy, -1000] });
      }
    }
  }
}

/**
 * How high the drawn land stands under a planet point, tiles: 0 on the flat
 * look's open ground, the hill under it on the painted look's.
 *
 * The hero may walk onto a landform's lower slope - anything under
 * `BLOCK_HEIGHT` - and the slope is drawn there as facets, so a foot left at
 * height 0 is buried in them. This is where a body's foot goes instead: the
 * facets' own height, read off the lattice and split `landformMesh` draws,
 * not the smoother field between them, so the foot is on what is on screen.
 * The ground's own facets are read the same way (`groundSurface`).
 */
export function standingHeight(point: PlanetPoint, look: Look = FLAT_LOOK): number {
  let tallest = groundSurface(point, look);
  for (const landform of planetLandforms()) {
    const dx = wrapDelta(point.x, landform.x);
    const dy = wrapDelta(point.y, landform.y);
    if (Math.abs(dx) > landform.radius + 3 || Math.abs(dy) > landform.radius + 3) {
      continue;
    }
    tallest = Math.max(tallest, facetHeight(landformLattice(landform), dx, dy));
  }
  return tallest;
}

/** The drawn facet's height at an offset from a landform's centre, tiles. */
function facetHeight(lattice: Lattice, dx: number, dy: number): number {
  const u = (dx - lattice.start) / lattice.step;
  const v = (dy - lattice.start) / lattice.step;
  if (u < 0 || v < 0 || u > lattice.cells || v > lattice.cells) {
    return 0;
  }
  const i = Math.min(Math.floor(u), lattice.cells - 1);
  const j = Math.min(Math.floor(v), lattice.cells - 1);
  const fu = u - i;
  const fv = v - j;
  const a = latticeHeight(lattice, i, j);
  const c = latticeHeight(lattice, i + 1, j + 1);
  // Triangle a-b-c below the diagonal, a-c-d above it.
  const [side, along, across] = fu >= fv ? [latticeHeight(lattice, i + 1, j), fu, fv] : [latticeHeight(lattice, i, j + 1), fv, fu];
  if (a < FLAT && side < FLAT && c < FLAT) {
    return 0;
  }
  return a + (side - a) * along + (c - side) * across;
}
