/**
 * Landforms: the tall things the planet is shaped into - mountains, mesas, rock
 * spires and towers.
 *
 * The ground used to stand up in tiles: a cell above a threshold of the
 * elevation field became a block, a cap and a face on the screen grid. A block
 * is a grid thing on a planet that has no grid, and it showed: an outcrop was
 * a staircase of squares, it floated over the horizon on the field's last rows,
 * and a strafe swapped which cells were in it. So the ground is flat now, and
 * anything with height is a *shape* at a planet point - one seeded height
 * function, `h(dx, dy)` in pixels over its footprint - drawn by the projection
 * every other body is drawn by (`landform-render.ts`). Walk round a tower and
 * its windows turn past you; walk toward a mountain and it rises over the
 * horizon, grows, and stands over the field as a real slope you can stand at
 * the foot of.
 *
 * Each landform's height and surface are evaluated once onto a small grid in
 * its own planet-fixed frame (`landformField`), so drawing it is a lookup, and
 * so is asking whether a point is blocked.
 *
 * Placement is a jittered lattice of `LANDFORM_CELL`-tile cells, one landform
 * at most per cell, kept inside its cell so two never overlap. Pure and seeded.
 */

import { PLANET_TILES, wrapDelta, wrapTile, type PlanetPoint } from "./planet";

export type LandformKind = "mountain" | "mesa" | "spire" | "tower";

export interface Landform {
  readonly id: string;
  readonly kind: LandformKind;
  /** Planet point of its centre. */
  readonly x: number;
  readonly y: number;
  /** Footprint radius, in tiles. */
  readonly radius: number;
  /** Peak height, in pixels at full size. */
  readonly height: number;
  readonly seed: number;
}

/** Tiles per side of a placement cell: an 8 x 8 lattice on a 256-tile planet. */
export const LANDFORM_CELL = 32;

/** Height above which a point is too steep to stand on, in pixels. */
export const BLOCK_HEIGHT = 6;

const LANDFORM_SEED = 0x1a4d;

interface KindSpec {
  readonly kind: LandformKind;
  /** Upper bound of this kind's share of the lattice, cumulative. */
  readonly upTo: number;
  readonly radius: readonly [number, number];
  readonly height: readonly [number, number];
}

const KINDS: readonly KindSpec[] = [
  { kind: "mountain", upTo: 0.3, radius: [9, 13], height: [250, 380] },
  { kind: "mesa", upTo: 0.52, radius: [4, 6.5], height: [64, 112] },
  { kind: "spire", upTo: 0.78, radius: [1.7, 2.7], height: [96, 170] },
  { kind: "tower", upTo: 0.94, radius: [1.5, 2], height: [150, 210] },
];

