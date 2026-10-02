/**
 * What the far lip shows: ground seen from too far to point-sample.
 *
 * A far lip pixel spans several texels across and a dozen rows down, so the
 * texel under it changes on every step of scroll, and a point sample there is
 * noise that reshuffles as the hero walks. It used to show its cell's
 * commonest colour instead - one ink, the bare tile's - which held it still
 * but dropped everything else the field is made of: the lighter tile variants
 * and, above all, the grass. The near lip point-samples the tufts over the
 * tiles, so as the blur took over the meadow lost a third of its highlights in
 * four scanlines, and the far lip read as a band of another shade with a line
 * under it.
 *
 * So a far pixel shows a *far look*: the colours the ground shows, in their
 * shares, one picked per pixel by a hash of the screen pixel. The shares are
 * what the eye makes of the ground at that distance, so the far lip keeps the
 * near lip's shade and its speckle; the pick is locked to the screen, so a step
 * of scroll cannot reshuffle it. Every colour in a look is one the field
 * itself shows - nothing is averaged into existence.
 *
 * Pure. What a look is counted *from* is the caller's: `roll-ground.ts` counts
 * a tile, `far-looks.ts` the meadow as the field draws it.
 */

import { pixelHash } from "./transforms";

/** Slots in a far look: a colour on fewer than one far pixel in this many is dropped. */
export const FAR_LEVELS = 64;

/** Seeds the per-pixel pick; any constant, so a capture repeats. */
const FAR_SEED = 0xfa7;

/** Colours packed `0xRRGGBB`, each repeated in proportion to its share. */
export interface FarLook {
  readonly table: Uint32Array;
}

/** Count every opaque pixel of an RGBA buffer into `counts`, by packed colour. */
export function countColours(rgba: Uint8ClampedArray, counts: Map<number, number>): Map<number, number> {
  for (let at = 0; at < rgba.length; at += 4) {
    if ((rgba[at + 3] ?? 0) === 0) {
      continue;
    }
    const colour = ((rgba[at] ?? 0) << 16) | ((rgba[at + 1] ?? 0) << 8) | (rgba[at + 2] ?? 0);
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  return counts;
}

/**
 * A far look from colour counts: `FAR_LEVELS` slots shared out by largest
 * remainder, so the shares are as close as whole slots allow and the commonest
 * colour always has one. No counts at all is black.
 */
export function farLook(counts: ReadonlyMap<number, number>): FarLook {
  const entries = [...counts].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const table = new Uint32Array(FAR_LEVELS);
  if (total === 0) {
    return { table };
  }
  const shares = entries.map(([colour, count]) => {
    const exact = (count / total) * FAR_LEVELS;
    return { colour, slots: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let spare = FAR_LEVELS - shares.reduce((sum, share) => sum + share.slots, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.colour - b.colour)) {
    if (spare === 0) {
      break;
    }
    share.slots += 1;
    spare -= 1;
  }
  let slot = 0;
  for (const share of shares) {
    table.fill(share.colour, slot, slot + share.slots);
    slot += share.slots;
  }
  return { table };
}

/** Which slot of a far look the screen pixel (x, y) shows: the same one every frame. */
export function farSlot(x: number, y: number): number {
  return Math.min(Math.floor(pixelHash(x, y, FAR_SEED) * FAR_LEVELS), FAR_LEVELS - 1);
}

/** The mean colour of a far look, as `[r, g, b]` - what the eye makes of it. */
export function farMean(look: FarLook): readonly [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const colour of look.table) {
    r += (colour >> 16) & 0xff;
    g += (colour >> 8) & 0xff;
    b += colour & 0xff;
  }
  return [r / FAR_LEVELS, g / FAR_LEVELS, b / FAR_LEVELS];
}
