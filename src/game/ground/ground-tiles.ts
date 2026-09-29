/**
 * The flat ground, generated: meadow, trodden earth, and the border between.
 *
 * A ground tile is a pure function of a small key (see `GroundTileKey`), so it
 * is generated once and then only ever copied. The key is chosen so that the
 * tile can agree with every neighbour it could possibly have:
 *
 * - **Tone** comes from the Wang field (`wang.ts`), so shading is continuous
 *   across every join whatever the neighbouring variants are.
 * - **The path border** comes from the nine lattice samples of the path
 *   (`ground-sample.ts`), blended smoothly and wobbled by the same Wang field.
 *   Two cells sharing an edge share that edge's samples and that edge's noise,
 *   so the border crosses the join without a kink - and because the samples
 *   come from the planet's real path contour, it winds.
 * - **Details** - clover, a pebble, a fleck of soil, the odd flower - are the
 *   middle node's business and stay two pixels off every edge, so they can
 *   never be cut in half by a neighbour.
 *
 * Nothing here is painted with a hex or with alpha: a contact shadow is the
 * ramp stepped down, dithered, which reads as shade on grass and on earth alike.
 */

import type { InkId } from "../ink";
import { familyRamp } from "../palette";
import { rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { createGrid, gridAt, setGrid, type InkGrid } from "./ink-grid";
import { createWangTable, wangField, type WangTable } from "./wang";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";

/** Everything a ground tile depends on. Pack with `packGroundKey`. */
export interface GroundTileKey {
  /** Nine bits: lattice node `n` (row-major, top row first) is path. */
  readonly dirt: number;
  /** Nine bits: the shared nodes' Wang colours (bit 4 unused). */
  readonly colours: number;
  /** 0..7: the middle node's colour, which also picks the details. */
  readonly middle: number;
  /** Three bits: rock stands behind-left, behind, behind-right (contact shadow). */
  readonly shade: number;
}

export function packGroundKey(key: GroundTileKey): number {
  return (key.dirt & 0x1ff) | ((key.colours & 0x1ff) << 9) | ((key.middle & 7) << 18) | ((key.shade & 7) << 21);
}

export function unpackGroundKey(packed: number): GroundTileKey {
  return {
    dirt: packed & 0x1ff,
    colours: (packed >>> 9) & 0x1ff,
    middle: (packed >>> 18) & 7,
    shade: (packed >>> 21) & 7,
  };
}

const TONE = 0;
const DETAIL = 1;
const GRAIN = 2;

let groundTable: WangTable | undefined;

export function groundWangTable(): WangTable {
  groundTable ??= createWangTable(TILE_WIDTH, TILE_DEPTH, 0x6a55, [
    { scaleX: 6, scaleY: 4.5, octaves: 2 },
    { scaleX: 2.2, scaleY: 1.8, octaves: 1 },
    { scaleX: 9, scaleY: 2.4, octaves: 2 },
  ]);
  return groundTable;
}

const GRASS_RAMP: readonly InkId[] = familyRamp("grass");
const EARTH_RAMP: readonly InkId[] = familyRamp("earth");

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * How much of a path the ground is at a pixel, 0..1, before the wobble.
 *
 * Bilinear over the four lattice nodes around the pixel with smoothstepped
 * weights, which rounds a diagonal run of samples into a curve instead of a
 * staircase. Lattice nodes are half a tile apart: 8 pixels across, 6 deep.
 */
export function pathCover(dirt: number, x: number, y: number): number {
  const u = Math.min(Math.max((x + 0.5) / (TILE_WIDTH / 2), 0), 1.9999);
  const v = Math.min(Math.max((y + 0.5) / (TILE_DEPTH / 2), 0), 1.9999);
  const column = Math.floor(u);
  const row = Math.floor(v);
  const fu = smooth(u - column);
  const fv = smooth(v - row);
  const node = row * 3 + column;
  const top = ((dirt >>> node) & 1) * (1 - fu) + ((dirt >>> (node + 1)) & 1) * fu;
  const bottom = ((dirt >>> (node + 3)) & 1) * (1 - fu) + ((dirt >>> (node + 4)) & 1) * fu;
  return top * (1 - fv) + bottom * fv;
}

/**
 * Contact shadow at the tile's far edge, where a rock face meets the ground.
 *
 * Strongest on the top row and gone by the fourth, tapering at an end where the
 * outcrop behind stops - the face is rounded there, and its shadow follows it.
 */
const CONTACT_FALL: readonly number[] = [0.5, 0.36, 0.2, 0.08];

export function contactShade(shade: number, x: number, y: number): number {
  const fall = CONTACT_FALL[y] ?? 0;
  if (fall === 0 || shade === 0) {
    return 0;
  }
  const left = (shade & 1) !== 0;
  const centre = (shade & 2) !== 0;
  const right = (shade & 4) !== 0;
  let reach = 0;
  if (centre) {
    const fromLeft = left ? 1 : Math.min(1, (x + 1) / 4);
    const fromRight = right ? 1 : Math.min(1, (TILE_WIDTH - x) / 4);
    reach = Math.min(fromLeft, fromRight);
  } else {
    // A neighbour's face ends just past this cell's corner: a sliver of its shadow.
    reach = Math.max(left ? 1 - x / 3 : 0, right ? 1 - (TILE_WIDTH - 1 - x) / 3 : 0);
  }
  return fall * Math.max(0, reach);
}

/** The tile, before details: which pixels are path, and each pixel's lit level. */
function baseLayer(key: GroundTileKey, tone: Float32Array, detail: Float32Array): {
  grid: InkGrid;
  path: Uint8Array;
} {
  const grid = createGrid(TILE_WIDTH, TILE_DEPTH);
  const path = new Uint8Array(TILE_WIDTH * TILE_DEPTH);
  const border = new Float32Array(TILE_WIDTH * TILE_DEPTH);
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const index = y * TILE_WIDTH + x;
      const wobble = ((tone[index] ?? 0.5) - 0.5) * 0.7 + ((detail[index] ?? 0.5) - 0.5) * 0.45;
      const cover = key.dirt === 0 ? 0 : pathCover(key.dirt, x, y) + wobble;
      border[index] = cover;
      path[index] = cover > 0.5 ? 1 : 0;
    }
  }
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const index = y * TILE_WIDTH + x;
      const cover = border[index] ?? 0;
      const lit = (tone[index] ?? 0.5) - 0.5;
      const fine = (detail[index] ?? 0.5) - 0.5;
      const shade = contactShade(key.shade, x, y);
      const ink =
        path[index] === 1
          ? rampInk(EARTH_RAMP, 0.56 + lit * 0.9 + fine * 0.35 - edgeShadow(cover) - shade, { x, y })
          : rampInk(GRASS_RAMP, 0.43 + lit * 0.85 + fine * 0.3 + edgeLight(cover) - shade, { x, y });
      setGrid(grid, x, y, ink);
    }
  }
  return { grid, path };
}