function hashUnit(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(y ^ seed, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function between(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

let planet: readonly Landform[] | undefined;

/** Every landform on the planet: a few dozen, worked out once. */
export function planetLandforms(): readonly Landform[] {
  if (planet !== undefined) {
    return planet;
  }
  const found: Landform[] = [];
  const cells = Math.round(PLANET_TILES / LANDFORM_CELL);
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      const roll = hashUnit(cx, cy, LANDFORM_SEED);
      const spec = KINDS.find((kind) => roll < kind.upTo);
      if (spec === undefined) {
        continue;
      }
      const radius = between(spec.radius, hashUnit(cx, cy, LANDFORM_SEED ^ 0x11));
      const room = LANDFORM_CELL / 2 - radius - 2;
      const jitter = (salt: number): number => (hashUnit(cx, cy, LANDFORM_SEED ^ salt) * 2 - 1) * room;
      found.push({
        id: `${spec.kind}-${cx}-${cy}`,
        kind: spec.kind,
        x: wrapTile((cx + 0.5) * LANDFORM_CELL + jitter(0x22)),
        y: wrapTile((cy + 0.5) * LANDFORM_CELL + jitter(0x33)),
        radius,
        height: Math.round(between(spec.height, hashUnit(cx, cy, LANDFORM_SEED ^ 0x44))),
        seed: Math.floor(hashUnit(cx, cy, LANDFORM_SEED ^ 0x55) * 0xffffff),
      });
    }
  }
  planet = found;
  return found;
}

/** Every landform whose footprint comes within `reach` tiles of a point. */
export function landformsNear(centre: PlanetPoint, reach: number): Landform[] {
  return planetLandforms().filter(
    (landform) => Math.hypot(wrapDelta(landform.x, centre.x), wrapDelta(landform.y, centre.y)) <= reach + landform.radius,
  );
}

// --- The shape --------------------------------------------------------------

/** Surface materials; what colour each is in is `landform-render.ts`'s business. */
export const GRASS = 0;
export const ROCK = 1;
export const SNOW = 2;
export const CLIFF = 3;
export const WALL = 4;
export const ROOF = 5;

export type Material = typeof GRASS | typeof ROCK | typeof SNOW | typeof CLIFF | typeof WALL | typeof ROOF;

/** A smooth, seeded function of the angle round a landform, 0..1, closing on itself. */
function angular(seed: number, lobes: number): (theta: number) => number {
  const values = Array.from({ length: lobes }, (_unused, index) => hashUnit(index, 7, seed));
  return (theta) => {
    const u = (((theta / (Math.PI * 2)) % 1) + 1) % 1 * lobes;
    const i = Math.floor(u);
    const f = u - i;
    const s = f * f * (3 - 2 * f);
    const a = values[i % lobes] ?? 0;
    const b = values[(i + 1) % lobes] ?? 0;
    return a + (b - a) * s;
  };
}

/** Value noise in the landform's own frame, for small rugged detail. */
function rugged(seed: number): (x: number, y: number) => number {
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number): number => hashUnit(x0 + i, y0 + j, seed);
    const near = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
    const far = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
    return near + (far - near) * sy;
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The height function of one landform: pixels above the ground at a planet
 * offset (`dx`, `dy`, tiles) from its centre. Zero outside the footprint.
 */
export function landformShape(landform: Landform): (dx: number, dy: number) => number {
  const { radius: R, height: H, seed } = landform;
  const outline = angular(seed, 9);
  const crags = angular(seed ^ 0x5a, 23);
  const bumps = rugged(seed ^ 0x77);
  const volcano = isVolcano(landform);
  switch (landform.kind) {
    case "mountain": {
      // A main peak and two shoulders, each a cone whose radius wanders with
      // the angle, so the outline is a ridge line rather than a circle.
      const shoulders = [0, 1].map((index) => {
        const angle = hashUnit(index, 1, seed) * Math.PI * 2;
        const distance = R * (0.32 + 0.18 * hashUnit(index, 2, seed));
        return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, h: 0.5 + 0.2 * hashUnit(index, 3, seed) };
      });
      // Spurs: ridges running down from the summit, the valleys between them
      // cut in, so a slope breaks into lit and shaded planes and the skyline
      // into notches - what makes a cone read as a mountain.
      const spurs = 5 + Math.floor(hashUnit(4, 4, seed) * 4);
      const twist = hashUnit(6, 6, seed) * Math.PI * 2;
      return (dx, dy) => {
        const theta = Math.atan2(dy, dx);
        const r = Math.hypot(dx, dy);
        const reach = R * (0.7 + 0.3 * outline(theta));
        let h = H * clamp01(1 - r / reach) ** 1.25;
        for (const shoulder of shoulders) {
          const near = clamp01(1 - Math.hypot(dx - shoulder.x, dy - shoulder.y) / (R * 0.5));
          h = Math.max(h, H * shoulder.h * near ** 1.4);
        }
        if (h <= 0) {
          return 0;
        }
        const ridge = Math.abs(Math.sin(theta * spurs + twist + r * 0.35));
        const valley = 1 - 0.22 * (1 - ridge) * clamp01(r / (R * 0.25));
        const rough = h * valley * (0.92 + 0.1 * crags(theta) + 0.08 * bumps(dx * 0.8, dy * 0.8));
        return volcano ? crater(rough, r, R, H) : rough;
      };
    }
    case "mesa":
      // A flat top that ends at a cliff, with a scree apron at its foot.
      return (dx, dy) => {
        const r = Math.hypot(dx, dy);
        const edge = R * (0.78 + 0.22 * outline(Math.atan2(dy, dx)));
        const cliff = clamp01((edge - r) / 0.45);
        const top = H * (cliff * cliff * (3 - 2 * cliff)) * (0.97 + 0.06 * bumps(dx, dy));
        const apron = H * 0.12 * clamp01(1 - (r - edge + 0.4) / 1.5);
        return r > R + 1 ? 0 : Math.max(top, apron);
      };
    case "spire":
      return (dx, dy) => {
        const theta = Math.atan2(dy, dx);
        const reach = R * (0.7 + 0.3 * outline(theta));
        const t = clamp01(1 - Math.hypot(dx, dy) / reach);
        return t <= 0 ? 0 : H * t ** 0.8 * (0.82 + 0.3 * crags(theta));
      };
    case "tower": {
      const roofed = isRoofed(landform);
      const merlons = 4 * Math.round(2 * R);
      return (dx, dy) => {
        const r = Math.hypot(dx, dy);
        if (r > R) {
          return 0;
        }
        if (roofed) {
          return H + R * 20 * (1 - r / R);
        }
        const rim = r > R - 0.4;
        const theta = Math.atan2(dy, dx);
        const merlon = Math.floor(((theta / (Math.PI * 2) + 1) % 1) * merlons) % 2 === 0;
        return rim && merlon ? H + 9 : H;
      };
    }
  }
}

