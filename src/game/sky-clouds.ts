/**
 * Clouds in the sky band, as pixel-art cumulus rather than thresholded noise.
 *
 * The clouds used to be a 3D noise field cut at a threshold and dithered pixel
 * by pixel between a lit and a shaded colour. In a sky sixteen scanlines tall
 * that reads as speckle: the noise's finest octave was a pixel or two high, and
 * every cloud was a scatter of dots with a ragged edge. A cloud a painter would
 * put there is a shape - a flat base where the air stops lifting it, a puffy
 * crown, a bright rim on the side the sun is on - and this draws that shape.
 *
 * Each deck is a layer at one height. Along the bearing, a slow seeded noise
 * says how much cloud there is, and where there is any the deck stands up a
 * column from its base: thicker in the middle of a cloud, rounded at its ends
 * (the square root of how far past the threshold it is), and bumped by a finer
 * noise so the crown puffs. Light is three tones - the crown and the sun-facing
 * slopes catch it, the base is in the cloud's own shade - dithered only across
 * the one row where one tone gives way to the next.
 *
 * Read around a circle in noise space, so a full turn of the panorama comes
 * back to the same cloud with no seam; built once per deck and only sampled
 * after, so a sky that repaints every frame of a turn stays cheap. Overcast
 * lowers the threshold and thickens the decks until they close into one grey
 * sheet.
 *
 * Pure: a deck, a bearing and the hour's colours in, pixels out through `put`.
 */

import { hexToRgb, mixHex, type Rgb } from "./color";
import { PANORAMA_WIDTH, wrapPanorama } from "./panorama";
import { fbm3 } from "./procgen/noise";
import { ditherThreshold } from "./shading";

export interface CloudDeck {
  /** The deck's flat base, as a share of the sky band's height from the top. */
  readonly base: number;
  /** Tallest a cloud on it stands, in scanlines, on a clear day. */
  readonly height: number;
  /** Coverage noise must clear this for there to be cloud, on a clear day. */
  readonly cover: number;
  /** Panorama pixels per noise cell: how long a cloud is. */
  readonly wavelength: number;
  /** Share of the sky's drift this deck moves by: a higher deck is slower. */
  readonly drift: number;
  readonly seed: number;
}

/** A high, thin, slow deck and a low, puffy one in front of it. */
export const CLOUD_DECKS: readonly CloudDeck[] = [
  { base: 0.4, height: 2.5, cover: 0.58, wavelength: 90, drift: 0.55, seed: 0xc10d },
  { base: 0.82, height: 6, cover: 0.55, wavelength: 52, drift: 1, seed: 0x5ca1 },
];

/** How far overcast lowers the threshold and raises the decks. */
const OVERCAST_COVER = 0.42;
const OVERCAST_HEIGHT = 0.8;

interface DeckNoise {
  /** How much cloud, per panorama column, 0..1. */
  readonly body: Float32Array;
  /** The crown's bumps, per panorama column, 0..1. */
  readonly puff: Float32Array;
}

const NOISE = new Map<string, DeckNoise>();

/** One octave pair of noise around the panorama's circle: seamless at the wrap. */
function ringNoise(column: number, wavelength: number, seed: number): number {
  const angle = (wrapPanorama(column) / PANORAMA_WIDTH) * Math.PI * 2;
  const radius = PANORAMA_WIDTH / (Math.PI * 2) / wavelength;
  return fbm3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0, seed, { octaves: 2 });
}

function deckNoise(deck: CloudDeck): DeckNoise {
  const key = `${deck.seed}:${deck.wavelength}`;
  let noise = NOISE.get(key);
  if (noise === undefined) {
    const body = new Float32Array(PANORAMA_WIDTH);
    const puff = new Float32Array(PANORAMA_WIDTH);
    for (let column = 0; column < PANORAMA_WIDTH; column += 1) {
      body[column] = ringNoise(column, deck.wavelength, deck.seed);
      puff[column] = ringNoise(column, deck.wavelength / 4, deck.seed ^ 0x9e37);
    }
    noise = { body, puff };
    NOISE.set(key, noise);
  }
  return noise;
}

/**
 * How many scanlines of cloud stand on the deck at a panorama column: 0 for
 * clear sky. Rounded at a cloud's ends by the square root, puffed by the
 * finer noise, and taller and more continuous the more overcast it is.
 */
export function cloudThickness(deck: CloudDeck, column: number, overcast: number): number {
  const noise = deckNoise(deck);
  const index = wrapPanorama(Math.round(column));
  const cover = deck.cover - overcast * OVERCAST_COVER;
  const amount = ((noise.body[index] ?? 0) - cover) / Math.max(1 - cover, 0.05);
  if (amount <= 0) {
    return 0;
  }
  const puff = 0.7 + 0.6 * (noise.puff[index] ?? 0.5);
  return deck.height * (1 + overcast * OVERCAST_HEIGHT) * Math.sqrt(Math.min(amount, 1)) * puff;
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
  const lit = mixHex(mixHex(mixHex(atmosphere.skyHorizon, "#ffffff", 0.6), atmosphere.ambient, 0.25), "#a9afb8", grey);
  const shade = mixHex(mixHex(atmosphere.skyTop, atmosphere.skyHorizon, 0.6), "#6e7480", grey);
  return { shade: hexToRgb(shade), body: hexToRgb(mixHex(lit, shade, 0.4)), lit: hexToRgb(lit) };
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
  const start = Math.round(paint.offset + paint.drift * deck.drift);
  const thickness = (x: number): number => cloudThickness(deck, start + x, paint.overcast);
  for (let x = 0; x < paint.width; x += 1) {
    const here = thickness(x);
    if (here <= 0) {
      continue;
    }
    // A wisp thinner than a scanline is a single sheer row, not a solid one.
    const alpha = Math.min(1, 0.35 + here * 0.65) * 0.95;
    const top = base - here;
    // The side facing the sun is where the crown falls away toward it.
    const sunward = thickness(x + paint.sunSide * 2) < here - 0.4;
    for (let y = Math.max(Math.round(top), 0); y <= base && y < paint.skyHeight; y += 1) {
      put(x, y, cloudTone(paint.tones, { depth: y - top, thickness: here, sunward }, x, y), alpha);
    }
  }
}

/**
 * The tone of one cloud pixel `depth` scanlines below its crown in a column
 * `thickness` tall: the crown's first row and a sunward slope lit, the base
 * row shaded once there is a body to shade, the rest the body - with a one-row
 * dither where crown light gives way to body, so the step is soft, not noisy.
 */
export function cloudTone(
  tones: CloudTones,
  at: { readonly depth: number; readonly thickness: number; readonly sunward: boolean },
  x: number,
  y: number,
): Rgb {
  const { depth, thickness, sunward } = at;
  if (thickness >= 2 && thickness - depth < 0.75) {
    return tones.shade;
  }
  if (depth < 1 || (sunward && depth < 2.5)) {
    return tones.lit;
  }
  if (depth < 2) {
    return depth - 1 < ditherThreshold(x, y) ? tones.lit : tones.body;
  }
  return tones.body;
}
