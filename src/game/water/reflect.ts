/**
 * What standing water gives back of the things standing over it.
 *
 * One function for anything — the hero, a slime, the campfire, a signpost —
 * because it is written against the cloud, not against a model:
 *
 * - **flipped** about the foot line and slightly **squashed** (`reflectCloud`),
 *   so the image hangs *down* from where the thing stands;
 * - **darkened in its own hue** — a family ink steps two places down its own
 *   ramp, so a blue tunic reflects a deeper blue rather than a grey, and the
 *   reflection is always dimmer than what it reflects;
 * - **rippled** — alternate rows slide a pixel against each other, harder while
 *   it rains, which is the one cue that turns a mirror into water;
 * - **fading with depth** — dithered away toward the bottom of the image, since
 *   a puddle is a dark mirror and loses the far end of a long reflection.
 *
 * Emissive things (a flame, a glowing blade) pass `glow` and keep their inks
 * one step down instead of two: fire in water is still fire.
 *
 * Clipping to the water is the caller's (the layer holds the mask), so this is
 * a pure `(cloud, foot, time) → cloud` and testable without a puddle.
 */

import type { InkId, PixelCloud } from "../ink";
import { INK_FAMILIES, type Family } from "../palette";
import { quantizedWave } from "../pixel-art";
import { ditherThreshold } from "../shading";
import { reflectCloud } from "../transforms";

/** Anything the water should reflect this frame, in screen pixels. */
export interface Reflectable {
  readonly cloud: PixelCloud;
  /** Where the cloud's (0, 0) is drawn: the thing's foot. */
  readonly foot: { readonly x: number; readonly y: number };
  /** Emissive: darkened one ramp step instead of two. */
  readonly glow?: boolean;
}

/** The first palette's inks have no ramp to step down; each maps to the family ink it darkens into. */
const LEGACY_DARK: Partial<Record<InkId, InkId>> = {
  bone: "frost-3",
  ice: "frost-2",
  cyan: "frost-2",
  amber: "fire-4",
  ember: "fire-3",
  "neon-green": "grass-3",
  magenta: "arcane-2",
  violet: "arcane-2",
  steel: "water-2",
  deep: "water-1",
  water: "water-0",
  foam: "frost-3",
};

const DARKENED = new Map<string, InkId>();

/** An ink `steps` places darker along its own family's ramp; never lighter. */
export function darkenInk(ink: InkId, steps = 2): InkId {
  const key = `${ink}/${steps}`;
  const cached = DARKENED.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let result: InkId = LEGACY_DARK[ink] ?? ink;
  const cut = ink.lastIndexOf("-");
  const family = ink.slice(0, cut) as Family;
  if (cut > 0 && family in INK_FAMILIES && family !== "petal") {
    const index = Number(ink.slice(cut + 1));
    if (Number.isInteger(index)) {
      result = `${family}-${Math.max(index - steps, 0)}` as InkId;
    }
  }
  DARKENED.set(key, result);
  return result;
}

/** How tall a reflection is compared to the thing, before the fade eats its end. */
export const REFLECTION_SQUASH = 0.85;

/** Rows of reflection that survive before the fade starts. */
const CLEAR_ROWS = 4;

/**
 * The reflection of `cloud`, standing at `(footX, footY)`, as absolute screen
 * pixels — unclipped. `rain` 0..1 roughens the ripple.
 */
export function reflectionCloud(
  cloud: PixelCloud,
  footX: number,
  footY: number,
  elapsedMs: number,
  options: { readonly rain?: number; readonly glow?: boolean } = {},
): PixelCloud {
  const rain = Math.min(Math.max(options.rain ?? 0, 0), 1);
  const steps = options.glow === true ? 1 : 2;
  const flipped = reflectCloud(cloud, { ink: null, squash: REFLECTION_SQUASH, interlace: 1 });
  let deepest = 1;
  for (const pixel of flipped) {
    deepest = Math.max(deepest, pixel.y);
  }
  const fadeRows = Math.max(deepest - CLEAR_ROWS, 1);
  const period = 1700 - rain * 900;
  const amplitude = 1 + Math.round(rain);

  const out: PixelCloud = [];
  for (const pixel of flipped) {
    const x0 = footX + pixel.x;
    const y = footY + pixel.y;
    const fade = Math.max(pixel.y - CLEAR_ROWS, 0) / fadeRows;
    if (fade * 0.9 > ditherThreshold(x0, y)) {
      continue;
    }
    const sway = quantizedWave(elapsedMs + pixel.y * 90, period, amplitude, pixel.y % 2 === 0 ? 0 : Math.PI);
    out.push({ x: x0 + sway, y, ink: darkenInk(pixel.ink, steps) });
  }
  return out;
}
