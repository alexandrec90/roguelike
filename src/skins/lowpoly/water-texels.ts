/**
 * Where water can be, as one two-channel texture both backends read: red is
 * the puddle field's basin (`puddle-field.ts`, the same bytes), green how far
 * inside a lake's shore a texel lies - a signed distance, 0.5 on the shore line,
 * `LAKE_RANGE_TILES` across the channel. The wave simulation asks "is this cell
 * water" with one read - a basin over the level, or green past a half - and the
 * ground shader draws a lake from the same distance, so a wave, the water it
 * moves in and the water on screen are one shape. A distance rather than a flag
 * because it filters: a bilinear read of it is a smooth shore, not a staircase
 * of texels.
 */

import { lakeDistance, planetLakes, type Lake } from "../../game/lakes";
import { FIELD_SIZE, TEXELS_PER_TILE } from "../../game/water/puddle-field";
import { hash01 } from "./palette";

/** Tiles from the green channel's 0 to its 1: a lake's shore is the middle, this much either side shows. */
export const LAKE_RANGE_TILES = 8;

/** Lobes round a lake's shore: enough to read as a puddle's outline, not a circle. */
const LAKE_LOBES = 9;

/**
 * How far a lake's shore stands from its centre at a bearing, tiles: between
 * its `shore` and its `reach`, by a seeded radius per lobe eased into the next -
 * the planet half's promise, that the water covers at least `shore` and never
 * passes `reach`, whichever way the world has turned.
 */
export function lakeShoreAt(lake: Lake, angle: number): number {
  const turn = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  const at = turn * LAKE_LOBES;
  const lobe = Math.floor(at);
  const radius = (corner: number): number => hash01(lake.seed + (corner % LAKE_LOBES) * 13);
  const ease = (1 - Math.cos((at - lobe) * Math.PI)) / 2;
  const share = radius(lobe) + (radius(lobe + 1) - radius(lobe)) * ease;
  return lake.shore + (lake.reach - lake.shore) * share;
}

/** `rg8unorm` texels, row-major from planet (0, 0): basin, then tiles inside a lake's shore. */
export function waterTexels(field: Uint8Array, lakes: readonly Lake[] = planetLakes()): Uint8Array {
  const texels = new Uint8Array(FIELD_SIZE * FIELD_SIZE * 2);
  for (let index = 0; index < field.length; index += 1) {
    texels[index * 2] = field[index] ?? 0;
  }
  for (const lake of lakes) {
    // Out to where the distance has fallen to 0, so nothing is cut short at the box's edge.
    const span = Math.ceil((lake.reach + LAKE_RANGE_TILES / 2) * TEXELS_PER_TILE) + 1;
    const ci = Math.floor(lake.x * TEXELS_PER_TILE);
    const cj = Math.floor(lake.y * TEXELS_PER_TILE);
    for (let j = cj - span; j <= cj + span; j += 1) {
      for (let i = ci - span; i <= ci + span; i += 1) {
        const point = { x: (i + 0.5) / TEXELS_PER_TILE, y: (j + 0.5) / TEXELS_PER_TILE };
        const inside = lakeShoreAt(lake, Math.atan2(point.y - lake.y, point.x - lake.x)) - lakeDistance(lake, point);
        const value = Math.min(Math.max(Math.round(127.5 + (inside * 255) / LAKE_RANGE_TILES), 0), 255);
        const index = ((((j % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE) * FIELD_SIZE + (((i % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE)) * 2 + 1;
        texels[index] = Math.max(texels[index] ?? 0, value);
      }
    }
  }
  return texels;
}
