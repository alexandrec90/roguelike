/**
 * Generated tiles, resolved to packed RGBA once and then only copied.
 *
 * A tile is a pure function of a packed integer key, so the cache is a map
 * from key to pixels and nothing else. It is bounded by clearing rather than by
 * eviction order: the working set of a walk is a few hundred keys, the limit is
 * many thousands, and a clear costs one frame of re-baking that nobody sees.
 */

import { gridToPixels, type InkGrid } from "./ink-grid";

export interface TileCache {
  readonly width: number;
  readonly height: number;
  readonly get: (key: number) => Uint32Array;
  /** The tile if it has already been generated; never generates. */
  readonly peek: (key: number) => Uint32Array | undefined;
  /** Tiles generated since creation - what a test counts to prove reuse. */
  readonly baked: () => number;
  readonly size: () => number;
}

export function createTileCache(
  width: number,
  height: number,
  generate: (key: number) => InkGrid,
  limit = 8192,
): TileCache {
  const tiles = new Map<number, Uint32Array>();
  let baked = 0;
  return {
    width,
    height,
    get(key: number): Uint32Array {
      let pixels = tiles.get(key);
      if (pixels === undefined) {
        if (tiles.size >= limit) {
          tiles.clear();
        }
        const grid = generate(key);
        if (grid.width !== width || grid.height !== height) {
          throw new Error(`Tile ${key} is ${grid.width}x${grid.height}; expected ${width}x${height}`);
        }
        pixels = gridToPixels(grid);
        tiles.set(key, pixels);
        baked += 1;
      }
      return pixels;
    },
    peek: (key: number) => tiles.get(key),
    baked: () => baked,
    size: () => tiles.size,
  };
}

/** A packed-RGBA view of a buffer's bytes, for word-at-a-time copies. */
export interface WordTarget {
  readonly width: number;
  readonly height: number;
  readonly words: Uint32Array;
}

/**
 * Copy a tile's words into the target with its top-left at (x, y).
 *
 * `opaque` tiles are copied a row at a time with `set`; the rest skip their
 * transparent words so a rounded corner shows what is already underneath.
 */
export function blitWords(
  target: WordTarget,
  tile: Uint32Array,
  tileWidth: number,
  x: number,
  y: number,
  opaque: boolean,
): void {
  const tileHeight = tile.length / tileWidth;
  const left = Math.max(0, -x);
  const right = Math.min(tileWidth, target.width - x);
  if (right <= left) {
    return;
  }
  for (let row = 0; row < tileHeight; row += 1) {
    const ty = y + row;
    if (ty < 0 || ty >= target.height) {
      continue;
    }
    const from = row * tileWidth;
    const to = ty * target.width + x;
    if (opaque) {
      // A plain loop: sixteen words is too short for `set(subarray(...))` to
      // pay for the view it allocates.
      for (let column = left; column < right; column += 1) {
        target.words[to + column] = tile[from + column] ?? 0;
      }
      continue;
    }
    for (let column = left; column < right; column += 1) {
      const word = tile[from + column] ?? 0;
      if (word !== 0) {
        target.words[to + column] = word;
      }
    }
  }
}
