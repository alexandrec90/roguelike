/**
 * Clouds in the sky band, as pixel-art cumulus built from puffs.
 *
 * Twice before this the clouds were a field cut at a threshold. First a 3D
 * noise thresholded per pixel, which read as speckle; then a column height per
 * panorama column, which read as slabs: every cloud a flat-topped strip with a
 * stair-stepped crown, one or two scanlines peeking over the ridge. Neither had
 * the one thing that says "cloud" at this size - a row of round bumps on a flat
 * bottom - because neither was ever a *shape*.
 *
 * So a cloud is now an object. Each deck lays a ring of slots round the
 * panorama, and a slot whose seeded size clears the sky's threshold holds one
 * cumulus: a handful of squashed circles along a line, biggest in the middle,
 * cut flat where the air stops lifting them (`deckClouds`). A pixel inside is
 * lit from the surface of the puff it pokes furthest out of (`cloudTone`), so
 * the crown catches the sun on its sunward shoulder, the underside sits in the
 * cloud's own shade, and the crease where one puff tucks behind its neighbour
 * falls dark - which is what separates the bumps. The light is quantised to
 * three tones with a short dither across each seam.
 *
 * Overcast grows every cloud rather than adding new ones, so a sky clouding
 * over swells the clouds it has until they touch and close into one lumpy grey
 * ceiling; nothing pops in. Slots sit at fixed bearings, so a full turn of the
 * panorama comes back to the same cloud, and a cloud moves by whole pixels as it
 * drifts, so its outline never shimmers.
 *
 * Pure: a deck, a bearing and the hour's colours in, pixels out through `put`.
 */

import { hexToRgb, mixHex, type Rgb } from "./color";
import { PANORAMA_WIDTH, wrapPanorama } from "./panorama";
import { ditherThreshold } from "./shading";
import { pixelHash } from "./transforms";

export interface CloudDeck {
  /** The deck's flat base, as a share of the sky band's height from the top. */
  readonly base: number;
  /** Tallest a cloud on it stands, in scanlines, on a clear day. */
  readonly height: number;
  /** Widest a cloud on it grows, in pixels, on a clear day. */
  readonly width: number;
  /** Panorama pixels per slot; `PANORAMA_WIDTH` must divide by it. */
  readonly spacing: number;
  /** Share of slots that hold a cloud on a clear day. */
  readonly cover: number;
  /** Share of the sky's drift this deck moves by: a higher deck is slower. */
  readonly drift: number;
  /** Opacity of the deck: a high, thin deck lets the sky through. */
  readonly alpha: number;
  readonly seed: number;
}

/** A high deck of small, flat, sheer clouds, and a low one of cumulus in front of it. */
export const CLOUD_DECKS: readonly CloudDeck[] = [
  { base: 0.4, height: 3.5, width: 20, spacing: 32, cover: 0.4, drift: 0.55, alpha: 0.8, seed: 0xc10d },
  { base: 0.6, height: 7, width: 40, spacing: 64, cover: 0.55, drift: 1, alpha: 1, seed: 0x5ca1 },
];

/** How far overcast swells the clouds: wider than their slot, so they touch. */
const OVERCAST_WIDTH = 1.4;
const OVERCAST_HEIGHT = 0.6;

/** A cloud narrower than this is not drawn: it would be a smudge, not a shape. */
const MIN_WIDTH = 5;

/** A puff's height over its width: far clouds are seen nearly edge on. */
const FLATTEN = 0.62;

/** How far below its centre a puff is cut by the flat base, as a share of its height. */
const SUNK = 0.4;

/** One round bump of a cloud, relative to the cloud's centre and base. */
export interface Puff {
  readonly x: number;
  /** Centre height above the base, in scanlines (positive is up). */
  readonly lift: number;
  /** Horizontal radius; the vertical one is `radius * FLATTEN`. */
  readonly radius: number;
}

/** One cloud: where it sits on the panorama and the puffs it is made of. */
export interface Cumulus {
  /** Panorama column of its centre, before drift. */
  readonly x: number;
  /** Its base, in scanlines below the deck's (0, or a row lower). */
  readonly sag: number;
  readonly halfWidth: number;
  readonly puffs: readonly Puff[];
}

interface Slot {
  readonly x: number;
  /** 0..1: how readily this slot fills; the biggest cloud is the one that fills first. */
  readonly size: number;
  readonly sag: number;
  /** Puff layout as shares of the cloud: position -1..1 and radius 0..1. */
  readonly shape: readonly { readonly at: number; readonly radius: number }[];
}

const SLOTS = new Map<CloudDeck, readonly Slot[]>();

