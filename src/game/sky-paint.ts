/**
 * Painting the sky above the horizon line into a pixel buffer — the pure half
 * of `sky-layer.ts`, so what the sky looks like at an hour is testable without
 * a canvas. See that file for what each part is and why. The ground on the
 * roll below the line is `roll-ground.ts`; only its haze colour is decided here.
 */

import type { Atmosphere } from "./atmosphere";
import { hexToRgb, mixHex, type Rgb } from "./color";
import { starField, type HorizonLayout, type Star } from "./horizon";
import { panoramaColumn, panoramaRidge, PANORAMA_WIDTH, wrapPanorama } from "./panorama";
import type { PixelBuffer } from "./pixel-buffer";
import { fbm3 } from "./procgen/noise";
import { ditherThreshold } from "./shading";

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55 } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26 } as const;

export class SkyPainter {
  private readonly stars: readonly Star[];
  private readonly ridges: { readonly profile: readonly number[]; readonly near: boolean }[];
  private readonly width: number;
  private clouds: Float32Array | undefined;

  constructor(
    private readonly buffer: PixelBuffer,
    private readonly layout: HorizonLayout,
  ) {
    this.width = buffer.width;
    this.stars = starField(PANORAMA_WIDTH, layout.skyHeight);
    this.ridges = [RIDGE_FAR, RIDGE_NEAR].map((ridge, index) => ({
      profile: panoramaRidge({ ...ridge, maxHeight: layout.horizonY }),
      near: index === 1,
    }));
  }

