/**
 * Outcrops as stone rather than brickwork: the cap on top and the cliff in front.
 *
 * The hand-drawn rock this replaces read as masonry for two reasons, and both
 * are rules now:
 *
 * - **A cap is a surface, so it carries no vertical lines.** Its cracks are the
 *   contour of a noise field stretched sideways (`onCrack`), so they wander
 *   across the top the way weathering runs, and - being the contour of a field
 *   that is continuous across joins (`wang.ts`) - they run on into the next
 *   cell instead of stopping at a mortar line.
 * - **A mass has one rim, not one per cell.** Rims, rounding and moss are
 *   decided per *edge of the outcrop*: a cap lights its rim, chips its corner and
 *   grows moss only where the neighbour on that side is not rock, so a twenty
 *   cell outcrop is one lump with a lit outline, not twenty tiles.
 *
 * The face is a cliff: vertical strata, darkening toward the foot, a highlight
 * on the lip and moss dripping over it, and a rounded end wherever the outcrop
 * stops. It holds no contact shadow - the ground under it draws that
 * (`contactShade` in `ground-tiles.ts`), because a face that owned its shadow
 * would stripe if it were ever stacked.
 *
 * Light is fixed at the top left, as the rest of the baked art is; the time of
 * day is the lighting layer's job, not a re-bake.
 */

import type { InkId } from "../ink";
import { familyRamp } from "../palette";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../projection";
import { rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { createGrid, gridAt, setGrid, type InkGrid } from "./ink-grid";
import { createWangTable, wangField, type WangTable } from "./wang";

export const ROCK_NORTH = 1;
export const ROCK_EAST = 2;
export const ROCK_SOUTH = 4;
export const ROCK_WEST = 8;

export interface CapKey {
  /** Which neighbours are rock: `ROCK_NORTH | ROCK_EAST | …` (north is behind). */
  readonly rock: number;
  readonly colours: number;
  readonly middle: number;
}

export function packCapKey(key: CapKey): number {
  return (key.rock & 15) | ((key.colours & 0x1ff) << 4) | ((key.middle & 7) << 13);
}

export function unpackCapKey(packed: number): CapKey {
  return { rock: packed & 15, colours: (packed >>> 4) & 0x1ff, middle: (packed >>> 13) & 7 };
}

export interface FaceKey {
  /** The outcrop stops to the left / right of this face, so that end is rounded. */
  readonly openLeft: boolean;
  readonly openRight: boolean;
  /** Three bits: the colours of the cell's near-edge nodes, left to right. */
  readonly colours: number;
  readonly middle: number;
}

export function packFaceKey(key: FaceKey): number {
  return (key.openLeft ? 1 : 0) | (key.openRight ? 2 : 0) | ((key.colours & 7) << 2) | ((key.middle & 7) << 5);
}

export function unpackFaceKey(packed: number): FaceKey {
  return {
    openLeft: (packed & 1) !== 0,
    openRight: (packed & 2) !== 0,
    colours: (packed >>> 2) & 7,
    middle: (packed >>> 5) & 7,
  };
}

const STONE: readonly InkId[] = familyRamp("stone");
const MOSS: readonly InkId[] = familyRamp("moss");

let capTable: WangTable | undefined;
let faceTable: WangTable | undefined;

function capWang(): WangTable {
  capTable ??= createWangTable(TILE_WIDTH, TILE_DEPTH, 0x70c4, [
    { scaleX: 8, scaleY: 6, octaves: 2 },
    { scaleX: 10, scaleY: 4.5, octaves: 2 },
    { scaleX: 4, scaleY: 3, octaves: 2 },
  ]);
  return capTable;
}

function faceWang(): WangTable {
  faceTable ??= createWangTable(TILE_WIDTH, WALL_RISE, 0xc11f, [
    { scaleX: 2.4, scaleY: 12, octaves: 2 },
    { scaleX: 6, scaleY: 6, octaves: 1 },
    { scaleX: 1.6, scaleY: 4, octaves: 1 },
  ]);
  return faceTable;
}

/** Rounding radius of an outcrop's corner, in pixels across; depth is foreshortened. */
const CORNER = 4;

/**
 * Is (x, y) cut away by a rounded convex corner? Only corners where both
 * neighbours are open are convex, so the inside of a bend stays square.
 */
function cutCorner(rock: number, x: number, y: number): boolean {
  const radiusY = (CORNER * TILE_DEPTH) / TILE_WIDTH;
  const px = x + 0.5;
  const py = y + 0.5;
  const left = (rock & ROCK_WEST) === 0 && px < CORNER;
  const right = (rock & ROCK_EAST) === 0 && px > TILE_WIDTH - CORNER;
  const top = (rock & ROCK_NORTH) === 0 && py < radiusY;
  const bottom = (rock & ROCK_SOUTH) === 0 && py > TILE_DEPTH - radiusY;
  if (!((left || right) && (top || bottom))) {
    return false;
  }
  const dx = (left ? CORNER - px : px - (TILE_WIDTH - CORNER)) / CORNER;
  const dy = (top ? radiusY - py : py - (TILE_DEPTH - radiusY)) / radiusY;
  return dx * dx + dy * dy > 1;
}

/** Which sides of an opaque pixel face open air - the outcrop's outline there. */
function openSides(grid: InkGrid, rock: number, x: number, y: number): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  const edge = (inside: boolean, open: boolean, nx: number, ny: number): boolean =>
    inside ? gridAt(grid, nx, ny) === null : open;
  return {
    left: edge(x > 0, (rock & ROCK_WEST) === 0, x - 1, y),
    right: edge(x < TILE_WIDTH - 1, (rock & ROCK_EAST) === 0, x + 1, y),
    top: edge(y > 0, (rock & ROCK_NORTH) === 0, x, y - 1),
    bottom: edge(y < TILE_DEPTH - 1, (rock & ROCK_SOUTH) === 0, x, y + 1),
  };
}

