/**
 * Signed distance fields, and the one rasteriser that turns them into lit pixels.
 *
 * An SDF is a function from a point to "how far outside the shape am I", going
 * negative inside. That single property buys three things this art direction
 * would otherwise have to draw by hand:
 *
 * - **Shapes combine.** A crown is not a drawn blob, it is four spheres
 *   `sdSmoothUnion`ed together, and the seam between them is a fillet the maths
 *   computed rather than a join someone dithered.
 * - **Volume is free.** The gradient of the field at a pixel *is* the surface
 *   normal, so `shadeCloud`'s light direction can be applied per pixel instead
 *   of across a bounding box — a sphere lights like a sphere, not like a disc.
 * - **Depth is free.** The distance *itself*, inside the shape, says how buried
 *   a pixel is, which is ambient occlusion for nothing: the inside of a canopy
 *   goes dark and its edge catches light without a second pass.
 *
 * The rasteriser is the only place a field becomes pixels, so a field can be
 * warped, unioned and re-lit without anything downstream knowing it changed.
 */

import { directionalLevel, rampInk, type ShadeOptions } from "../shading";
import type { InkId, PixelCloud } from "../ink";

/** Distance to the surface: negative inside, 0 on it, positive outside. */
export type SdfField = (x: number, y: number) => number;

export function sdCircle(cx: number, cy: number, radius: number): SdfField {
  return (x, y) => Math.hypot(x - cx, y - cy) - radius;
}

/**
 * An ellipse, approximated by scaling space and correcting by the smaller
 * radius. Exact only on the axes, and close enough everywhere else that a
 * four-step ramp cannot tell — an exact ellipse SDF is a root-finder, which is
 * not worth a per-pixel cost for a 20px canopy.
 */
