/**
 * The sky, as standing water gives it back — in inks.
 *
 * A puddle on a field is mostly a mirror, and what it mirrors is the sky: pale
 * at noon, orange at dusk, ink-blue at night. The sky itself is one of the few
 * things allowed a computed colour (it is a genuinely continuous gradient,
 * `atmosphere.ts`), but anything drawn as pixels has to be a named ink. This
 * file is the bridge: it takes the atmosphere's colours and finds the two
 * palette inks that bracket each one, so the reflection is a Bayer-dithered
 * blend of real inks that tracks the time of day without ever inventing a hex.
 *
 * The geometry of the reflection is a real one, not a style choice: from the
 * camera's pitch the *far* edge of a puddle is seen at a grazing angle and
 * mirrors the sky near the horizon, while the *near* edge is seen more steeply,
 * mirrors the sky overhead, and lets more of the mud show through. So a
 * reflection runs from `skyHorizon` at the back of the water to a darker
 * `skyTop` at the front — which is also exactly what makes a flat blob read as
 * a surface lying on the ground.
 */

import type { Atmosphere } from "../atmosphere";
import { hexToRgb, mixHex, rgbToHex, type Rgb } from "../color";
import { INK_COLORS, type InkId } from "../ink";
import { rampSlice } from "../palette";
import { ditherThreshold } from "../shading";

/**
 * The inks a reflection may be dithered from: every step of water and frost,
 * plus the warm and violet steps a dusk sky needs and the greys of an overcast
 * one. All opaque — the sheer water edge is drawn separately.
 */
export const REFLECTION_INKS: readonly InkId[] = [
  ...rampSlice("water", 0, 5),
  ...rampSlice("frost", 0, 4),
  "foam",
  ...rampSlice("arcane", 1, 4),
  ...rampSlice("stone", 1, 5),
  ...rampSlice("metal", 1, 4),
  ...rampSlice("fire", 3, 6),
  ...rampSlice("autumn", 2, 4),
  "petal-4",
];

/** Two inks and how far between them a colour sits, 0 at `a` and 1 at `b`. */
export interface InkPair {
  readonly a: InkId;
  readonly b: InkId;
  readonly t: number;
}

const RGB = new Map<InkId, Rgb>();

function rgbOf(ink: InkId): Rgb {
  let rgb = RGB.get(ink);
  if (rgb === undefined) {
    rgb = hexToRgb(INK_COLORS[ink]);
    RGB.set(ink, rgb);
  }
  return rgb;
}

/** "Redmean" distance: cheap, and much closer to the eye than plain RGB. */
function distance(a: Rgb, b: Rgb): number {
  const mean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

export function nearestInk(hex: string, candidates: readonly InkId[] = REFLECTION_INKS): InkId {
  const target = hexToRgb(hex);
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ink of candidates) {
    const d = distance(target, rgbOf(ink));
    if (d < bestDistance) {
      bestDistance = d;
      best = ink;
    }
  }
  if (best === undefined) {
    throw new Error("nearestInk needs at least one candidate");
  }
  return best;
}

/**
 * The two inks that bracket a colour: the nearest, and whichever other ink the
 * colour leans toward from it, with the colour projected onto the line between
 * them. Dithering `a`→`b` at `t` then averages back to (nearly) the colour asked
 * for, which is what lets a closed palette carry a continuous sky.
 */
export function inkPair(hex: string, candidates: readonly InkId[] = REFLECTION_INKS): InkPair {
  const target = hexToRgb(hex);
  const a = nearestInk(hex, candidates);
  const from = rgbOf(a);
  let best: InkPair = { a, b: a, t: 0 };
  let bestDistance = distance(target, from);
  // Only the colour's close neighbours may be its partner: a far ink at a small
  // blend averages out right and still reads as a scatter of foreign dots.
  const neighbours = [...candidates]
    .sort((left, right) => distance(target, rgbOf(left)) - distance(target, rgbOf(right)))
    .slice(1, 1 + PARTNERS);
  for (const ink of neighbours) {
    const to = rgbOf(ink);
    const span = { r: to.r - from.r, g: to.g - from.g, b: to.b - from.b };
    const length = span.r ** 2 + span.g ** 2 + span.b ** 2;
    const along =
      ((target.r - from.r) * span.r + (target.g - from.g) * span.g + (target.b - from.b) * span.b) /
      Math.max(length, 1);
    if (along <= 0 || along >= 1) {
      continue;
    }
    const blended = { r: from.r + span.r * along, g: from.g + span.g * along, b: from.b + span.b * along };
    const d = distance(target, blended);
    if (d < bestDistance) {
      bestDistance = d;
      best = { a, b: ink, t: along };
    }
  }
  return best;
}

/** How many of a colour's nearest inks are tried as the second of its pair. */
const PARTNERS = 3;

/** One pixel of a dithered pair. */
export function pairInk(pair: InkPair, x: number, y: number): InkId {
  return pair.t > ditherThreshold(x, y) ? pair.b : pair.a;
}