/** Earth just inside the border sits in the grass's shade. */
function edgeShadow(cover: number): number {
  return cover > 0.5 && cover < 0.64 ? 0.3 * (1 - (cover - 0.5) / 0.14) : 0;
}

/** Grass right at the border is its own lit fringe - the tips leaning over the path. */
function edgeLight(cover: number): number {
  return cover <= 0.5 && cover > 0.36 ? 0.22 * ((cover - 0.36) / 0.14) : 0;
}

/**
 * Blade tips hanging over the path edge: grass pixels that spill one or two
 * pixels down onto the earth below them. Only ever downward, because the
 * camera looks down on blades leaning toward it.
 */
function overhang(grid: InkGrid, path: Uint8Array, seed: number): void {
  for (let y = 1; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const index = y * TILE_WIDTH + x;
      if (path[index] !== 1 || path[index - TILE_WIDTH] !== 0) {
        continue;
      }
      const roll = pixelHash(x, y, seed, 3);
      if (roll < 0.55) {
        setGrid(grid, x, y, roll < 0.2 ? "grass-4" : "grass-3");
        if (roll < 0.14 && y + 1 < TILE_DEPTH && path[index + TILE_WIDTH] === 1) {
          setGrid(grid, x, y + 1, "grass-2");
        }
      }
    }
  }
}

type Detail = (grid: InkGrid, path: Uint8Array, seed: number) => void;

/**
 * A pixel three in from every edge, on the right material. Details reach at
 * most two pixels from their spot, so nothing drawn here touches the border.
 */
function spot(seed: number, salt: number, path: Uint8Array, wantPath: boolean): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const x = 3 + Math.floor(pixelHash(attempt, salt, seed, 1) * (TILE_WIDTH - 6));
    const y = 3 + Math.floor(pixelHash(attempt, salt, seed, 2) * (TILE_DEPTH - 6));
    if ((path[y * TILE_WIDTH + x] === 1) === wantPath) {
      return { x, y };
    }
  }
  return null;
}

