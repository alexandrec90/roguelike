/**
 * What the sky shader is handed each frame (`?sky=hd`) - the pure half of
 * `sky-hd-layer.ts`, so it is testable without a context.
 *
 * The pixel sky (`sky-paint.ts`) is drawn at 320×180 like everything else, and
 * the sky is the one part of the picture that suffers for it: a sun is a
 * six-pixel disc, a gradient is eight dithered bands, and a cloud is a stack of
 * scanlines that steps a whole logical pixel at a time as it drifts. Scaled up
 * by six, each of those is a block of 36 screen pixels. Nothing up there is a
 * character or a prop - it is air - so it has nothing to lose by being drawn at
 * the screen's own resolution, behind a world that keeps its pixels.
 *
 * It is the *same sky*, not a second one. The colours are the atmosphere's
 * (`atmosphere.ts`), the sun rides the same arc to the same place, and the
 * clouds are the very cumulus `sky-clouds.ts` lays round the panorama - its
 * slots, its puffs, its overcast growth - handed over as puff circles for the
 * shader to evaluate per screen pixel instead of rasterised to logical ones.
 * What changes is only the resolution, and with it three things the grid
 * forced: the bearing and the drift are continuous rather than whole pixels,
 * and the light across a cloud is a smooth ramp between its three tones rather
 * than a dithered step.
 *
 * Coordinates stay logical throughout - x across the 320, y down from the top
 * of the band - and the shader divides `gl_FragCoord` down to them, so a puff's
 * radius here is the radius the pixel sky would have drawn.
 */

import type { UniformValue } from "../engine";
import type { Atmosphere } from "./atmosphere";
import { hexToRgb, mixHex } from "./color";
import type { HorizonLayout } from "./horizon";
import { PANORAMA_WIDTH, wrapPanorama } from "./panorama";
import { CLOUD_DECKS, cloudTones, deckClouds, FLATTEN, SKY_DRIFT, type CloudDeck, type Cumulus, type CloudTones } from "./sky-clouds";

/** Most clouds the shader reads in one frame; about twenty are ever on screen at once. */
export const MAX_SKY_CLOUDS = 40;

/** Most puffs one cloud is built from (`sky-clouds.ts` makes three to five). */
export const MAX_CLOUD_PUFFS = 5;

/** Texels a cloud takes in the data texture: its head, its extent, then a puff each. */
export const CLOUD_TEXELS = 2 + MAX_CLOUD_PUFFS;

/** Floats one cloud takes: four channels a texel. */
const CLOUD_FLOATS = CLOUD_TEXELS * 4;

const TAU = Math.PI * 2;

/** The panorama column at screen x 0 for a heading - continuous, unlike `bearingOffset`. */
export function panoramaOffset(turn: number): number {
  return wrapPanorama((turn / TAU) * PANORAMA_WIDTH);
}

/** How far the clouds have travelled on their own after `elapsedMs`, panorama pixels. */
export function skyDrift(elapsedMs: number): number {
  return (elapsedMs * SKY_DRIFT) / 1000;
}

/** Where on the panorama the sky is looking, and how much of it there is. */
export interface CloudView {
  /** Panorama column at screen x 0, before each deck's own drift. */
  readonly offset: number;
  readonly drift: number;
  readonly overcast: number;
  /** Logical pixels across the screen. */
  readonly width: number;
  readonly skyHeight: number;
}

const DECK_CACHE = new Map<CloudDeck, { readonly overcast: number; readonly clouds: readonly Cumulus[] }>();

/** A deck's clouds, rebuilt only when the overcast moves: the shader asks every frame. */
function cachedClouds(deck: CloudDeck, overcast: number): readonly Cumulus[] {
  const cached = DECK_CACHE.get(deck);
  if (cached !== undefined && cached.overcast === overcast) {
    return cached.clouds;
  }
  const clouds = deckClouds(deck, overcast);
  DECK_CACHE.set(deck, { overcast, clouds });
  return clouds;
}

/**
 * Every cloud on screen, written into `out` a row of `CLOUD_TEXELS` texels
 * each, farthest deck first - the order the shader lays them over the sky in.
 * Returns how many rows it wrote. Per cloud:
 *
 *     texel 0      centre x, base y, deck alpha, puff count
 *     texel 1      reach either side (`cloudReach`), height over the base, seed, 0
 *     texel 2..    puff: x from the centre, lift over the base, radius, 0
 *
 * The base is the scanline the pixel sky would have cut the cloud flat at; a
 * puff's vertical radius is `radius * FLATTEN`. A cloud straddling the
 * panorama's seam is written at both of its screen positions, as the pixel sky
 * draws it.
 */