  /** Cloud density over the whole panorama, two rows of margin above: built once. */
  private cloudField(): Float32Array {
    if (this.clouds === undefined) {
      const rows = this.layout.skyHeight + 2;
      const field = new Float32Array(PANORAMA_WIDTH * rows);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < PANORAMA_WIDTH; column += 1) {
          field[row * PANORAMA_WIDTH + column] = cloudAt(column, row - 2);
        }
      }
      this.clouds = field;
    }
    return this.clouds;
  }

  /** The whole band for one moment: `offset` is the bearing, `drift` the clouds' own travel. */
  paint(atmosphere: Atmosphere, offset: number, elapsedMs: number, drift: number): void {
    this.buffer.data.fill(0);
    this.paintSky(atmosphere);
    this.paintStars(atmosphere, offset, elapsedMs);
    this.paintSun(atmosphere);
    this.paintClouds(atmosphere, offset, drift);
    this.paintRidges(atmosphere, offset);
    this.unlight(atmosphere.ambient);
  }

  /**
   * Divide the sky by the ambient it is about to be multiplied by.
   *
   * The lighting pass multiplies the whole frame, sky included — it has to,
   * because a tree standing on the horizon crosses into the band and must be
   * lit like the rest of it. The sky's colours are already the colours of the
   * hour, so they are painted *pre-divided*: after the pass multiplies them
   * back they land exactly on what the atmosphere asked for. Where a colour is
   * brighter than the ambient allows, it clamps — the brightest stars on a
   * moonlit night are as bright as the moonlight, which is also true outdoors.
   */
  private unlight(ambient: string): void {
    const light = hexToRgb(ambient);
    const scale = [255 / Math.max(light.r, 1), 255 / Math.max(light.g, 1), 255 / Math.max(light.b, 1)];
    const data = this.buffer.data;
    const end = this.layout.horizonY * this.buffer.width * 4;
    for (let offset = 0; offset < end; offset += 4) {
      data[offset] = (data[offset] ?? 0) * (scale[0] as number);
      data[offset + 1] = (data[offset + 1] ?? 0) * (scale[1] as number);
      data[offset + 2] = (data[offset + 2] ?? 0) * (scale[2] as number);
    }
  }

  private put(x: number, y: number, rgb: Rgb, alpha = 1): void {
    const buffer = this.buffer;
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
      return;
    }
    const offset = (y * buffer.width + x) * 4;
    const keep = 1 - alpha;
    const data = buffer.data;
    data[offset] = rgb.r * alpha + (data[offset] ?? 0) * keep;
    data[offset + 1] = rgb.g * alpha + (data[offset + 1] ?? 0) * keep;
    data[offset + 2] = rgb.b * alpha + (data[offset + 2] ?? 0) * keep;
    data[offset + 3] = 255;
  }

  /** Zenith to horizon in eight dithered steps per band. */
  private paintSky(atmosphere: Atmosphere): void {
    const height = this.layout.skyHeight;
    const steps = 8;
    const colours = Array.from({ length: steps + 1 }, (_unused, index) =>
      hexToRgb(mixHex(atmosphere.skyTop, atmosphere.skyHorizon, (index / steps) ** 1.4)),
    );
    for (let y = 0; y < height; y += 1) {
      const t = (y / Math.max(height - 1, 1)) * steps;
      const base = Math.floor(t);
      for (let x = 0; x < this.width; x += 1) {
        const index = t - base > ditherThreshold(x, y) ? base + 1 : base;
        this.put(x, y, colours[Math.min(index, steps)] as Rgb);
      }
    }
  }

  private paintStars(atmosphere: Atmosphere, offset: number, elapsedMs: number): void {
    if (atmosphere.starAlpha <= 0.02) {
      return;
    }
    const bright = hexToRgb("#f4f1ff");
    const dim = hexToRgb("#9aa6d8");
    for (const star of this.stars) {
      const x = wrapPanorama(star.x - offset);
      if (x >= this.width || star.y >= this.layout.skyHeight - 2) {
        continue;
      }
      // A slow seeded twinkle: each star has its own phase.
      const twinkle = 0.65 + 0.35 * Math.sin(elapsedMs / 700 + star.x * 1.7 + star.y);
      const alpha = atmosphere.starAlpha * twinkle * (star.bright ? 1 : 0.7);
      if (alpha > ditherThreshold(x, star.y) * 0.9) {
        this.put(x, star.y, star.bright ? bright : dim, Math.min(1, alpha + 0.2));
      }
    }
  }

  /**
   * The sun by day and the moon by night, riding the light's own arc: rising on
   * the left, highest at the top of the band, setting on the right.
   */
  private paintSun(atmosphere: Atmosphere): void {
    const sky = this.layout.skyHeight;
    const cx = Math.round(this.width / 2 + atmosphere.light.x * this.width * 0.42);
    const cy = Math.round(this.layout.horizonY - 2 - atmosphere.elevation * Math.max(sky - 6, 1));
    const day = atmosphere.daylight > 0.5;
    const core = hexToRgb(day ? "#fff6d8" : "#e4ecff");
    const rim = hexToRgb(day ? mixHex("#ffd27a", atmosphere.skyHorizon, 0.2) : "#b8c4e8");
    const halo = hexToRgb(day ? "#ffe9b0" : "#9fb0dd");
    const veil = 1 - atmosphere.overcast * 0.8;
    const radius = day ? 3 : 2.5;
    for (let dy = -8; dy <= 8; dy += 1) {
      for (let dx = -10; dx <= 10; dx += 1) {
        const distance = Math.hypot(dx, dy);
        const x = cx + dx;
        const y = cy + dy;
        if (distance <= radius) {
          // The moon is a crescent: its lit side faces where the sun went.
          const shadowed = !day && Math.hypot(dx + 1.4, dy - 0.6) < radius - 0.3;
          this.put(x, y, shadowed ? halo : distance > radius - 1 ? rim : core, shadowed ? 0.35 : veil);
        } else if (distance < radius + 6) {
          const fade = (1 - (distance - radius) / 6) * 0.45 * veil;
          if (fade > ditherThreshold(x, y)) {
            this.put(x, y, halo, 0.5);
          }
        }
      }
    }
  }

  /**
   * Cloud: fBm at a bearing, thresholded by how overcast it is, and lit — the
   * edge facing the sun catches it, the belly facing away is the sky's shade.
   */
  private paintClouds(atmosphere: Atmosphere, offset: number, drift: number): void {
    const cover = 0.62 - atmosphere.overcast * 0.34;
    const lit = hexToRgb(mixHex(mixHex(atmosphere.skyHorizon, "#ffffff", 0.55), atmosphere.ambient, 0.3));
    const shade = hexToRgb(mixHex(atmosphere.skyTop, atmosphere.skyHorizon, 0.55));
    const sunSide = Math.sign(atmosphere.light.x) || 1;
    const height = this.layout.skyHeight;
    // The cloud field is static at a bearing and only *drifts*, so it is
    // evaluated once for the whole panorama and every repaint reads it — which
    // is what keeps a continuous turn, repainting every frame, cheap.
    const field = this.cloudField();
    const start = Math.round(offset + drift);
    const sample = (x: number, y: number): number =>
      field[(y + 2) * PANORAMA_WIDTH + wrapPanorama(start + x)] ?? 0;
    for (let y = 0; y < height - 1; y += 1) {
      const band = 1 - Math.abs(y / height - 0.45) * 1.4;
      for (let x = 0; x < this.width; x += 1) {
        const density = sample(x, y) * band;
        if (density < cover) {
          continue;
        }
        const ahead = sample(x + sunSide * 3, y - 2) * band;
        const bright = ahead < density ? 1 : 0.35;
        const level = Math.min(1, (density - cover) * 7) * bright;
        this.put(x, y, level > ditherThreshold(x, y) ? lit : shade, 0.9);
      }
    }
  }

  private paintRidges(atmosphere: Atmosphere, offset: number): void {
    const horizonY = this.layout.horizonY;
    for (const ridge of this.ridges) {
      const colour = hexToRgb(
        ridge.near
          ? mixHex(atmosphere.haze, "#101820", 0.45)
          : mixHex(atmosphere.haze, atmosphere.skyHorizon, 0.35),
      );
      for (let x = 0; x < this.width; x += 1) {
        const height = ridge.profile[panoramaColumn(x, offset)] ?? 0;
        for (let y = horizonY - height; y < horizonY; y += 1) {
          this.put(x, y, colour);
        }
      }
    }
  }

}

