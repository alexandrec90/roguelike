/**
 * A slime's body: an SDF jelly, lit per pixel, with the gloss that makes it
 * read as wet.
 *
 * The body is the chestnut's mechanism (`procgen/volume.ts`) pointed at a new
 * material: a dome, a wider skirt where it sits on the ground and a little
 * teardrop tip, smooth-unioned into one field and cut flat at the ground. The
 * field's gradient is the surface normal, so the light from `atmosphere.light`
 * lands on it as on a real rounded thing, and squash and stretch are a scale on
 * the *field* rather than on pixels — the body is re-sampled at every shape, so
 * a pancaked slime is as crisp as a round one.
 *
 * What turns a lit blob into *jelly* is four small reads layered on the light,
 * each a condition on the same field sample:
 *
 * - an **outline** on the silhouette, dark on the shadow side and lighter on
 *   the lit one, so a green slime never melts into green grass;
 * - a **nucleus** suspended in the body, darker, seen through it;
 * - **bounce light** — a bright crescent just inside the lower edge on the side
 *   away from the lamp, which is light that went *through* the jelly, and is
 *   the single cue that says "translucent" at this size;
 * - a **specular** hot spot on the lit shoulder: one glint pixel and its sheen.
 *
 * Bodies are cached by a quantised key (squash, light angle, variant, flash,
 * chill, scale, lean), because the shape is a function of those and nothing
 * else. Eyes and bubbles are a handful of pixels drawn over the cached body
 * each frame, which is what lets them move without invalidating anything.
 */

import type { InkId, PixelCloud } from "../ink";
import { ditherThreshold, INK_RAMPS, rampInk } from "../shading";
import { fieldNormal, sdCircle, sdEllipse, sdSmoothUnion, type Offset, type SdfField } from "../procgen/sdf";
import { SLIME_INKS, type SlimeVariant } from "./slime-palette";

/** The body at rest, logical pixels: 13-14 across, 10-11 tall. */
export const SLIME_HALF_WIDTH = 7;
export const SLIME_HEIGHT = 10;

/** Squash and light are quantised to these steps for the cache. */
const SQUASH_STEP = 0.04;
const LIGHT_STEPS = 16;

export interface BodyLook {
  readonly variant: SlimeVariant;
  /** +stretched / -squashed, about ±0.4. */
  readonly squash: number;
  /** Screen-space, pointing toward the lamp; +y is down. */
  readonly light: Offset;
  readonly flash?: boolean;
  /** 0..1: how frozen over a chilled slime looks. */
  readonly chill?: number;
  /** Screen pixels per body pixel: 1 on the field, less on the horizon roll. */
  readonly scale?: number;
  /** Which way the tip leans, -1..1 — a per-slime trait. */
  readonly lean?: number;
}

export interface BodyRaster {
  readonly cloud: PixelCloud;
  /** Interior pixels (not the outline), keyed `packKey(x, y)`: where bubbles may show. */
  readonly interior: ReadonlySet<number>;
  /** Topmost row of the body, ≤ 0. */
  readonly top: number;
}

/** Horizontal and vertical scale for a squash: stretching tall narrows it, roughly keeping volume. */
export function squashScale(squash: number): { readonly sx: number; readonly sy: number } {
  return { sx: 1 - squash * 0.55, sy: 1 + squash };
}

export function packKey(x: number, y: number): number {
  return (x + 256) * 1024 + (y + 512);
}

/**
 * The body's field for a squash and lean, in body pixels, foot at (0, 0).
 *
 * Squash scales the *domain*, and the distance is corrected by the smaller
 * scale — the same trick `sdEllipse` plays — so the outline stays one pixel
 * thick at any shape.
 */
export function bodyField(squash: number, lean = 0): SdfField {
  const { sx, sy } = squashScale(squash);
  const correct = Math.min(sx, sy);
  const shape = sdSmoothUnion(
    2,
    sdEllipse(0, -4.6, 6.3, 4.9),
    sdEllipse(0, -1.9, 7.1, 2.1),
    sdCircle(lean * 0.9, -8.9, 1.5),
  );
  // Cut flat at the ground: a slime sits on its base, it is not a ball on a point.
  return (x, y) => Math.max(shape(x / sx, y / sy) * correct, y - 0.5);
}

function quantise(look: BodyLook): { squash: number; angle: number; scale: number; chill: number; lean: number } {
  const angle = Math.round((Math.atan2(look.light.y, look.light.x) / (Math.PI * 2)) * LIGHT_STEPS);
  return {
    squash: Math.round(look.squash / SQUASH_STEP) * SQUASH_STEP,
    angle: ((angle % LIGHT_STEPS) + LIGHT_STEPS) % LIGHT_STEPS,
    scale: Math.round((look.scale ?? 1) * 20) / 20,
    chill: Math.round((look.chill ?? 0) * 2) / 2,
    lean: Math.round(look.lean ?? 0),
  };
}