/** A landform evaluated onto a grid in its own planet-fixed frame. */
export interface LandformField {
  readonly landform: Landform;
  /** Samples per tile. */
  readonly res: number;
  /** Samples per side; sample (i, j) is at offset `(i / res - half, j / res - half)` tiles. */
  readonly size: number;
  readonly half: number;
  readonly heights: Float32Array;
  /** The surface normal per sample, planet frame, x and y (z is the rest of a unit). */
  readonly normalX: Float32Array;
  readonly normalY: Float32Array;
  readonly materials: Uint8Array;
  /**
   * A seeded nudge to how lit each sample looks, -1..1: the crags, ledges and
   * lichen patches that break a slope into planes. Fixed to the planet, so it
   * turns with the landform and never crawls.
   */
  readonly detail: Float32Array;
  /** The tallest sample. */
  readonly peak: number;
  /**
   * The tallest the land gets within each tile-sized block (and its border), so
   * a march can skip the exact lookup wherever even the block's tallest could
   * not show. `blocks` per side, block `(bi, bj)` covering samples from
   * `bi * res` and `bj * res`.
   */
  readonly blocks: number;
  readonly blockMax: Float32Array;
}

const RES: Readonly<Record<LandformKind, number>> = { mountain: 3, mesa: 6, spire: 8, tower: 8 };

/** Pixels across one tile on the ground, which is what a slope is measured against. */
const TILE_PX = 16;

const FIELDS = new Map<string, LandformField>();

/** The landform's grid: built the first time anything asks, and kept. */
export function landformField(landform: Landform): LandformField {
  const known = FIELDS.get(landform.id);
  if (known !== undefined) {
    return known;
  }
  const res = RES[landform.kind];
  const half = landform.radius + 1.5;
  const size = Math.ceil(half * 2 * res) + 1;
  const shape = landformShape(landform);
  const heights = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      heights[j * size + i] = shape(i / res - half, j / res - half);
    }
  }
  const field = surfaceOf(landform, res, size, half, heights);
  FIELDS.set(landform.id, field);
  return field;
}

function surfaceOf(landform: Landform, res: number, size: number, half: number, heights: Float32Array): LandformField {
  const normalX = new Float32Array(size * size);
  const normalY = new Float32Array(size * size);
  const materials = new Uint8Array(size * size);
  const detail = new Float32Array(size * size);
  const texture = rugged(landform.seed ^ 0x3c);
  const grain = rugged(landform.seed ^ 0x9d);
  let peak = 0;
  const at = (i: number, j: number): number =>
    heights[Math.min(Math.max(j, 0), size - 1) * size + Math.min(Math.max(i, 0), size - 1)] ?? 0;
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const index = j * size + i;
      const h = heights[index] ?? 0;
      peak = Math.max(peak, h);
      const gx = ((at(i + 1, j) - at(i - 1, j)) * res) / 2 / TILE_PX;
      const gy = ((at(i, j + 1) - at(i, j - 1)) * res) / 2 / TILE_PX;
      const length = Math.hypot(gx, gy, 1);
      normalX[index] = -gx / length;
      normalY[index] = -gy / length;
      materials[index] = materialOf(landform, h, Math.hypot(gx, gy));
      const x = i / res;
      const y = j / res;
      detail[index] = (texture(x * 0.9, y * 0.9) - 0.5) * 1.4 + (grain(x * 2.6, y * 2.6) - 0.5) * 0.6;
    }
  }
  const { blocks, blockMax } = blockMaxima(heights, size, res);
  return { landform, res, size, half, heights, normalX, normalY, materials, detail, peak, blocks, blockMax };
}

/** Each tile-sized block's tallest sample, its one-sample border included so bilinear reads stay under it. */
function blockMaxima(heights: Float32Array, size: number, res: number): { blocks: number; blockMax: Float32Array } {
  const blocks = Math.ceil(size / res);
  const blockMax = new Float32Array(blocks * blocks);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const h = heights[j * size + i] ?? 0;
      // A sample on a block's edge also bounds the block before it.
      for (const bj of new Set([Math.floor(j / res), Math.floor((j - 1) / res)])) {
        for (const bi of new Set([Math.floor(i / res), Math.floor((i - 1) / res)])) {
          if (bi >= 0 && bj >= 0 && bi < blocks && bj < blocks) {
            const index = bj * blocks + bi;
            blockMax[index] = Math.max(blockMax[index] ?? 0, h);
          }
        }
      }
    }
  }
  return { blocks, blockMax };
}

/** An upper bound on the height at a planet offset, from its block: cheaper than the height itself. */
export function fieldBound(field: LandformField, dx: number, dy: number): number {
  const bi = Math.floor((dx + field.half));
  const bj = Math.floor((dy + field.half));
  if (bi < 0 || bj < 0 || bi >= field.blocks || bj >= field.blocks) {
    return 0;
  }
  return field.blockMax[bj * field.blocks + bi] ?? 0;
}

