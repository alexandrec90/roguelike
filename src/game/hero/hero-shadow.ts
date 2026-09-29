/**
 * The hero's shadow: his own silhouette thrown across the ground, plus the
 * dark pool right under his boots that says he is standing *on* it.
 *
 * The throw is the trees' `castShadow` — the same projection, the same contact
 * hardening — so his shadow and a tree's agree about where the sun is. The
 * pool is what that projection cannot give a figure this small: at noon the
 * cast collapses into a sliver, and a figure with no dark under his feet reads
 * as pasted onto the grass.
 */

import type { PixelCloud } from "../ink";
import { castShadow } from "../trees/foliage";

export interface ShadowLight {
  /** Screen-space, toward the lamp; +y is down. */
  readonly light: { readonly x: number; readonly y: number };
  /** 0.15 raking .. 1 noon. */
  readonly elevation: number;
}

/** Half-width and half-depth of the pool under his feet, pixels. */
const POOL_RX = 4.6;
const POOL_RY = 1.6;

export function contactPool(): PixelCloud {
  const cloud: PixelCloud = [];
  const reach = Math.ceil(POOL_RX);
  for (let y = -1; y <= Math.ceil(POOL_RY); y += 1) {
    for (let x = -reach; x <= reach; x += 1) {
      const d = (x / POOL_RX) ** 2 + ((y - 0.3) / POOL_RY) ** 2;
      if (d <= 1) {
        cloud.push({ x, y, ink: d < 0.45 ? "shadow" : "shadow-soft" });
      }
    }
  }
  return cloud;
}

/** His shadow for this frame: the pool, then the throw over it, one pixel each. */
export function heroShadow(cloud: PixelCloud, sun: ShadowLight): PixelCloud {
  const thrown = castShadow(cloud, { light: sun.light, elevation: sun.elevation, softness: 0.55, seed: 0x5ade });
  const seen = new Set<number>();
  const shadow: PixelCloud = [];
  // The throw first so its hard core wins over the pool's soft rim.
  for (const pixel of [...thrown, ...contactPool()]) {
    const key = (pixel.x + 512) * 2048 + (pixel.y + 512);
    if (!seen.has(key)) {
      seen.add(key);
      shadow.push(pixel);
    }
  }
  return shadow;
}