interface PixelRead {
  readonly x: number;
  readonly y: number;
  /** Inside distance, body pixels (negative inside). */
  readonly d: number;
  /** Normal · light, -1..1. */
  readonly facing: number;
  readonly edge: boolean;
}

/** The jelly's inks for one pixel — outline, nucleus, bounce, specular, body. */
function jellyInk(read: PixelRead, look: Required<Pick<BodyLook, "variant" | "squash">>, geometry: Geometry): InkId {
  const inks = SLIME_INKS[look.variant];
  const at = { x: read.x, y: read.y };
  if (read.edge) {
    // Only the rim facing straight into the light lifts off the outline ink:
    // everywhere else the silhouette stays dark, or a green slime sinks into grass.
    return read.facing > 0.8 ? inks.rimLit : inks.outline;
  }
  const spec = Math.hypot((read.x - geometry.specX) / 1.5, read.y - geometry.specY);
  if (spec < 0.8) {
    return inks.glint;
  }
  if (spec < 1.7 || (read.d > -2 && read.facing > 0.72)) {
    return inks.sheen;
  }
  if (read.d > -2.3 && read.facing < -0.25 && read.y > geometry.midY) {
    return inks.bounce;
  }
  const core = Math.hypot((read.x - geometry.coreX) / 2.4, (read.y - geometry.coreY) / 1.7);
  if (inks.coreGlows && core < 0.6) {
    return inks.core;
  }
  const lit = (read.facing + 1) / 2;
  const fresnel = 0.16 * (1 - Math.min(1, -read.d / 3));
  const level = 0.22 + 0.78 * lit + fresnel - (inks.coreGlows ? 0 : core < 1 ? 0.18 : 0);
  // The ramp's outer steps are the outline and the sheen; the flesh lives between.
  return rampInk(inks.ramp.slice(1, 4), level, at);
}

interface Geometry {
  readonly specX: number;
  readonly specY: number;
  readonly coreX: number;
  readonly coreY: number;
  readonly midY: number;
}

function geometryOf(squash: number, light: Offset, scale: number): Geometry {
  const { sx, sy } = squashScale(squash);
  const length = Math.hypot(light.x, light.y) || 1;
  const lx = light.x / length;
  const ly = light.y / length;
  return {
    specX: (lx * 3.1 * sx) * scale,
    specY: (-5.2 * sy + ly * 2.6 * sy) * scale,
    coreX: -lx * 0.8 * scale,
    coreY: -2.6 * sy * scale,
    midY: -4.8 * sy * scale,
  };
}

/** Re-ink a lit pixel for a hit flash or frost, or leave it. */
function overlay(ink: InkId, read: PixelRead, look: BodyLook): InkId {
  if (look.flash === true) {
    return read.edge ? (SLIME_INKS[look.variant].flash[0] as InkId) : rampInk(SLIME_INKS[look.variant].flash, 0.4 + read.facing * 0.5, read);
  }
  const chill = look.chill ?? 0;
  if (chill > 0 && ink !== "foam" && (read.edge || ditherThreshold(read.x, read.y) < chill * 0.6)) {
    return read.edge ? "frost-1" : rampInk(INK_RAMPS.frost.slice(2), 0.3 + read.facing * 0.5, read);
  }
  return ink;
}

const CACHE = new Map<string, BodyRaster>();
const CACHE_LIMIT = 900;

/** The lit body for a look. Cached: the same key is the same pixels, always. */
export function slimeBody(look: BodyLook): BodyRaster {
  const q = quantise(look);
  const key = `${look.variant}|${q.squash.toFixed(2)}|${q.angle}|${look.flash === true ? 1 : 0}|${q.chill}|${q.scale}|${q.lean}`;
  const cached = CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const angle = (q.angle / LIGHT_STEPS) * Math.PI * 2;
  const raster = rasterBody({
    ...look,
    squash: q.squash,
    light: { x: Math.cos(angle), y: Math.sin(angle) },
    scale: q.scale,
    chill: q.chill,
    lean: q.lean,
  });
  if (CACHE.size >= CACHE_LIMIT) {
    CACHE.clear();
  }
  CACHE.set(key, raster);
  return raster;
}

/** How many bodies are cached — for the budget test. */
export function bodyCacheSize(): number {
  return CACHE.size;
}