/** What a top surface is made of, by kind, height and steepness. */
function materialOf(landform: Landform, h: number, steepness: number): Material {
  const share = h / landform.height;
  switch (landform.kind) {
    case "mountain":
      if (share > 0.62) {
        return SNOW;
      }
      return share < 0.14 && steepness < 0.9 ? GRASS : ROCK;
    case "mesa":
      return share > 0.9 && steepness < 0.8 ? GRASS : CLIFF;
    case "spire":
      return share < 0.08 && steepness < 1.4 ? GRASS : ROCK;
    case "tower":
      return isRoofed(landform) && h > landform.height + 0.5 ? ROOF : WALL;
  }
}

/** Share of mountains that are volcanoes: their summit is a crater, and it smokes (`volcanoes.ts`). */
export const VOLCANO_SHARE = 0.35;

/** A volcano's summit is cut off at this share of its height... */
export const CRATER_RIM = 0.86;

/** ...and its crater sinks this share of its height below the rim, at the vent. */
const CRATER_DEPTH = 0.12;

/** The crater's radius, as a share of the mountain's footprint. */
export const CRATER_RADIUS = 0.15;

/** Whether a landform is a volcano: a seeded share of the mountains. */
export function isVolcano(landform: Landform): boolean {
  return landform.kind === "mountain" && hashUnit(9, 9, landform.seed ^ 0x7a1c) < VOLCANO_SHARE;
}

/** A mountain's height `h` at `r` tiles from its centre, with the summit cut into a crater. */
function crater(h: number, r: number, R: number, H: number): number {
  const rim = H * CRATER_RIM;
  const bowl = clamp01(1 - r / (R * CRATER_RADIUS));
  return Math.min(h, rim) - H * CRATER_DEPTH * bowl * bowl * (3 - 2 * bowl);
}

/** Half the towers wear a pointed roof; the rest are crenellated. */
export function isRoofed(landform: Landform): boolean {
  return landform.kind === "tower" && hashUnit(5, 5, landform.seed) < 0.5;
}

/** Height at a planet offset from the landform's centre, in tiles: bilinear over the grid. */
export function fieldHeight(field: LandformField, dx: number, dy: number): number {
  const u = (dx + field.half) * field.res;
  const v = (dy + field.half) * field.res;
  if (u < 0 || v < 0 || u >= field.size - 1 || v >= field.size - 1) {
    return 0;
  }
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const row = j * field.size + i;
  const h = field.heights;
  const near = (h[row] ?? 0) + ((h[row + 1] ?? 0) - (h[row] ?? 0)) * fu;
  const far = (h[row + field.size] ?? 0) + ((h[row + field.size + 1] ?? 0) - (h[row + field.size] ?? 0)) * fu;
  return near + (far - near) * fv;
}

/** The grid sample nearest a planet offset, or -1 off the grid. */
export function fieldSample(field: LandformField, dx: number, dy: number): number {
  const i = Math.round((dx + field.half) * field.res);
  const j = Math.round((dy + field.half) * field.res);
  if (i < 0 || j < 0 || i >= field.size || j >= field.size) {
    return -1;
  }
  return j * field.size + i;
}

/** How tall the land stands at a planet point, in pixels: 0 on open ground. */
export function landHeightAt(point: PlanetPoint): number {
  let tallest = 0;
  for (const landform of planetLandforms()) {
    const dx = wrapDelta(point.x, landform.x);
    const dy = wrapDelta(point.y, landform.y);
    if (Math.abs(dx) > landform.radius + 1.5 || Math.abs(dy) > landform.radius + 1.5) {
      continue;
    }
    tallest = Math.max(tallest, fieldHeight(landformField(landform), dx, dy));
  }
  return tallest;
}

/** Whether a point is inside a landform - too steep to walk, no place for a tree. */
export function blockedByLand(point: PlanetPoint): boolean {
  return landHeightAt(point) > BLOCK_HEIGHT;
}

/**
 * The nearest point to `near` that something can stand on.
 *
 * A generated world owes nobody a clear spawn: the point a scene wants to put
 * an actor is as likely to be inside a mountain as not. Spiralling out to the
 * first open point costs a handful of samples once.
 */
export function openGround(near: PlanetPoint): PlanetPoint {
  for (let radius = 0; radius < 48; radius += 1) {
    const steps = Math.max(1, radius * 6);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = {
        x: wrapTile(near.x + radius * Math.cos(angle)),
        y: wrapTile(near.y + radius * Math.sin(angle)),
      };
      if (!blockedByLand(point)) {
        return point;
      }
    }
  }
  return near;
}