/**
 * The top of a rock cell: stone lit from the upper left, cracked, mossed at its
 * lit rim, chipped round where the outcrop turns a corner.
 */
export function capTile(key: CapKey): InkGrid {
  const table = capWang();
  const tone = wangField(table, 0, key.colours, key.middle);
  const crack = wangField(table, 1, key.colours, key.middle);
  const moss = wangField(table, 2, key.colours, key.middle);
  const grid = createGrid(TILE_WIDTH, TILE_DEPTH);
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      if (!cutCorner(key.rock, x, y)) {
        setGrid(grid, x, y, "stone-3");
      }
    }
  }
  const levels = new Float32Array(TILE_WIDTH * TILE_DEPTH);
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      if (gridAt(grid, x, y) !== null) {
        shadeCapPixel(grid, key.rock, { tone, crack, levels }, x, y);
      }
    }
  }
  litCrackLips(grid, crack);
  growCapMoss(grid, key, moss, levels);
  return grid;
}

/** How much an open side raises (lit) or lowers (shade) the cap's level there. */
export function rimLight(open: { left: boolean; right: boolean; top: boolean; bottom: boolean }): number {
  return (open.left ? 0.22 : 0) + (open.top ? 0.28 : 0) - (open.right ? 0.26 : 0) - (open.bottom ? 0.08 : 0);
}

interface CapFields {
  readonly tone: Float32Array;
  readonly crack: Float32Array;
  /** Written: each pixel's lit level, for the moss pass. */
  readonly levels: Float32Array;
}

/**
 * One cap pixel. Plates: each side of the crack contour is one slab, tilted a
 * little toward or away from the light, so the top reads as broken stone. The
 * body of a slab is flat-shaded - dithered only at the rims, where the level is
 * changing fast - which is what makes it read as a hard surface, not gravel.
 */
function shadeCapPixel(grid: InkGrid, rock: number, fields: CapFields, x: number, y: number): void {
  const index = y * TILE_WIDTH + x;
  const open = openSides(grid, rock, x, y);
  const rim = open.left || open.top || open.right || open.bottom;
  const slab = (fields.crack[index] ?? 0.5) > CRACK_LEVEL ? 0.06 : -0.1;
  const level = 0.58 + slab + ((fields.tone[index] ?? 0.5) - 0.5) * 0.45 + rimLight(open);
  fields.levels[index] = level;
  setGrid(grid, x, y, rampInk(STONE, level, rim ? { x, y } : undefined));
  if (onCrack(fields.crack, x, y) && !rim) {
    setGrid(grid, x, y, "stone-1");
  }
}

/** The crack network is this contour of the crack field: low, so cracks are sparse. */
const CRACK_LEVEL = 0.36;

/**
 * Is (x, y) on a crack? A pixel is, where the field crosses the level between
 * it and the pixel below - a crossing test rather than a band test, so the line
 * is one pixel wide and does not break into dots. Only the vertical crossing
 * counts: where the contour turns steep it simply gaps, which is how a cap
 * keeps its promise of no vertical lines.
 */
function onCrack(crack: Float32Array, x: number, y: number): boolean {
  const here = (crack[y * TILE_WIDTH + x] ?? 0.5) > CRACK_LEVEL;
  return y + 1 < TILE_DEPTH && ((crack[(y + 1) * TILE_WIDTH + x] ?? 0.5) > CRACK_LEVEL) !== here;
}