function rasterBody(look: BodyLook): BodyRaster {
  const scale = look.scale ?? 1;
  const field = bodyField(look.squash, look.lean ?? 0);
  const sample: SdfField = scale === 1 ? field : (x, y) => field(x / scale, y / scale);
  const { sx, sy } = squashScale(look.squash);
  const halfWidth = Math.ceil((SLIME_HALF_WIDTH + 1) * sx * scale) + 1;
  const top = -Math.ceil((SLIME_HEIGHT + 2) * sy * scale) - 1;
  const length = Math.hypot(look.light.x, look.light.y) || 1;
  const lx = look.light.x / length;
  const ly = look.light.y / length;
  const geometry = geometryOf(look.squash, look.light, scale);
  const cloud: PixelCloud = [];
  const interior = new Set<number>();
  let highest = 0;
  for (let y = top; y <= 0; y += 1) {
    for (let x = -halfWidth; x <= halfWidth; x += 1) {
      const d = sample(x, y);
      if (d > 0) {
        continue;
      }
      const normal = fieldNormal(sample, x, y, 0.6 * scale);
      const read: PixelRead = { x, y, d: d / scale, facing: normal.x * lx + normal.y * ly, edge: d > -1 };
      const ink = overlay(jellyInk(read, look, geometry), read, look);
      cloud.push({ x, y, ink });
      highest = Math.min(highest, y);
      if (!read.edge) {
        interior.add(packKey(x, y));
      }
    }
  }
  return { cloud, interior, top: highest };
}

export type EyeState = "open" | "blink" | "squint";

export interface EyeLook {
  readonly squash: number;
  /** Where it is looking, each axis -1..1 (screen: +y down). */
  readonly lookX: number;
  readonly lookY: number;
  readonly state: EyeState;
  /** Which side the glint sits on follows the light. */
  readonly lightX: number;
}

/**
 * Two eyes, `void` black with a one-pixel glint, over the body.
 *
 * 2x2 each and three pixels apart — the largest that still leaves the body
 * reading as the main shape at 14 px. They follow the hero by a pixel, blink,
 * and squeeze to `> <` when hurt.
 */
export function slimeEyes(look: EyeLook): PixelCloud {
  const { sx, sy } = squashScale(look.squash);
  const shiftX = Math.round(Math.max(-1, Math.min(1, look.lookX)));
  const shiftY = Math.round(Math.max(-1, Math.min(1, look.lookY)));
  const left = -Math.round(3 * sx) + shiftX;
  const right = Math.round(3 * sx) - 1 + shiftX;
  const row = Math.round(-5.4 * sy) + shiftY;
  const eyes: PixelCloud = [];
  if (look.state === "squint") {
    eyes.push(
      { x: left, y: row - 1, ink: "void" },
      { x: left + 1, y: row, ink: "void" },
      { x: left, y: row + 1, ink: "void" },
      { x: right + 1, y: row - 1, ink: "void" },
      { x: right, y: row, ink: "void" },
      { x: right + 1, y: row + 1, ink: "void" },
    );
    return eyes;
  }
  // A blush under each eye: one pixel each, and most of the charm.
  eyes.push({ x: left - 1, y: row + 2, ink: "petal-4" }, { x: right + 2, y: row + 2, ink: "petal-4" });
  for (const x of [left, right]) {
    if (look.state === "blink") {
      eyes.push({ x, y: row + 1, ink: "void" }, { x: x + 1, y: row + 1, ink: "void" });
      continue;
    }
    const glintX = look.lightX <= 0 ? x : x + 1;
    eyes.push(
      { x, y: row, ink: glintX === x ? "foam" : "void" },
      { x: x + 1, y: row, ink: glintX === x + 1 ? "foam" : "void" },
      { x, y: row + 1, ink: "void" },
      { x: x + 1, y: row + 1, ink: "void" },
    );
  }
  return eyes;
}

/**
 * A few bubbles rising through the jelly, clipped to the body's interior.
 *
 * Each is one pixel on its own seeded period, so the body looks alive even
 * standing still. They are *inside* the body, so a bubble that would cross the
 * outline or an eye simply is not drawn that frame.
 */
export function slimeBubbles(
  body: BodyRaster,
  variant: SlimeVariant,
  seed: number,
  elapsedMs: number,
): PixelCloud {
  const bubbles: PixelCloud = [];
  const height = -body.top;
  for (let index = 0; index < 3; index += 1) {
    const period = 2300 + ((seed >> (index * 3)) & 7) * 260;
    const phase = ((elapsedMs / period + index * 0.37 + (seed & 15) / 16) % 1 + 1) % 1;
    const baseX = ((seed >> (index * 4 + 2)) & 7) - 3.5;
    const x = Math.round(baseX + Math.sin(phase * Math.PI * 3) * 0.7);
    const y = Math.round(-1.5 - phase * (height - 3));
    if (body.interior.has(packKey(x, y))) {
      bubbles.push({ x, y, ink: index === 0 ? SLIME_INKS[variant].glint : SLIME_INKS[variant].sheen });
    }
  }
  return bubbles;
}
