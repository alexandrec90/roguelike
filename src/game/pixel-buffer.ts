/**
 * A pixel cloud composited into an RGBA buffer, with real alpha.
 *
 * `cloud-raster.ts` paints onto an opaque ground (it writes alpha 255 every
 * time), which is right for a lab page that has already filled its background.
 * A *surface* the game draws over the world is the opposite case: it starts
 * transparent, and a sheer ink painted onto it — a cast shadow, smoke, a slime's
 * body — has to stay sheer, so the world underneath still shows through when
 * the texture is drawn. That needs the full "over" operator, so it lives here.
 *
 * Pure and Phaser-free: a buffer in, a buffer out. `pixel-surface.ts` is the
 * thin half that hands one to the GPU.
 */

import { hexToRgb } from "./color";
import { INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

interface Channels {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Resolved once: parsing a hex per pixel would dominate every paint loop. */
const CHANNELS = new Map<InkId, Channels>();

function channelsOf(ink: InkId): Channels {
  let channels = CHANNELS.get(ink);
  if (channels === undefined) {
    const { r, g, b } = hexToRgb(INK_COLORS[ink]);
    channels = { r, g, b, a: INK_ALPHA[ink] };
    CHANNELS.set(ink, channels);
  }
  return channels;
}

export function createBuffer(width: number, height: number): PixelBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("A pixel buffer needs positive integer dimensions");
  }
  return { width, height, data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)) };
}

/** Back to fully transparent. */
export function clearBuffer(buffer: PixelBuffer): void {
  buffer.data.fill(0);
}

/**
 * Composite one ink over one pixel with the "over" operator.
 *
 * `alpha` is the caller's lighting opinion and multiplies the ink's own, the
 * same contract `drawCloud` keeps: a layer may be dimmed, but a colour's
 * sheerness belongs to the ink.
 */
export function blendInk(buffer: PixelBuffer, x: number, y: number, ink: InkId, alpha = 1): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
    return;
  }
  const source = channelsOf(ink);
  const a = Math.min(Math.max(source.a * alpha, 0), 1);
  if (a <= 0) {
    return;
  }
  compositeOver(buffer.data, (y * buffer.width + x) * 4, source.r, source.g, source.b, a);
}

/**
 * The "over" operator at one byte offset: `(r, g, b)` at opacity `a` onto
 * whatever is there. The one place compositing is written down.
 */
export function compositeOver(
  data: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (a >= 1) {
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
    return;
  }
  const below = (data[offset + 3] ?? 0) / 255;
  const out = a + below * (1 - a);
  const keep = (below * (1 - a)) / out;
  const take = a / out;
  data[offset] = r * take + (data[offset] ?? 0) * keep;
  data[offset + 1] = g * take + (data[offset + 1] ?? 0) * keep;
  data[offset + 2] = b * take + (data[offset + 2] ?? 0) * keep;
  data[offset + 3] = out * 255;
}

/** Paint a whole cloud with its (0, 0) at `(originX, originY)` in the buffer. */
export function paintInto(
  buffer: PixelBuffer,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  alpha = 1,
): void {
  for (const pixel of cloud) {
    blendInk(buffer, originX + pixel.x, originY + pixel.y, pixel.ink, alpha);
  }
}

/** The RGBA quad at a pixel, for tests and for readback. */
export function bufferPixel(
  buffer: PixelBuffer,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * buffer.width + x) * 4;
  const data = buffer.data;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
}

/** A cloud flattened to a tightly-sized buffer, with where its (0, 0) landed. */
export interface BakedCloud {
  readonly buffer: PixelBuffer;
  readonly originX: number;
  readonly originY: number;
}

/**
 * Flatten a cloud into the smallest buffer that holds it.
 *
 * `pad` adds transparent margin on every side, which a caller baking several
 * poses of one body into a strip uses to give them one shared frame size.
 */
export function bakeCloud(cloud: PixelCloud, pad = 0): BakedCloud {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const pixel of cloud) {
    left = Math.min(left, pixel.x);
    top = Math.min(top, pixel.y);
    right = Math.max(right, pixel.x);
    bottom = Math.max(bottom, pixel.y);
  }
  if (!Number.isFinite(left)) {
    return { buffer: createBuffer(1, 1), originX: 0, originY: 0 };
  }
  const buffer = createBuffer(right - left + 1 + pad * 2, bottom - top + 1 + pad * 2);
  const originX = pad - left;
  const originY = pad - top;
  paintInto(buffer, cloud, originX, originY);
  return { buffer, originX, originY };
}

/** Copy `source` into `target` with its top-left at (x, y), compositing over. */
export function blitBuffer(target: PixelBuffer, source: PixelBuffer, x: number, y: number): void {
  const from = source.data;
  const left = Math.max(0, -x);
  const right = Math.min(source.width, target.width - x);
  const top = Math.max(0, -y);
  const bottom = Math.min(source.height, target.height - y);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const s = (row * source.width + column) * 4;
      const a = (from[s + 3] ?? 0) / 255;
      if (a > 0) {
        const t = ((y + row) * target.width + x + column) * 4;
        compositeOver(target.data, t, from[s] ?? 0, from[s + 1] ?? 0, from[s + 2] ?? 0, a);
      }
    }
  }
}