/** A crack's lower lip catches the light: the pixel under a crack steps up. */
function litCrackLips(grid: InkGrid, crack: Float32Array): void {
  for (let y = TILE_DEPTH - 2; y >= 0; y -= 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const below = gridAt(grid, x, y + 1);
      if (onCrack(crack, x, y) && gridAt(grid, x, y) === "stone-1" && below !== null && below !== "stone-1") {
        setGrid(grid, x, y + 1, "stone-4");
      }
    }
  }
}

/** Moss where its field is high, encouraged along the lit (back and left) rims. */
function growCapMoss(grid: InkGrid, key: CapKey, moss: Float32Array, levels: Float32Array): void {
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      if (gridAt(grid, x, y) === null) {
        continue;
      }
      const index = y * TILE_WIDTH + x;
      let bias = 0;
      if ((key.rock & ROCK_NORTH) === 0) {
        bias += Math.max(0, 0.2 - y * 0.05);
      }
      if ((key.rock & ROCK_WEST) === 0) {
        bias += Math.max(0, 0.14 - x * 0.04);
      }
      const value = (moss[index] ?? 0.5) + bias;
      if (value > 0.67) {
        const lit = (levels[index] ?? 0.5) - 0.3 + (value - 0.67) * 1.5;
        setGrid(grid, x, y, rampInk(MOSS, lit));
      }
    }
  }
}

/** How many pixels an open face end is cut in by, per row: a rounded lip and foot. */
const END_INSET: readonly number[] = [2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

/** A face's Wang colours: each near-edge node's bit, repeated down the face. */
function faceColours(colours: number): number {
  let packed = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      packed |= ((colours >>> column) & 1) << (row * 3 + column);
    }
  }
  return packed;
}

function faceOpaque(key: FaceKey, x: number, y: number): boolean {
  const inset = END_INSET[y] ?? 0;
  if (key.openLeft && x < inset) {
    return false;
  }
  return !(key.openRight && x > TILE_WIDTH - 1 - inset);
}

/**
 * The front of a rock cell: a sixteen-pixel cliff.
 *
 * Strata run vertically because this surface is vertical; the level falls
 * toward the foot as the light falls off under the lip; the left end of an
 * outcrop turns toward the light and the right end away from it.
 */
export function faceTile(key: FaceKey): InkGrid {
  const table = faceWang();
  const colours = faceColours(key.colours);
  const strata = wangField(table, 0, colours, key.middle);
  const tone = wangField(table, 1, colours, key.middle);
  const drip = wangField(table, 2, colours, key.middle);
  const grid = createGrid(TILE_WIDTH, WALL_RISE);
  for (let y = 0; y < WALL_RISE; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      if (!faceOpaque(key, x, y)) {
        continue;
      }
      const index = y * TILE_WIDTH + x;
      const s = strata[index] ?? 0.5;
      let level = 0.5 + (s - 0.5) * 1.5 + ((tone[index] ?? 0.5) - 0.5) * 0.5 - (y / (WALL_RISE - 1)) * 0.3;
      const leftEdge = !faceOpaque(key, x - 1, y) || (key.openLeft && x < 3);
      const rightEdge = !faceOpaque(key, x + 1, y) || (key.openRight && x > TILE_WIDTH - 4);
      level += leftEdge ? 0.16 : 0;
      level -= rightEdge ? 0.22 : 0;
      let ink = rampInk(STONE, level, { x, y });
      if (Math.abs(s - 0.5) < 0.03 && y > 1) {
        ink = "stone-1";
      }
      setGrid(grid, x, y, ink);
    }
  }
  lip(grid, key, drip);
  return grid;
}

/** The lit lip along the top, and moss hanging over it in uneven strands. */
function lip(grid: InkGrid, key: FaceKey, drip: Float32Array): void {
  const seed = key.colours * 8 + key.middle;
  for (let x = 0; x < TILE_WIDTH; x += 1) {
    if (gridAt(grid, x, 0) !== null) {
      setGrid(grid, x, 0, x % 5 === 3 ? "stone-4" : "stone-5");
    }
    const strand = (drip[x] ?? 0.5) + pixelHash(x, 0, seed, 5) * 0.25;
    if (strand < 0.6) {
      continue;
    }
    const length = Math.min(5, Math.round((strand - 0.6) * 12));
    for (let y = 1; y <= length; y += 1) {
      if (gridAt(grid, x, y) === null) {
        break;
      }
      const ink: InkId = y === 1 ? "moss-3" : y < length ? "moss-2" : "moss-1";
      setGrid(grid, x, y, ink);
    }
  }
}
