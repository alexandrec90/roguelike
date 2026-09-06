/**
 * Set fire to *anything* that can produce a pixel cloud.
 *
 * The burning birch works because a tree already has a graph — limbs with
 * parents and children — for the heat automaton to spread over. Almost nothing
 * else does. A rock, a bush, a signpost, a corpse, the hero: all of them are a
 * bag of lit pixels with no structure at all.
 *
 * So this builds the structure. Lay a coarse grid over the cloud, keep the
 * cells that contain pixels, join each to its neighbours, and hand the result
 * to `procgen/heat.ts`. The fire then crawls across the object's real shape —
 * up a trunk, along a branch, around the rim of a shield — because the graph is
 * the object's own occupancy rather than a rectangle.
 *
 * How readily a cell burns comes from the **ink of the pixels in it**, which is
 * the payoff of everything flattening to one palette: leaves catch fast and
 * burn out fast, wood is slow and long, ice and water do not burn at all, and
 * no object has to declare any of that. Fire on a new prop costs nothing.
 *
 * This is the simulated counterpart to `transforms.ts`'s `burnCloud`, which is
 * a progress dial for a scripted burn. Reach for that when a cutscene needs a
 * thing 40% charred; reach for this when the world is deciding.
 */

import { cloudBounds, type InkId, type PixelCloud } from "./ink";
import {
  alightNodes,
  createHeat,
  ignite,
  IGNITION,
  isSpent,
  stepHeat,
  type HeatField,
  type HeatNode,
  type HeatOptions,
} from "./procgen/heat";
import { INK_RAMPS, rampInk } from "./shading";
import { pixelHash } from "./transforms";

/** Fuel and resistance per ink. The palette is the material list. */
interface Combustible {
  readonly fuel: number;
  readonly resistance: number;
}

const MATERIALS: Readonly<Record<InkId, Combustible>> = {
  // Foliage: catches instantly, gone in a moment.
  "neon-green": { fuel: 0.7, resistance: 0 },
  amber: { fuel: 0.9, resistance: 0.1 },
  // Wood and cloth: the body of most fires.
  steel: { fuel: 2.4, resistance: 0.9 },
  bone: { fuel: 1.8, resistance: 0.7 },
  deep: { fuel: 2.2, resistance: 1.1 },
  violet: { fuel: 1.4, resistance: 0.5 },
  magenta: { fuel: 1.2, resistance: 0.4 },
  // Already burning.
  ember: { fuel: 1.2, resistance: 0 },
  // Nothing here burns.
  ice: { fuel: 0, resistance: 6 },
  water: { fuel: 0, resistance: 8 },
  cyan: { fuel: 0, resistance: 4 },
  void: { fuel: 0, resistance: 0 },
};

export interface BurnableOptions {
  /** Grid pitch in logical pixels. 3 is a good balance of shape and cost. */
  readonly cellSize?: number;
  readonly seed?: number;
}

export interface Burnable {
  readonly cellSize: number;
  readonly seed: number;
  readonly field: HeatField;
  /** Cell centre in cloud coordinates, per node — where embers are born. */
  readonly centres: readonly { readonly x: number; readonly y: number }[];
  /** Cell index for a cloud pixel, keyed by the grid cell it falls in. */
  readonly lookup: ReadonlyMap<number, number>;
  /** The occupied grid's extent, so the fire can be handed over as a texture. */
  readonly grid: {
    readonly column: number;
    readonly row: number;
    readonly columns: number;
    readonly rows: number;
  };
}

/**
 * The fire as a small RGBA image, one texel per cell.
 *
 * This is how a burn crosses to the GPU. The shader cannot walk a graph, but it
 * can sample a texture, so the automaton stays exactly where it is — on the CPU,
 * stepping the same rule the tests cover — and only its *result* goes across.
 * Red carries heat, green marks a cell as spent; that is the whole protocol.
 *
 * Rebuilt per frame rather than diffed: a burning body is a few hundred cells,
 * which is a texture smaller than a single sprite and costs less to upload than
 * to reason about.
 */
