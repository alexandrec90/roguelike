/**
 * Seamless, non-repeating tile fields: noise that agrees across every edge.
 *
 * The problem this solves is the one that makes a tiled field read as
 * wallpaper. A single texture repeated twenty times across the screen is
 * periodic, and the eye finds the period in about a second. Several variants
 * chosen at random fix the period but open a seam wherever two of them meet,
 * because each variant's noise is its own and the two disagree at the join.
 *
 * The answer here is a *node* tiling in the Wang family. Every tile has nine
 * control nodes - four corners, four edge midpoints and a centre - on a 3x3
 * grid, and each node carries a small **colour** (which noise it holds):
 *
 *     c . e . c        c corner   shared by the four cells that meet there
 *     .       .        e edge     shared by the two cells either side of it
 *     e   m   e        m middle   this cell's own
 *     .       .
 *     c . e . c
 *
 * The field at a pixel is a blend of the nodes around it, weighted by tent
 * functions that are exactly 1 at a node and 0 at the next, and each node's
 * noise is evaluated at the pixel's position *relative to the node*. So along an
 * edge only that edge's three nodes have any weight, both cells that share the
 * edge evaluate the same noise at the same relative points, and the field is
 * continuous across the join by construction - for any combination of colours
 * on either side. A node's colour is decided by whoever owns the node (the
 * ground layer hashes the planet point under it), so neighbours agree without
 * ever talking to each other.
 *
 * Everything is precomputed per tile size: the tent weights per pixel (at most
 * four nodes touch any pixel) and each node's noise per colour, lazily. A tile
 * field is then four multiply-adds per pixel per channel.
 */

import { valueNoise2 } from "../procgen/noise";

/** Edge and corner nodes carry one bit; the middle node, being private, carries more. */
export const EDGE_COLOURS = 2;
export const MIDDLE_COLOURS = 8;
export const NODE_COUNT = 9;
export const MIDDLE_NODE = 4;

export interface WangChannel {
  /** Noise feature size in pixels along x and y. Unequal scales give grain. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly octaves: number;
}

export interface WangTable {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly channels: readonly WangChannel[];
  /** Per pixel, the four node indices that touch it, row-major, 4 per pixel. */
  readonly nodes: Uint8Array;
  /** Per pixel, the matching weights, already divided by the blend's norm. */
  readonly weights: Float32Array;
  /** Lazily filled noise, keyed `channel * 9 * 8 + node * 8 + colour`. */
  readonly noise: Map<number, Float32Array>;
}

/** Tent on {0, 0.5, 1}: weight of node `index` at `t` in 0..1, smoothed. */
function tent(index: number, t: number): number {
  const linear = Math.max(0, 1 - Math.abs(t * 2 - index));
  return linear * linear * (3 - 2 * linear);
}

/**
 * Which kind of node a grid index is, for seeding.
 *
 * Kind rather than index, because the node a cell calls "east edge" is the one
 * its neighbour calls "west edge": both must draw the same noise, so the seed
 * may only depend on what the node *is*, never on which side it was seen from.
 */
function nodeKind(node: number): number {
  const column = node % 3;
  const row = Math.floor(node / 3);
  if (column === 1 && row === 1) {
    return 3;
  }
  if (column === 1) {
    return 1;
  }
  return row === 1 ? 2 : 0;
}

export function createWangTable(
  width: number,
  height: number,
  seed: number,
  channels: readonly WangChannel[],
): WangTable {
  const pixels = width * height;
  const nodes = new Uint8Array(pixels * 4);
  const weights = new Float32Array(pixels * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const touching: { node: number; weight: number }[] = [];
      for (let node = 0; node < NODE_COUNT; node += 1) {
        const weight = tent(node % 3, u) * tent(Math.floor(node / 3), v);
        if (weight > 0) {
          touching.push({ node, weight });
        }
      }
      // Normalising by the root of the summed squares keeps the blend's
      // contrast constant: a plain average of two independent noises is
      // visibly flatter than either, and the flat band would draw the grid.
      const sum = touching.reduce((total, entry) => total + entry.weight, 0);
      const norm = Math.sqrt(touching.reduce((total, entry) => total + (entry.weight / sum) ** 2, 0));
      const base = (y * width + x) * 4;
      touching.slice(0, 4).forEach((entry, slot) => {
        nodes[base + slot] = entry.node;
        weights[base + slot] = entry.weight / sum / norm;
      });
    }
  }
  return { width, height, seed, channels, nodes, weights, noise: new Map() };
}

function fbmAt(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise2(x * frequency, y * frequency, seed + octave * 131);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/** One node's noise over this tile, centred on the node - built on first use. */
function nodeNoise(table: WangTable, channel: number, node: number, colour: number): Float32Array {
  const key = channel * NODE_COUNT * MIDDLE_COLOURS + node * MIDDLE_COLOURS + colour;
  const cached = table.noise.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const spec = table.channels[channel];
  if (spec === undefined) {
    throw new Error(`Wang table has no channel ${channel}`);
  }
  const nodeX = (node % 3) * (table.width / 2);
  const nodeY = Math.floor(node / 3) * (table.height / 2);
  const seed = (table.seed ^ Math.imul(nodeKind(node) * 16 + colour + 1, 0x9e3779b1) ^ (channel * 0x51ed)) >>> 0;
  const values = new Float32Array(table.width * table.height);
  for (let y = 0; y < table.height; y += 1) {
    for (let x = 0; x < table.width; x += 1) {
      // The offset keeps each colour's lattice off every other's, so two
      // colours are two unrelated fields rather than one field shifted.
      const rx = (x + 0.5 - nodeX) / spec.scaleX + 37.1 * colour;
      const ry = (y + 0.5 - nodeY) / spec.scaleY + 11.3 * colour;
      values[y * table.width + x] = fbmAt(rx, ry, seed, spec.octaves) - 0.5;
    }
  }
  table.noise.set(key, values);
  return values;
}

/** Colour of node `node` in a packed key: one bit per edge/corner node, three for the middle. */
export function nodeColour(colours: number, middle: number, node: number): number {
  return node === MIDDLE_NODE ? middle % MIDDLE_COLOURS : (colours >>> node) & 1;
}

/**
 * The whole tile's field for one channel, roughly 0..1 around 0.5.
 *
 * `colours` packs the eight shared nodes one bit each (bit `n` for node `n`;
 * the middle node's bit is ignored) and `middle` is the private centre's colour.
 */
export function wangField(
  table: WangTable,
  channel: number,
  colours: number,
  middle: number,
  out = new Float32Array(table.width * table.height),
): Float32Array {
  const fields: Float32Array[] = [];
  for (let node = 0; node < NODE_COUNT; node += 1) {
    fields.push(nodeNoise(table, channel, node, nodeColour(colours, middle, node)));
  }
  const pixels = table.width * table.height;
  const { weights, nodes } = table;
  for (let index = 0; index < pixels; index += 1) {
    let value = 0.5;
    const base = index * 4;
    for (let slot = base; slot < base + 4; slot += 1) {
      const weight = weights[slot] as number;
      if (weight !== 0) {
        value += weight * ((fields[nodes[slot] as number] as Float32Array)[index] as number);
      }
    }
    out[index] = value;
  }
  return out;
}