export function sdEllipse(cx: number, cy: number, rx: number, ry: number): SdfField {
  const scale = Math.min(rx, ry);
  return (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * scale;
}

/** A thick line: every point within `radius` of the segment. Trunks and limbs. */
export function sdCapsule(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): SdfField {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  return (x, y) => {
    const px = x - ax;
    const py = y - ay;
    const t = lengthSquared === 0 ? 0 : Math.min(Math.max((px * dx + py * dy) / lengthSquared, 0), 1);
    return Math.hypot(px - dx * t, py - dy * t) - radius;
  };
}

/** The union of several fields: the nearest surface wins. */
export function sdUnion(...fields: readonly SdfField[]): SdfField {
  return (x, y) => {
    let best = Number.POSITIVE_INFINITY;
    for (const field of fields) {
      best = Math.min(best, field(x, y));
    }
    return best;
  };
}

/**
 * A union with a fillet of width `k` where the shapes meet.
 *
 * This is the difference between a canopy that reads as one mass and one that
 * reads as a handful of circles that happen to overlap. `k` around a third of
 * the smaller radius is usually right.
 */
export function sdSmoothUnion(k: number, ...fields: readonly SdfField[]): SdfField {
  if (k <= 0) {
    return sdUnion(...fields);
  }
  // Folded from the first field rather than from infinity: the polynomial
  // below is only meaningful between two real distances, and seeding it with
  // infinity poisons every later step to NaN — which rasterises as nothing at
  // all, silently.
  return (x, y) => {
    let best = fields[0]?.(x, y) ?? Number.POSITIVE_INFINITY;
    for (let index = 1; index < fields.length; index += 1) {
      const d = fields[index]?.(x, y) ?? Number.POSITIVE_INFINITY;
      const h = Math.min(Math.max(0.5 + (0.5 * (d - best)) / k, 0), 1);
      best = d + (best - d) * h - k * h * (1 - h);
    }
    return best;
  };
}

/** Everything in `field` that is not in `cut`. Hollows, bites, wind-torn gaps. */
export function sdSubtract(field: SdfField, cut: SdfField): SdfField {
  return (x, y) => Math.max(field(x, y), -cut(x, y));
}

/**
 * Domain warp: sample the field somewhere else.
 *
 * Feeding a noise offset through here is the single highest-value trick in the
 * file — it converts a smooth mathematical blob into something with the ragged,
 * lumpy edge of foliage, and animating the offset makes that edge *breathe*
 * without any of the shape's own parameters moving.
 */
export function warpField(field: SdfField, offset: (x: number, y: number) => Offset): SdfField {
  return (x, y) => {
    const delta = offset(x, y);
    return field(x - delta.x, y - delta.y);
  };
}

export interface Offset {
  readonly x: number;
  readonly y: number;
}

/**
 * The surface normal at a point, by central difference.
 *
 * Cheap and, for the fields here, accurate enough that a 4-step ramp shows no
 * artefact. Returns a zero vector where the field is flat, which the shader
 * treats as fully ambient rather than dividing by zero.
 */
export function fieldNormal(field: SdfField, x: number, y: number, epsilon = 0.6): Offset {
  const nx = field(x + epsilon, y) - field(x - epsilon, y);
  const ny = field(x, y + epsilon) - field(x, y - epsilon);
  const length = Math.hypot(nx, ny);
  return length === 0 ? { x: 0, y: 0 } : { x: nx / length, y: ny / length };
}

export interface SdfRasterOptions {
  /** Inclusive integer box to walk. Keep it tight; this is a per-pixel loop. */
  readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly ramp: readonly InkId[];
  /** Screen-space light; +y is down, matching cloud coordinates. */
  readonly light?: Offset;
  readonly ambient?: number;
  /**
   * How fast the interior darkens with depth, in ramp-levels per pixel. This is
   * the ambient-occlusion term: 0 lights the shape as a shell, 0.08 gives a
   * canopy whose middle is deep shadow and whose rim catches the sky.
   */
  readonly occlusion?: number;
  readonly dither?: boolean;
  /** Skip a pixel entirely — used to punch holes for branches passing in front. */
  readonly mask?: (x: number, y: number) => boolean;
  /**
   * Central-difference step for the normal. Larger is blunter and cheaper to be
   * wrong about; it is the knob a distant object turns down.
   */
  readonly normalEpsilon?: number;
  /**
   * Light from a screen-space gradient across the box instead of from the true
   * surface normal — the distant body's shortcut.
   *
   * A normal costs four extra field evaluations per pixel and buys the rim that
   * makes a near body read as round. The tempting shortcut is to drop the light
   * term entirely, and it is wrong: the body then draws as a flat silhouette
   * with a hard lit outline, which is a different *kind* of object, and a body
   * rolling closer visibly changes character rather than gaining detail.
   *
   * So the cheap path still lights, just crudely: the same light direction,
   * projected across the bounding box, which costs nothing and produces a soft
   * gradient going the right way. What is lost is per-lobe modelling, which is
   * the thing genuinely invisible at distance.
   */
  readonly flat?: boolean;
  /**
   * A caller-owned counter, incremented once per field evaluation.
   *
   * Instrumentation rather than global state: the performance budget tests need
   * a number that does not depend on how fast the machine running them is, and
   * "how many times did we evaluate the field" is exactly that number.
   */
  readonly meter?: { evaluations: number };
}

/**
 * Walk a box, keep what is inside the field, and ink it from its own normal and
 * depth. This is `shadeCloud` for a shape that does not exist as pixels yet.
 */
export function rasterizeSdf(field: SdfField, options: SdfRasterOptions): PixelCloud {
  const cloud: PixelCloud = [];
  const light = options.light ?? { x: -0.6, y: -0.8 };
  const ambient = options.ambient ?? 0.15;
  const occlusion = options.occlusion ?? 0.06;
  const dither = options.dither ?? true;
  const meter = options.meter;
  const length = Math.hypot(light.x, light.y) || 1;
  const lx = light.x / length;
  const ly = light.y / length;
  const sample: SdfField =
    meter === undefined
      ? field
      : (x, y) => {
          meter.evaluations += 1;
          return field(x, y);
        };
  // The cheap light: the same directional field `shadeCloud` uses, projected
  // across this box. Free, and it keeps a far body lit the same way a near one
  // is instead of turning it into a silhouette.
  const across = directionalLevel(light, options.box);

  for (let y = options.box.top; y <= options.box.bottom; y += 1) {
    for (let x = options.box.left; x <= options.box.right; x += 1) {
      const distance = sample(x, y);
      if (distance > 0 || options.mask?.(x, y) === false) {
        continue;
      }
      // `light` points from the surface *toward* the lamp, the same convention
      // `shading.ts` uses, so a normal aligned with it is the lit side.
      const facing =
        options.flat === true
          ? across({ x, y, ink: "void" })
          : facingAt(sample, x, y, options.normalEpsilon, lx, ly);
      const buried = Math.min(1, -distance * occlusion);
      const level = Math.min(Math.max(ambient + (1 - ambient) * facing - buried, 0), 1);
      cloud.push({ x, y, ink: rampInk(options.ramp, level, dither ? { x, y } : undefined) });
    }
  }
  return cloud;
}

function facingAt(
  field: SdfField,
  x: number,
  y: number,
  epsilon: number | undefined,
  lx: number,
  ly: number,
): number {
  const normal = fieldNormal(field, x, y, epsilon);
  return (normal.x * lx + normal.y * ly + 1) / 2;
}

/** The shade options a caller would pass `shadeCloud` — kept in step by type. */
export type SdfShade = Pick<ShadeOptions, "ramp" | "light" | "ambient" | "dither">;