/**
 * The air at the horizon, divided by the ambient it is about to be multiplied by.
 *
 * The haze the far ground dissolves into is air, not ground: the ground on the
 * roll (`roll-ground.ts`) is lit like the field, but its haze has to meet the
 * horizon in the sky's own colour once the lighting pass has run - the same
 * pre-division `unlight` gives the sky, clamped where the ambient cannot reach.
 */
export function unlitHaze(atmosphere: Atmosphere): Rgb {
  const light = hexToRgb(atmosphere.ambient);
  const air = hexToRgb(atmosphere.haze);
  return {
    r: Math.min(255, Math.round((air.r * 255) / Math.max(light.r, 1))),
    g: Math.min(255, Math.round((air.g * 255) / Math.max(light.g, 1))),
    b: Math.min(255, Math.round((air.b * 255) / Math.max(light.b, 1))),
  };
}

/** Radius of the circle the cloud noise is read around, in noise units. */
const CLOUD_RING = PANORAMA_WIDTH / (Math.PI * 2) / 38;

/**
 * Cloud density at a panorama column, read around a circle in noise space so
 * the sky closes on itself: a full turn comes back to the same cloud with no
 * seam where the panorama wraps.
 */
function cloudAt(column: number, y: number): number {
  const angle = (wrapPanorama(column) / PANORAMA_WIDTH) * Math.PI * 2;
  return fbm3(Math.cos(angle) * CLOUD_RING, Math.sin(angle) * CLOUD_RING, y / 7, 0xc10d, { octaves: 3 });
}