function deckSlots(deck: CloudDeck): readonly Slot[] {
  let slots = SLOTS.get(deck);
  if (slots === undefined) {
    const count = Math.round(PANORAMA_WIDTH / deck.spacing);
    slots = Array.from({ length: count }, (_unused, index) => {
      const hash = (salt: number): number => pixelHash(index, 0, deck.seed, salt);
      const puffs = 3 + Math.floor(hash(2) * 3);
      // The crown peaks a little off centre, so the cloud leans rather than domes.
      const peak = (hash(3) - 0.5) * 0.6;
      const shape = Array.from({ length: puffs }, (_puff, puff) => {
        const at = puffs === 1 ? 0 : (puff / (puffs - 1)) * 2 - 1 + (hash(10 + puff) - 0.5) * 0.25;
        const dome = Math.sqrt(Math.max(0, 1 - ((at - peak) / 1.4) ** 2));
        return { at, radius: Math.min((0.45 + 0.55 * dome) * (0.85 + 0.3 * hash(20 + puff)), 1) };
      });
      return {
        x: index * deck.spacing + Math.round((hash(1) - 0.5) * deck.spacing * 0.5),
        size: hash(0),
        sag: hash(4) < 0.35 ? 1 : 0,
        shape,
      };
    });
    SLOTS.set(deck, slots);
  }
  return slots;
}

/**
 * Every cloud a deck holds under this much overcast. A slot's seeded size
 * must clear `1 - cover`, and the further past it is the wider its cloud, so
 * as cover rises each cloud swells from nothing rather than appearing whole.
 */
export function deckClouds(deck: CloudDeck, overcast: number): Cumulus[] {
  const cover = Math.min(deck.cover + overcast * (1 - deck.cover), 1);
  const threshold = 1 - cover;
  const widest = deck.width * (1 + overcast * OVERCAST_WIDTH);
  const tallest = deck.height * (1 + overcast * OVERCAST_HEIGHT);
  const clouds: Cumulus[] = [];
  for (const slot of deckSlots(deck)) {
    const grown = (slot.size - threshold) / Math.max(cover, 0.05);
    // On a fair day a slot's size also sets how big its cloud gets; overcast
    // evens them out - a flatter growth curve and no size spread - so a closed
    // sky is a ceiling rather than big clouds with small ones in the gaps.
    const spread = 0.55 + 0.45 * slot.size;
    const growth = Math.min(Math.max(grown, 0), 1) ** (0.5 - 0.35 * overcast);
    const width = widest * growth * (spread + (1 - spread) * overcast);
    if (width < MIN_WIDTH) {
      continue;
    }
    // A small cloud is a squat one: height follows width until the deck's ceiling.
    const height = Math.min(tallest, width * 0.3);
    const radius = height / (FLATTEN * (1 + SUNK));
    const half = width / 2;
    const puffs = slot.shape.map(({ at, radius: share }) => {
      const r = Math.max(radius * share, 1.5);
      return { x: at * Math.max(half - r, 0), lift: r * FLATTEN * SUNK, radius: r };
    });
    clouds.push({ x: slot.x, sag: slot.sag, halfWidth: half, puffs });
  }
  return clouds;
}

/** The three tones a cloud is lit in, brightest last. */
export interface CloudTones {
  readonly shade: Rgb;
  readonly body: Rgb;
  readonly lit: Rgb;
}

/** The hour's cloud colours: lit by the sky's horizon light, shaded with its zenith; greyer when overcast. */
export function cloudTones(
  atmosphere: { readonly skyTop: string; readonly skyHorizon: string; readonly ambient: string; readonly overcast: number },
): CloudTones {
  const grey = atmosphere.overcast * 0.6;
  const lit = mixHex(mixHex(mixHex(atmosphere.skyHorizon, "#ffffff", 0.75), atmosphere.ambient, 0.2), "#aeb1b6", grey);
  const shade = mixHex(mixHex(atmosphere.skyTop, "#5a6070", 0.35), "#6e7480", grey);
  return { shade: hexToRgb(shade), body: hexToRgb(mixHex(lit, shade, 0.45)), lit: hexToRgb(lit) };
}

/** Where a cloud pixel is and what lights it. */
export interface CloudPaint {
  readonly width: number;
  readonly skyHeight: number;
  /** Panorama column of screen x 0, before the deck's own drift. */
  readonly offset: number;
  readonly drift: number;
  readonly overcast: number;
  /** -1 or 1: which side of a cloud faces the sun. */
  readonly sunSide: number;
  readonly tones: CloudTones;
}

