/**
 * The parts every species shares: cast shadow, leaf mass, bark, litter.
 *
 * These are the pieces that would otherwise be redrawn eight times, once per
 * species, and would then disagree with each other the first time the light
 * direction changed. Each takes a cloud or an anchor and returns pixels, so a
 * species composes them rather than reimplementing them.
 *
 * The shadow deserves a note, because a shadow on a pitch-black field sounds
 * impossible. It is not drawn dark — it is drawn in `void`, the deliberate
 * black ink, which *punches a hole* through whatever lit ground is underneath.
 * Over bare background it is correctly invisible; over grass, a path or a
 * puddle it removes exactly the pixels the canopy would have blocked. That is
 * the same trick the hero's eyes use, applied to the ground.
 */

import { cloudBounds } from "../ink";
import { pixelHash } from "../transforms";
import { fbm3 } from "../procgen/noise";
import { ditherThreshold, rampInk } from "../shading";
import type { InkId, PixelCloud } from "../ink";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";

/** How far a pixel's height is foreshortened when it lands on the ground. */
const GROUND_SQUASH = TILE_DEPTH / TILE_WIDTH;

/** How far from the trunk a shadow pixel may land, in logical pixels. */
const MAX_SHADOW_REACH = 26;

export interface ShadowOptions {
  /** Screen-space light; +y is down. The shadow falls the other way. */
  readonly light: { readonly x: number; readonly y: number };
  /** Sun height: 1 is noon (a puddle of shadow), 0.2 is a long evening rake. */
  readonly elevation?: number;
  /** Fraction of the shadow's far end that dithers away, 0..1. */
  readonly softness?: number;
  readonly seed?: number;
}

/**
 * The canopy's own silhouette, projected onto the ground and foreshortened.
 *
 * Every lit pixel casts from its height: the taller it is, the further
 * downwind-of-the-light it lands, and the more the ordered dither eats it —
 * which is contact hardening, the property that makes a shadow read as
 * belonging to the thing above it rather than as a decal under it.
 */
export function castShadow(cloud: PixelCloud, options: ShadowOptions): PixelCloud {
  const elevation = Math.max(options.elevation ?? 0.55, 0.05);
  const softness = Math.min(Math.max(options.softness ?? 0.7, 0), 1);
  const seed = options.seed ?? 0x5ad0;
  const length = Math.hypot(options.light.x, options.light.y) || 1;
  const slope = -(options.light.x / length) / elevation;

  // The cap is applied to the *tallest* pixel and everything else scales under
  // it, rather than being clamped pixel by pixel. Clamping each one collapses
  // every pixel above the cap onto a single row, which draws the canopy's
  // shadow as one black stripe across the ground — the honest length is simply
  // unusable at this size, but shortening it must not also flatten it.
  const tallest = Math.max(1, -(cloudBounds(cloud)?.top ?? 0));
  const spread = Math.min((tallest / elevation) * 0.35, MAX_SHADOW_REACH) / tallest;

  const placed = new Set<number>();
  const shadow: PixelCloud = [];
  for (const pixel of cloud) {
    const height = -pixel.y;
    if (height <= 0) {
      continue;
    }
    const reach = height * spread;
    const x = Math.round(pixel.x + reach * slope * elevation);
    const y = Math.round(reach * GROUND_SQUASH * 0.45);
    const key = (x + 512) * 4096 + (y + 512);
    if (placed.has(key)) {
      continue;
    }
    // Far from contact the shadow both spreads and thins; the Bayer test is
    // what makes that thinning look like penumbra instead of like noise.
    const distance = Math.min(height / 34, 1);
    if (distance * softness > ditherThreshold(x, y) * 0.9 + pixelHash(x, y, seed) * 0.25) {
      continue;
    }
    placed.add(key);
    shadow.push({ x, y, ink: "void" });
  }
  return shadow;
}

export interface LeafOptions {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly seed: number;
  /** Elapsed ms; the mass boils in place rather than sliding. */
  readonly elapsedMs: number;
  readonly ramp: readonly InkId[];
  /** Sideways displacement of the noise domain — the wind blowing through it. */
  readonly drift?: number;
}

