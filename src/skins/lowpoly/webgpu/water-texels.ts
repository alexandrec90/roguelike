/**
 * Where water can be, as one two-channel texture for the WebGPU backend: red
 * is the puddle field's basin (`puddle-field.ts`, the same bytes), green is
 * 255 inside a lake's reach. The wave simulation and the water shader both ask
 * "is this cell water" with one read - a basin over the level, or a lake - so
 * a wave and the water it moves in are the same shape.
 */

import { planetLakes, type Lake } from "../../../game/lakes";
import { FIELD_SIZE, TEXELS_PER_TILE } from "../../../game/water/puddle-field";

/** `rg8unorm` texels, row-major from planet (0, 0): basin, then lake. */
export function waterTexels(field: Uint8Array, lakes: readonly Lake[] = planetLakes()): Uint8Array {
  const texels = new Uint8Array(FIELD_SIZE * FIELD_SIZE * 2);
  for (let index = 0; index < field.length; index += 1) {
    texels[index * 2] = field[index] ?? 0;
  }
  for (const lake of lakes) {
    const reach = Math.ceil(lake.reach * TEXELS_PER_TILE) + 1;
    const ci = Math.floor(lake.x * TEXELS_PER_TILE);
    const cj = Math.floor(lake.y * TEXELS_PER_TILE);
    for (let j = cj - reach; j <= cj + reach; j += 1) {
      for (let i = ci - reach; i <= ci + reach; i += 1) {
        const dx = (i + 0.5) / TEXELS_PER_TILE - lake.x;
        const dy = (j + 0.5) / TEXELS_PER_TILE - lake.y;
        if (Math.hypot(dx, dy) < lake.reach) {
          const wi = ((i % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
          const wj = ((j % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
          texels[(wj * FIELD_SIZE + wi) * 2 + 1] = 255;
        }
      }
    }
  }
  return texels;
}