export interface HeatGrid {
  readonly width: number;
  readonly height: number;
  /** Cloud coordinate of the top-left corner of cell (0, 0). */
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
  readonly data: Uint8Array;
}

export function heatGrid(burnable: Burnable): HeatGrid {
  const { column, row, columns, rows } = burnable.grid;
  const data = new Uint8Array(Math.max(1, columns * rows) * 4);
  burnable.centres.forEach((centre, index) => {
    const gx = Math.floor(centre.x / burnable.cellSize) - column;
    const gy = Math.floor(centre.y / burnable.cellSize) - row;
    if (gx < 0 || gy < 0 || gx >= columns || gy >= rows) {
      return;
    }
    const at = (gy * columns + gx) * 4;
    data[at] = Math.round(Math.min(Math.max(burnable.field.heat[index] ?? 0, 0), 1) * 255);
    data[at + 1] = isSpent(burnable.field, index) ? 255 : 0;
    data[at + 3] = 255;
  });
  return {
    width: Math.max(1, columns),
    height: Math.max(1, rows),
    originX: column * burnable.cellSize,
    originY: row * burnable.cellSize,
    cellSize: burnable.cellSize,
    data,
  };
}

function cellKey(column: number, row: number): number {
  return (column + 4096) * 16384 + (row + 4096);
}

/**
 * Build the burnable graph for a cloud.
 *
 * The cloud is the object at rest; a species whose shape moves rebuilds this
 * when it matters, or accepts that the fire is anchored to the pose it caught
 * in — which for a burning thing is usually the truthful answer anyway.
 */
export function makeBurnable(cloud: PixelCloud, options: BurnableOptions = {}): Burnable {
  const cellSize = Math.max(1, Math.trunc(options.cellSize ?? 3));
  const seed = options.seed ?? 0xb04f;

  const buckets = new Map<number, { column: number; row: number; inks: InkId[] }>();
  for (const pixel of cloud) {
    const column = Math.floor(pixel.x / cellSize);
    const row = Math.floor(pixel.y / cellSize);
    const key = cellKey(column, row);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { column, row, inks: [pixel.ink] });
    } else {
      bucket.inks.push(pixel.ink);
    }
  }

  const keys = [...buckets.keys()];
  const lookup = new Map<number, number>(keys.map((key, index) => [key, index]));
  const nodes: HeatNode[] = [];
  const centres: { x: number; y: number }[] = [];

  for (const key of keys) {
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      continue;
    }
    nodes.push({
      neighbours: neighboursOf(bucket.column, bucket.row, lookup),
      ...materialOf(bucket.inks),
    });
    centres.push({
      x: bucket.column * cellSize + Math.floor(cellSize / 2),
      y: bucket.row * cellSize + Math.floor(cellSize / 2),
    });
  }

  const columns = [...buckets.values()].map((bucket) => bucket.column);
  const gridRows = [...buckets.values()].map((bucket) => bucket.row);
  const column = columns.length === 0 ? 0 : Math.min(...columns);
  const row = gridRows.length === 0 ? 0 : Math.min(...gridRows);
  const grid = {
    column,
    row,
    columns: columns.length === 0 ? 0 : Math.max(...columns) - column + 1,
    rows: gridRows.length === 0 ? 0 : Math.max(...gridRows) - row + 1,
  };

  return { cellSize, seed, field: createHeat(nodes), centres, lookup, grid };
}

/** Eight-connected, so fire crosses a diagonal limb instead of stopping at it. */
function neighboursOf(column: number, row: number, lookup: ReadonlyMap<number, number>): number[] {
  const found: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const index = lookup.get(cellKey(column + dx, row + dy));
      if (index !== undefined) {
        found.push(index);
      }
    }
  }
  return found;
}

