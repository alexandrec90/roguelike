/**
 * The second bridge from a pixel cloud to a screen: an RGBA buffer.
 *
 * `draw-cloud.ts` is the bridge to Phaser, and it is the right one inside the
 * game. It is the wrong one for a page that wants to paint tens of thousands of
 * logical pixels per frame — a `Graphics` object costs a fill command each, and
 * a canopy that is a thresholded noise field is a great many pixels.
 *
 * This bridge writes straight into an `ImageData`-shaped byte array, which the
 * caller blits once and upscales with nearest-neighbour. Same clouds, same
 * inks, same alpha rules — the ink's own `INK_ALPHA` composited over whatever
 * is already there, so `water` is sheer and `void` punches black — but one
 * `putImageData` instead of thousands of draw calls.
 *
 * It is deliberately not a renderer: no scaling, no rotation, no smoothing. A
 * cloud pixel is one byte-quad at one integer position, which is the pixel
 * contract stated in the only place it can actually be violated.
 */

import { hexToRgb } from "./color";
import { inkHex, INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";

export interface RasterBuffer {
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

/** Ink channels, resolved once. Parsing hex per pixel would dominate the loop. */
const INK_CHANNELS: Readonly<Record<InkId, Channels>> = Object.fromEntries(
  (Object.keys(INK_COLORS) as InkId[]).map((ink) => {
    const { r, g, b } = hexToRgb(INK_COLORS[ink]);
    return [ink, { r, g, b, a: INK_ALPHA[ink] }];
  }),
) as Record<InkId, Channels>;

export function createRaster(width: number, height: number): RasterBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("A raster buffer needs positive integer dimensions");
  }
  return { width, height, data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)) };
}

/** Paint a solid rectangle, clipped to the buffer. The ground goes down first. */
export function fillRect(
  buffer: RasterBuffer,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  hex: string,
): void {
  const { r, g, b } = hexToRgb(hex);
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(buffer.width, box.x + box.width);
  const bottom = Math.min(buffer.height, box.y + box.height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * buffer.width + x) * 4;
      buffer.data[offset] = r;
      buffer.data[offset + 1] = g;
      buffer.data[offset + 2] = b;
      buffer.data[offset + 3] = 255;
    }
  }
}

/**
 * Composite a cloud at an origin.
 *
 * `alpha` is the caller's lighting opinion and multiplies the ink's own, the
 * same contract `drawCloud` holds to — a scene may dim a layer, but it may not
 * decide that a given colour is translucent.
 */
export function paintCloud(
  buffer: RasterBuffer,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  alpha = 1,
): void {
  for (const pixel of cloud) {
    const x = originX + pixel.x;
    const y = originY + pixel.y;
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
      continue;
    }
    blend(buffer, (y * buffer.width + x) * 4, INK_CHANNELS[pixel.ink], alpha);
  }
}

/**
 * Composite a block of RGBA bytes — what the GPU renderer hands back.
 *
 * Straight alpha, and fully transparent pixels are skipped rather than blended,
 * because the shader discards outside the body and a discarded fragment is
 * transparent black: blending it would darken whatever ground is underneath.
 */
export function paintRgba(
  buffer: RasterBuffer,
  pixels: Uint8ClampedArray,
  size: { readonly width: number; readonly height: number },
  originX: number,
  originY: number,
): void {
  for (let row = 0; row < size.height; row += 1) {
    for (let column = 0; column < size.width; column += 1) {
      const from = (row * size.width + column) * 4;
      const alpha = (pixels[from + 3] ?? 0) / 255;
      if (alpha === 0) {
        continue;
      }
      const x = originX + column;
      const y = originY + row;
      if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
        continue;
      }
      blend(
        buffer,
        (y * buffer.width + x) * 4,
        { r: pixels[from] ?? 0, g: pixels[from + 1] ?? 0, b: pixels[from + 2] ?? 0, a: alpha },
        1,
      );
    }
  }
}

/**
 * Paint a cloud straight onto a 2D context, one fill per pixel.
 *
 * For the handful of particles a GPU-drawn body carries on top of itself. A
 * `putImageData` cannot be used there — it would erase what the GPU just blitted
 * rather than compositing over it — and at these counts the fill calls are
 * cheaper than another full-frame buffer.
 */
export function paintCloudOnContext(
  context: CanvasRenderingContext2D,
  cloud: PixelCloud,
  originX: number,
  originY: number,
): void {
  for (const pixel of cloud) {
    context.fillStyle = inkHex(pixel.ink);
    context.fillRect(originX + pixel.x, originY + pixel.y, 1, 1);
  }
}

function blend(buffer: RasterBuffer, offset: number, ink: Channels, alpha: number): void {
  const a = Math.min(Math.max(ink.a * alpha, 0), 1);
  if (a >= 1) {
    buffer.data[offset] = ink.r;
    buffer.data[offset + 1] = ink.g;
    buffer.data[offset + 2] = ink.b;
    buffer.data[offset + 3] = 255;
    return;
  }
  const keep = 1 - a;
  buffer.data[offset] = ink.r * a + (buffer.data[offset] ?? 0) * keep;
  buffer.data[offset + 1] = ink.g * a + (buffer.data[offset + 1] ?? 0) * keep;
  buffer.data[offset + 2] = ink.b * a + (buffer.data[offset + 2] ?? 0) * keep;
  buffer.data[offset + 3] = 255;
}