export function writeCloudTexels(out: Float32Array, view: CloudView, decks: readonly CloudDeck[] = CLOUD_DECKS): number {
  let rows = 0;
  for (const deck of decks) {
    const base = Math.round(view.skyHeight * deck.base);
    const start = view.offset + view.drift * deck.drift;
    for (const cloud of cachedClouds(deck, view.overcast)) {
      const reach = cloudReach(cloud) + 2;
      const centre = wrapPanorama(cloud.x - start);
      for (const at of [centre, centre - PANORAMA_WIDTH]) {
        if (at + reach < 0 || at - reach >= view.width || rows >= MAX_SKY_CLOUDS) {
          continue;
        }
        writeCloud(out, rows * CLOUD_FLOATS, cloud, at, base + cloud.sag, deck.alpha);
        rows += 1;
      }
    }
  }
  return rows;
}

/**
 * How far either side of its centre a cloud's puffs reach. A little past its
 * `halfWidth`: the outer puffs are jittered, and the pixel sky crops them at
 * its loop's edge where this lets them round off.
 */
export function cloudReach(cloud: Cumulus): number {
  return Math.max(cloud.halfWidth, ...cloud.puffs.map((puff) => Math.abs(puff.x) + puff.radius));
}

function writeCloud(out: Float32Array, at: number, cloud: Cumulus, x: number, base: number, alpha: number): void {
  const puffs = cloud.puffs.slice(0, MAX_CLOUD_PUFFS);
  const height = Math.max(...puffs.map((puff) => puff.lift + puff.radius * FLATTEN));
  out.set([x, base, alpha, puffs.length, cloudReach(cloud), height, cloud.x, 0], at);
  puffs.forEach((puff, index) => {
    out.set([puff.x, puff.lift, puff.radius, 0], at + 8 + index * 4);
  });
}

/** The sun or the moon: where it stands in logical pixels, how big, and how much the cloud veils it. */
export interface SkyDisc {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly veil: number;
  /** The sun by day, the moon by night - a crescent. */
  readonly day: boolean;
}

/** The disc on the light's own arc: the pixel sky's `paintSun`, unrounded. */
export function skyDisc(atmosphere: Atmosphere, layout: HorizonLayout, width: number): SkyDisc {
  const day = atmosphere.daylight > 0.5;
  return {
    x: width / 2 + atmosphere.light.x * width * 0.42,
    y: layout.horizonY - 2 - atmosphere.elevation * Math.max(layout.skyHeight - 6, 1),
    radius: day ? 3 : 2.5,
    veil: 1 - atmosphere.overcast * 0.8,
    day,
  };
}

/** A colour as the shader takes it: three channels, 0..1. */
export function unitRgb(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

function tone(rgb: CloudTones["lit"]): [number, number, number] {
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
}

/**
 * Every uniform but the view's and the cloud count, for one moment. The
 * colours are the atmosphere's own, *not* pre-divided by the ambient as the
 * pixel sky is: the backdrop is drawn behind the world, past the lighting
 * pass's reach, so it shows exactly what it is given. What the pass would
 * have done to it - clamp each channel to the ambient - the shader does
 * itself with `u_ambient`.
 */
export function skyUniforms(
  atmosphere: Atmosphere,
  layout: HorizonLayout,
  width: number,
  at: { readonly offset: number; readonly elapsedMs: number },
): Record<string, UniformValue> {
  const disc = skyDisc(atmosphere, layout, width);
  const tones = cloudTones(atmosphere);
  return {
    u_band: [layout.skyHeight, layout.horizonY, at.offset, at.elapsedMs / 1000],
    u_skyTop: unitRgb(atmosphere.skyTop),
    u_skyHorizon: unitRgb(atmosphere.skyHorizon),
    u_ambient: unitRgb(atmosphere.ambient),
    u_sun: [disc.x, disc.y, disc.radius, disc.veil],
    u_light: [disc.day ? 1 : 0, atmosphere.starAlpha, Math.sign(atmosphere.light.x) || 1, atmosphere.overcast],
    u_sunCore: unitRgb(disc.day ? "#fff6d8" : "#e4ecff"),
    u_sunRim: unitRgb(disc.day ? mixHex("#ffd27a", atmosphere.skyHorizon, 0.2) : "#b8c4e8"),
    u_sunHalo: unitRgb(disc.day ? "#ffe9b0" : "#9fb0dd"),
    u_shade: tone(tones.shade),
    u_body: tone(tones.body),
    u_lit: tone(tones.lit),
  };
}