/** A cell burns like the most flammable thing in it, and resists like the mean. */
function materialOf(inks: readonly InkId[]): Combustible {
  let fuel = 0;
  let resistance = 0;
  let best = 0;
  for (const ink of inks) {
    const material = MATERIALS[ink];
    fuel += material.fuel;
    resistance += material.resistance;
    best = Math.max(best, material.fuel);
  }
  const count = Math.max(1, inks.length);
  return {
    fuel: best === 0 ? 0 : fuel / count,
    resistance: best === 0 ? 8 : resistance / count,
  };
}

/** Light the cell nearest a point — where the fireball actually hit. */
export function igniteAt(burnable: Burnable, x: number, y: number, amount = 1): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  burnable.centres.forEach((centre, index) => {
    if ((burnable.field.nodes[index]?.fuel ?? 0) <= 0) {
      return;
    }
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  if (best >= 0) {
    ignite(burnable.field, best, amount);
  }
  return best;
}

export function stepBurn(burnable: Burnable, dtMs: number, options: HeatOptions = {}): void {
  stepHeat(burnable.field, dtMs, options);
}

/**
 * Re-ink a cloud from the fire crawling over it.
 *
 * Alight pixels walk the ember ramp by heat with a per-frame flicker; spent
 * ones go to `deep`, which is char with a silhouette. Drawing char in `void`
 * instead deletes the object rather than blackening it — a mistake worth
 * naming, because every unit test passes while it happens.
 */
export function burnInk(burnable: Burnable, cloud: PixelCloud, elapsedMs = 0): PixelCloud {
  return burnInkFromGrid(heatGrid(burnable), cloud, elapsedMs, burnable.seed);
}

/**
 * The same re-inking, driven by the grid the GPU is handed.
 *
 * Both renderers reading the *same* description is what makes a burning body
 * comparable: the shader samples this grid as a texture, and this samples it as
 * an array, and any disagreement between them is a real one rather than two
 * paths having been fed different fires.
 */
export function burnInkFromGrid(
  grid: HeatGrid,
  cloud: PixelCloud,
  elapsedMs = 0,
  seed = 0,
): PixelCloud {
  const flicker = Math.floor(elapsedMs / 90);
  return cloud.map((pixel) => {
    const column = Math.floor((pixel.x - grid.originX) / grid.cellSize);
    const row = Math.floor((pixel.y - grid.originY) / grid.cellSize);
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) {
      return pixel;
    }
    const at = (row * grid.width + column) * 4;
    const heat = (grid.data[at] ?? 0) / 255;
    if (heat > IGNITION) {
      return { x: pixel.x, y: pixel.y, ink: emberInk(pixel, heat, seed + flicker) };
    }
    if ((grid.data[at + 1] ?? 0) > 127) {
      return { x: pixel.x, y: pixel.y, ink: "deep" as InkId };
    }
    return pixel;
  });
}

/**
 * The ink of a pixel that is on fire.
 *
 * The level is deliberately kept off the top of the ramp. `ember` runs
 * deep → ember → amber → bone, and a fully alight cell driven straight at the
 * ramp lands on `bone` for nearly every pixel, which draws a burning bush as a
 * white blob. Fire reads as fire when its *body* is orange and only a scatter
 * of pixels reaches white, so heat is mapped into the middle of the ramp and
 * the per-frame jitter is what occasionally pushes one to the top.
 *
 * Exported because the burning birch inks limbs from the same rule, and two
 * fires in one game that disagree about what fire looks like is worse than
 * either of them being slightly wrong.
 */
export function emberInk(
  at: { readonly x: number; readonly y: number },
  heat: number,
  seed: number,
): InkId {
  const jitter = pixelHash(at.x, at.y, seed, 4) * 0.28;
  return rampInk(INK_RAMPS.ember, Math.min(0.18 + heat * 0.42 + jitter, 1), at);
}

/** Where embers and smoke should be born: the cells actually alight. */
export function burningPoints(burnable: Burnable): { readonly x: number; readonly y: number }[] {
  return alightNodes(burnable.field)
    .map((index) => burnable.centres[index])
    .filter((centre): centre is { x: number; y: number } => centre !== undefined);
}