/** Paint every deck, farthest first, through `put`. */
export function paintCloudDecks(
  paint: CloudPaint,
  put: (x: number, y: number, rgb: Rgb, alpha: number) => void,
  decks: readonly CloudDeck[] = CLOUD_DECKS,
): void {
  for (const deck of decks) {
    paintDeck(deck, paint, put);
  }
}

function paintDeck(deck: CloudDeck, paint: CloudPaint, put: (x: number, y: number, rgb: Rgb, alpha: number) => void): void {
  const base = Math.round(paint.skyHeight * deck.base);
  // Whole pixels, so a drifting cloud slides rather than re-rasterising its edge.
  const start = Math.round(paint.offset + paint.drift * deck.drift);
  for (const cloud of deckClouds(deck, paint.overcast)) {
    const reach = Math.ceil(cloud.halfWidth) + 1;
    const centre = wrapPanorama(cloud.x - start);
    // A cloud straddling the panorama's seam is drawn at both of its screen positions.
    for (const at of [centre, centre - PANORAMA_WIDTH]) {
      if (at + reach >= 0 && at - reach < paint.width) {
        paintCloud(cloud, at, base + cloud.sag, deck.alpha, paint, put);
      }
    }
  }
}

function paintCloud(
  cloud: Cumulus,
  centre: number,
  base: number,
  alpha: number,
  paint: CloudPaint,
  put: (x: number, y: number, rgb: Rgb, alpha: number) => void,
): void {
  const top = Math.floor(base - Math.max(...cloud.puffs.map((puff) => puff.lift + puff.radius * FLATTEN)));
  const reach = Math.ceil(cloud.halfWidth) + 1;
  for (let x = Math.max(centre - reach, 0); x <= Math.min(centre + reach, paint.width - 1); x += 1) {
    for (let y = Math.max(top, 0); y <= base && y < paint.skyHeight; y += 1) {
      const surface = puffSurface(cloud.puffs, x - centre + 0.5, base + 1 - (y + 0.5));
      if (surface !== undefined) {
        put(x, y, cloudTone(paint.tones, { ...surface, height: base - y, sunSide: paint.sunSide }, x, y), alpha);
      }
    }
  }
}

/** Where a point pokes out of a cloud: the outward normal of the puff it is deepest in the surface of. */
export interface PuffSurface {
  /** Right, screen space. */
  readonly nx: number;
  /** Up, screen space. */
  readonly ny: number;
}

/**
 * The surface a point at (`dx` right of the cloud's centre, `up` scanlines over
 * its base) is lit by, or undefined if it is outside every puff. The puff it
 * sits *highest* on - nearest that puff's own crown - is the one that shows, so
 * where two puffs overlap the seam between them is the steep flank of the one
 * behind, and falls dark.
 */
export function puffSurface(puffs: readonly Puff[], dx: number, up: number): PuffSurface | undefined {
  if (up < 0) {
    return undefined;
  }
  let best: PuffSurface | undefined;
  let bestDepth = 0;
  for (const puff of puffs) {
    const nx = (dx - puff.x) / puff.radius;
    const ny = (up - puff.lift) / (puff.radius * FLATTEN);
    const depth = 1 - nx * nx - ny * ny;
    if (depth >= 0 && (best === undefined || depth > bestDepth)) {
      best = { nx, ny };
      bestDepth = depth;
    }
  }
  return best;
}

/** Light from above, leaning to the sun's side and a little toward the viewer. */
const LIGHT_UP = 0.75;
const LIGHT_SIDE = 0.5;
const LIGHT_FRONT = 0.45;

/** Where one tone gives way to the next, in light; and how wide the dither across that seam is. */
const LIT_ABOVE = 0.68;
const BODY_ABOVE = 0.18;
const SEAM = 0.1;

/**
 * The tone of one cloud pixel: the puff's surface lit from above and the sun's
 * side, darkened toward the flat base, then cut into the three tones with an
 * ordered dither across each seam so the step is soft, not noisy. The base row
 * of a cloud with any body to it is always in shade.
 */
export function cloudTone(
  tones: CloudTones,
  at: PuffSurface & { readonly height: number; readonly sunSide: number },
  x: number,
  y: number,
): Rgb {
  const { nx, ny, height, sunSide } = at;
  if (height < 0.5 && ny < 0.5) {
    return tones.shade;
  }
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const norm = Math.hypot(LIGHT_SIDE, LIGHT_UP, LIGHT_FRONT);
  const light = (nx * sunSide * LIGHT_SIDE + ny * LIGHT_UP + nz * LIGHT_FRONT) / norm;
  const jitter = (ditherThreshold(x, y) - 0.5) * SEAM;
  if (light + jitter > LIT_ABOVE) {
    return tones.lit;
  }
  return light + jitter > BODY_ABOVE ? tones.body : tones.shade;
}