const clover: Detail = (grid, path, seed) => {
  const at = spot(seed, 11, path, false);
  if (at === null) {
    return;
  }
  // Three round leaves around a stem, each lit on its upper-left pixel.
  const leaves = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 0, y: 1 },
  ];
  for (const leaf of leaves) {
    const lx = at.x + leaf.x;
    const ly = at.y + leaf.y;
    setGrid(grid, lx, ly, "grass-4");
    setGrid(grid, lx + (leaf.x >= 0 ? 1 : -1), ly, "grass-3");
    setGrid(grid, lx, ly + 1, "grass-1");
  }
  setGrid(grid, at.x, at.y, "grass-5");
};

const flecks: Detail = (grid, path, seed) => {
  for (let index = 0; index < 3; index += 1) {
    const at = spot(seed, 20 + index, path, false);
    if (at !== null) {
      setGrid(grid, at.x, at.y, index === 0 ? "earth-1" : "grass-0");
    }
  }
};

const pebble = (wantPath: boolean): Detail => (grid, path, seed) => {
  const at = spot(seed, wantPath ? 31 : 32, path, wantPath);
  if (at === null) {
    return;
  }
  // Lit from the upper left: highlight, body, and a shadow pixel down-right.
  setGrid(grid, at.x, at.y, "stone-5");
  setGrid(grid, at.x + 1, at.y, "stone-3");
  setGrid(grid, at.x + 1, at.y + 1, wantPath ? "earth-0" : "grass-0");
  setGrid(grid, at.x + 2, at.y, wantPath ? "earth-1" : "grass-1");
};

const flower: Detail = (grid, path, seed) => {
  const at = spot(seed, 41, path, false);
  if (at === null) {
    return;
  }
  const petals: readonly InkId[] = ["petal-0", "petal-1", "petal-2", "petal-3", "petal-4", "petal-5"];
  setGrid(grid, at.x, at.y, petals[Math.floor(pixelHash(0, 0, seed, 42) * petals.length)] ?? "petal-2");
  setGrid(grid, at.x, at.y + 1, "grass-1");
};

const gravel: Detail = (grid, path, seed) => {
  for (let index = 0; index < 5; index += 1) {
    const at = spot(seed, 50 + index, path, true);
    if (at !== null) {
      setGrid(grid, at.x, at.y, index % 2 === 0 ? "earth-5" : "earth-1");
    }
  }
};

/**
 * Ruts: the contour of the anisotropic grain, pressed dark into the earth with
 * a lit lip below it. A contour of a continuous field is continuous, so a rut
 * crosses into the next cell rather than stopping at the join.
 */
function ruts(grid: InkGrid, path: Uint8Array, grain: Float32Array): void {
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const index = y * TILE_WIDTH + x;
      if (path[index] !== 1) {
        continue;
      }
      const g = grain[index] ?? 0.5;
      if (Math.abs(g - 0.47) < 0.022) {
        setGrid(grid, x, y, "earth-1");
        if (path[index + TILE_WIDTH] === 1 && gridAt(grid, x, y + 1) !== "earth-1") {
          setGrid(grid, x, y + 1, "earth-4");
        }
      }
    }
  }
}

/** Which details a middle colour carries. Two plain variants keep the field calm. */
const DETAILS: readonly (readonly Detail[])[] = [
  [],
  [clover],
  [flecks, pebble(false)],
  [flower, flecks],
  [clover, flower],
  [pebble(true), gravel],
  [flecks],
  [gravel, pebble(false)],
];

export function groundTile(key: GroundTileKey): InkGrid {
  const table = groundWangTable();
  const tone = wangField(table, TONE, key.colours, key.middle);
  const detail = wangField(table, DETAIL, key.colours, key.middle);
  const grain = wangField(table, GRAIN, key.colours, key.middle);
  const { grid, path } = baseLayer(key, tone, detail);
  ruts(grid, path, grain);
  const seed = (key.colours * 8 + key.middle) * 0x9e37 + 0x51;
  for (const detailFn of DETAILS[key.middle] ?? []) {
    detailFn(grid, path, seed);
  }
  if (key.dirt !== 0) {
    overhang(grid, path, seed);
  }
  return grid;
}