/** Everything a puddle needs from the sky at one moment. */
export interface SkyReflection {
  /** The reflection from the far edge (index 0) to the near edge (last). */
  readonly rows: readonly InkPair[];
  /**
   * The same reflection over deep water, far to near: the sky still, but no
   * mud under it - the dark of the water itself, which is what tells a player
   * where the lake stops being wadeable.
   */
  readonly deep: readonly InkPair[];
  /**
   * A lake's shallows, far to near: the sky over a pale shelf the eye sees the
   * bottom of, where a puddle's near edge goes to mud. Paler than the deep
   * water at every row, so the drop-off reads all the way round.
   */
  readonly shelf: readonly InkPair[];
  /** The brightest thing on the water: the sun or moon's glint. */
  readonly glint: InkId;
  /** A rain ring: brighter than the water it breaks, dimmer than a glint. */
  readonly ring: InkId;
  /** The dark lip under the far bank: the bank's own grass, mirrored. */
  readonly lip: InkId;
}

/** How many bands the far-to-near gradient is resolved into before dithering. */
export const REFLECTION_BANDS = 8;

/** What a muddy puddle tints its reflection toward, and the colour of a glint's heart. */
const MUD_TINT = INK_COLORS["water-1"];
const GLINT_WHITE = INK_COLORS.foam;
const WATER_TINT = INK_COLORS["water-3"];
/** What deep water darkens its reflection toward: the lake's own body, seen into. */
const DEEP_TINT = INK_COLORS["water-1"];
/** What a lake's shallows show through: a pale shelf of sand and weed. */
const SHELF_TINT = INK_COLORS["water-4"];

/**
 * A sky colour divided by the ambient light, so that after the scene's
 * lighting pass multiplies the water by that ambient it lands back on the
 * sky's own colour — the same pre-division the sky itself is painted with.
 * Without it a night puddle would be the night sky darkened twice: a hole.
 */
export function undoAmbient(hex: string, ambient: string | undefined): string {
  if (ambient === undefined) {
    return hex;
  }
  const colour = hexToRgb(hex);
  const light = hexToRgb(ambient);
  const lift = (channel: number, by: number): number => Math.min(255, (channel * 255) / Math.max(by, 24));
  return rgbToHex({ r: lift(colour.r, light.r), g: lift(colour.g, light.g), b: lift(colour.b, light.b) });
}

/**
 * The atmosphere's colours in, the puddle's inks out. Pure.
 *
 * Pass the atmosphere's `ambient` when the water will be drawn under the
 * scene's lighting multiply (the game); leave it out for a picture that is
 * seen as painted (the lab).
 */
export function skyReflection(
  atmosphere: Pick<Atmosphere, "skyTop" | "skyHorizon" | "daylight"> & { readonly ambient?: string | undefined },
): SkyReflection {
  const rows: InkPair[] = [];
  const deep: InkPair[] = [];
  const shelf: InkPair[] = [];
  const skyTop = undoAmbient(atmosphere.skyTop, atmosphere.ambient);
  const skyHorizon = undoAmbient(atmosphere.skyHorizon, atmosphere.ambient);
  for (let band = 0; band < REFLECTION_BANDS; band += 1) {
    const t = band / (REFLECTION_BANDS - 1);
    const sky = mixHex(skyHorizon, skyTop, t ** 1.5);
    // A puddle is a dark mirror: some of the sky, some of the mud under it,
    // and more mud toward the near edge where the eye looks down into it.
    // Water is never quite the sky: a grey overcast still reads blue-grey in
    // a puddle, which is what stops it reading as a flat stone.
    const tinted = mixHex(sky, WATER_TINT, 0.3);
    rows.push(inkPair(mixHex(tinted, MUD_TINT, 0.15 + 0.55 * t)));
    // Deep water has no bottom to show: the near edge looks down into the
    // lake's own dark instead of onto mud, and the far edge still skips the sky.
    deep.push(inkPair(mixHex(tinted, DEEP_TINT, 0.5 + 0.25 * t)));
    shelf.push(inkPair(mixHex(tinted, SHELF_TINT, 0.3 + 0.25 * t)));
  }
  const glintHex = mixHex(skyHorizon, GLINT_WHITE, 0.3 + 0.35 * atmosphere.daylight);
  const middle = mixHex(mixHex(skyHorizon, skyTop, 0.5), WATER_TINT, 0.3);
  const ringHex = mixHex(middle, GLINT_WHITE, 0.15 + 0.15 * atmosphere.daylight);
  return {
    rows,
    deep,
    shelf,
    glint: nearestInk(glintHex),
    ring: nearestInk(ringHex),
    // The far bank, mirrored: the dark underside of the grass beyond the water.
    lip: atmosphere.daylight > 0.3 ? "grass-1" : "grass-0",
  };
}

/**
 * A key over the *atmosphere* that moves a few times a minute of play rather
 * than every frame, so a layer re-derives its reflection at most that often.
 */
export function skyKey(atmosphere: Pick<Atmosphere, "hours" | "overcast">): string {
  return `${Math.round(atmosphere.hours * 20)}|${Math.round(atmosphere.overcast * 12)}`;
}

/**
 * A key over the *reflection* itself: the inks it chose, and each blend to the
 * Bayer matrix's own sixteen levels. Two skies with the same key paint the
 * same pixels, so a body is only re-baked when the water would look different.
 */
export function reflectionKey(sky: SkyReflection): string {
  const key = (pair: InkPair): string => `${pair.a}/${pair.b}/${Math.round(pair.t * 16)}`;
  const ramps = [sky.rows, sky.deep, sky.shelf].map((pairs) => pairs.map(key).join(","));
  return `${ramps.join("|")}|${sky.glint}|${sky.ring}|${sky.lip}`;
}
