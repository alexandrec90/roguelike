/**
 * Generic transforms over pixel clouds: melt, freeze, burn.
 *
 * Because every renderable flattens to a `PixelCloud` (see `ink.ts`), a status
 * effect is a pure function of (cloud, progress, seed) rather than a set of
 * hand-drawn frames per model. The same `meltCloud` melts the hero, a slime,
 * or a prop; nothing needs to know what the pixels used to be.
 *
 * All three are deterministic: the same inputs give the same pixels, so the
 * lab can capture them and a test can assert on them. Progress runs 0..1 and
 * every function is the identity at 0 — a transform ramping in never pops.
 *
 * Cloud coordinates follow the renderer's anchor: (0, 0) is the foot on the
 * ground, y negative going up. "The ground" is therefore y = 0.
 */

import type { InkId, PixelCloud } from "./ink";

/** Per-pixel deterministic unit hash — the seeded die every transform rolls. */
export function pixelHash(x: number, y: number, seed: number, salt = 0): number {
  let h = Math.imul(x ^ (y << 16) ^ seed ^ Math.imul(salt, 0x9e3779b9), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

function clampProgress(progress: number): number {
  return Math.min(Math.max(progress, 0), 1);
}

function cloudHeight(cloud: PixelCloud): number {
  let top = 0;
  for (const pixel of cloud) {
    top = Math.min(top, pixel.y);
  }
  return -top;
}

/**
 * Melt: every pixel sags toward the ground at its own seeded rate, and pixels
 * that reach the ground pool sideways into a puddle two rows deep.
 *
 * Progress 1 is a puddle of the model's own inks; running progress back down
 * to 0 plays the melt in reverse, which is how a scene un-melts something
 * without any extra art.
 */
export function meltCloud(cloud: PixelCloud, progress: number, seed: number): PixelCloud {
  const p = clampProgress(progress);
  if (p === 0) {
    return [...cloud];
  }

  return cloud.map((pixel) => {
    const rate = 0.6 + 0.8 * pixelHash(pixel.x, pixel.y, seed, 1);
    // Smooth per-pixel ease that is 0 at p=0 and exactly 1 at p=1 for every
    // rate, so a finished melt is always a puddle — a plain `p * rate` would
    // strand the slow pixels in the air forever.
    const eased = (rate * p) / (rate * p + (1 - p));
    const fallen = pixel.y + (0 - pixel.y) * Math.min(eased, 1);
    const grounded = fallen >= -0.5;
    if (!grounded) {
      return { x: pixel.x, y: Math.round(fallen), ink: pixel.ink };
    }
    // Pooling: spread widens as the melt completes; depth is one of two rows.
    const spread = Math.round((pixelHash(pixel.x, pixel.y, seed, 2) * 2 - 1) * 5 * p);
    const row = pixelHash(pixel.x, pixel.y, seed, 3) < 0.35 ? -1 : 0;
    return { x: pixel.x + spread, y: row, ink: pixel.ink };
  });
}

/**
 * Freeze: ice climbs from the ground up. Frozen pixels re-ink to `ice`, with
 * seeded glints of white. Geometry is untouched — freezing is a surface, and
 * the scene expresses "stopped" by pinning the pose it renders, not here.
 */
export function freezeCloud(cloud: PixelCloud, progress: number, seed: number): PixelCloud {
  const p = clampProgress(progress);
  if (p === 0) {
    return [...cloud];
  }
  const height = cloudHeight(cloud);
  const frostLine = -p * (height + 1);

  return cloud.map((pixel) => {
    if (pixel.y < frostLine) {
      return pixel;
    }
    const glint = pixelHash(pixel.x, pixel.y, seed, 4) < 0.12;
    const ink: InkId = glint ? "bone" : "ice";
    // A punched hole (void) stays a hole — ice does not grow eyes.
    return pixel.ink === "void" ? pixel : { x: pixel.x, y: pixel.y, ink };
  });
}

/**
 * Burn: fire consumes from the ground up. Below the burn front pixels are
 * gone; in the two rows at the front they flare `ember`/`amber`; above it the
 * model is untouched. `burnFront` hands the flaring pixels to whatever spawns
 * ember particles, so the fire's light and its smoke agree on where the fire
 * is.
 */
export function burnCloud(cloud: PixelCloud, progress: number, seed: number): PixelCloud {
  const p = clampProgress(progress);
  if (p === 0) {
    return [...cloud];
  }
  const height = cloudHeight(cloud);
  const front = -p * (height + 3);

  const burned: PixelCloud = [];
  for (const pixel of cloud) {
    if (pixel.y > front + 2) {
      continue;
    }
    if (pixel.y > front) {
      const flare = pixelHash(pixel.x, pixel.y, seed, 5) < 0.5;
      burned.push({ x: pixel.x, y: pixel.y, ink: flare ? "ember" : "amber" });
    } else {
      burned.push(pixel);
    }
  }
  return burned;
}

/** The pixels currently on fire — ember-spawn points for the particle layer. */
export function burnFront(
  cloud: PixelCloud,
  progress: number,
): readonly { readonly x: number; readonly y: number }[] {
  const p = clampProgress(progress);
  if (p === 0) {
    return [];
  }
  const height = cloudHeight(cloud);
  const front = -p * (height + 3);
  return cloud
    .filter((pixel) => pixel.y <= front + 2 && pixel.y > front)
    .map((pixel) => ({ x: pixel.x, y: pixel.y }));
}

/**
 * A reflection for still water: the cloud flipped below its foot line,
 * vertically squashed, interlaced so scanlines of water show through, and
 * re-inked to a single dim water tone. The scene clips it to the puddle and
 * adds ripple by offsetting alternate rows.
 */
export function reflectCloud(
  cloud: PixelCloud,
  options: { readonly squash?: number; readonly interlace?: number } = {},
): PixelCloud {
  const squash = options.squash ?? 0.6;
  const interlace = options.interlace ?? 2;
  if (squash <= 0 || squash > 1) {
    throw new Error("Reflection squash must be in (0, 1]");
  }
  if (!Number.isInteger(interlace) || interlace < 1) {
    throw new Error("Reflection interlace must be a positive integer");
  }

  const reflected: PixelCloud = [];
  for (const pixel of cloud) {
    if (pixel.ink === "void") {
      continue;
    }
    const y = Math.round(-pixel.y * squash) + 1;
    if (y < 1 || y % interlace !== 1 % interlace) {
      continue;
    }
    reflected.push({ x: pixel.x, y, ink: "deep" });
  }
  return reflected;
}