/**
 * A clump of leaves as a thresholded noise field inside an elliptical falloff.
 *
 * The falloff decides the shape, the noise decides the edge, and time decides
 * the flutter. Nothing here is a drawn cluster: two clumps at different seeds
 * are different clumps, and the same clump a quarter second later has a
 * different silhouette without having moved.
 */
export function leafCluster(cloud: PixelCloud, options: LeafOptions): void {
  const drift = options.drift ?? 0;
  for (let dy = -options.radiusY - 1; dy <= options.radiusY + 1; dy += 1) {
    for (let dx = -options.radiusX - 1; dx <= options.radiusX + 1; dx += 1) {
      const falloff =
        1 -
        ((dx * dx) / (options.radiusX * options.radiusX) +
          (dy * dy) / (options.radiusY * options.radiusY));
      if (falloff <= 0) {
        continue;
      }
      const density = leafDensity(dx, dy, drift, options);
      if (density < 0.5) {
        continue;
      }
      // Remapped rather than used raw: density runs 0.5..1.15, and handing that
      // straight to a three-step ramp puts most of the clump on the top step,
      // which is a white bush. The body belongs on the middle step, with the
      // highlight rare enough to still read as a highlight.
      const level = (density - 0.5) * 1.15;
      cloud.push({
        x: options.x + dx,
        y: options.y + dy,
        ink: rampInk(options.ramp, level, { x: options.x + dx, y: options.y + dy }),
      });
    }
  }
}

function leafDensity(dx: number, dy: number, drift: number, options: LeafOptions): number {
  const falloff =
    1 -
    ((dx * dx) / (options.radiusX * options.radiusX) +
      (dy * dy) / (options.radiusY * options.radiusY));
  const churn = fbm3(
    (dx + drift) / 3.4,
    dy / 2.6,
    options.elapsedMs / 1400,
    options.seed,
    { octaves: 2 },
  );
  // Falloff sets how much of the clump exists at all; the noise decides which
  // pixels of it are leaf and, one ramp step up, which are catching light.
  return Math.min(falloff * 1.35, 1) * 0.62 + churn * 0.55;
}

/**
 * Bark: a trunk column textured by noise rather than by a drawn stripe.
 *
 * Sampled in *world* coordinates so the texture stays put while the trunk
 * bends through it, which is the difference between bark and a painted pattern
 * sliding around on a bending pole.
 */
export function barkInk(x: number, y: number, seed: number, ramp: readonly InkId[]): InkId {
  const grain = fbm3(x / 1.6, y / 7, 0, seed, { octaves: 2 });
  // Held to the bottom half of the ramp on purpose. Wood is the darkest thing
  // on the tree — let it reach `ice` and the trunk out-competes the canopy for
  // the eye, which is exactly backwards: the silhouette is the leaves.
  return rampInk(ramp, 0.06 + grain * 0.42, { x, y });
}

/**
 * Nothing a tree draws may sink below its own foot — the ground is `y = 0`.
 *
 * Two things reach past it by accident and both are easy to miss: an odd
 * `strokeLine` thickness centres a 3px brush on the root pixel and paints a row
 * underneath it, and a simulated frond long enough to reach the ground carries
 * on through it. Both look like the tree is standing in a hole.
 */
export function rooted(cloud: PixelCloud): PixelCloud {
  return cloud.filter((pixel) => pixel.y <= 0);
}

/**
 * Fallen leaves and twigs at the foot, so the trunk does not look posted into
 * the ground like a sign. Seeded and static: litter does not animate.
 */
export function litter(cloud: PixelCloud, spread: number, seed: number, ink: InkId): void {
  for (let index = 0; index < spread; index += 1) {
    const x = Math.round((pixelHash(index, 0, seed, 5) - 0.5) * spread * 2.4);
    const y = -Math.round(pixelHash(index, 0, seed, 6) * 1.6);
    if (pixelHash(x, y, seed, 7) > 0.55) {
      cloud.push({ x, y, ink });
    }
  }
}
