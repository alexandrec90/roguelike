/**
 * Pixel buffers on the GPU: the fast bridge from a cloud to the screen.
 *
 * `drawCloud` strokes a `Graphics` with one `fillRect` per pixel, which is fine
 * for a few hundred pixels and ruinous for tens of thousands — the first profile
 * of the full-colour scene spent a third of every frame there. This is the
 * replacement for anything big or baked:
 *
 * - `PixelSurface` is a per-frame texture: clear it, paint clouds into its
 *   buffer, `commit()` once, and the whole thing reaches the GPU as one texture
 *   upload and one quad. The hero, the slimes and the effects draw this way.
 * - `installStrip` / `installFrames` bake a run of pictures of one thing into
 *   one texture with a frame per picture, once. Scenery, grass and ground tiles
 *   draw this way — the work happens at load (or the first time a body is
 *   seen) and each frame afterwards is just choosing a frame.
 *
 * **Bytes go straight to the GPU.** These used to be canvas textures: a commit
 * copied the buffer into a 2D canvas with `putImageData` and the framework then
 * uploaded the canvas - two copies, and the first through the 2D canvas's own
 * pixel conversion. Measured on the HD 530 that was ~0.7 ms a frame across the
 * dozen surfaces a scene keeps. A buffer is now a `Uint8Array` texture, uploaded
 * from the buffer itself, premultiplied on the way up exactly as a canvas was.
 */

import { uniqueKey, type Image, type Scene, type Texture, type TextureStore } from "../engine";
import type { PixelCloud } from "./ink";
import { clearBuffer, createBuffer, paintInto, type PixelBuffer } from "./pixel-buffer";

export { uniqueKey };

/** A buffer's bytes as the `Uint8Array` the GPU uploads directly - the same memory, not a copy. */
function bytesOf(data: Uint8ClampedArray<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

export class PixelSurface {
  readonly image: Image;
  readonly buffer: PixelBuffer;
  private readonly texture: Texture;
  private readonly bytes: Uint8Array<ArrayBuffer>;
  private dirty = false;

  constructor(scene: Scene, width: number, height: number, prefix = "surface") {
    const key = uniqueKey(prefix);
    this.buffer = createBuffer(width, height);
    this.bytes = bytesOf(this.buffer.data);
    this.texture = scene.textures.addBytes(key, this.bytes, width, height);
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0);
  }

  get width(): number {
    return this.buffer.width;
  }

  get height(): number {
    return this.buffer.height;
  }

  clear(): this {
    clearBuffer(this.buffer);
    this.dirty = true;
    return this;
  }

  /** Paint a cloud with its (0, 0) at buffer pixel `(x, y)`. */
  paint(cloud: PixelCloud, x: number, y: number, alpha = 1): this {
    paintInto(this.buffer, cloud, x, y, alpha);
    this.dirty = true;
    return this;
  }

  /** Mark the buffer changed after writing to it directly. */
  touch(): this {
    this.dirty = true;
    return this;
  }

  /** Clear only buffer rows `from..to` (exclusive), for a surface whose drawing keeps to a band. */
  clearRows(from: number, to: number): this {
    const first = Math.max(0, from);
    const last = Math.min(this.height, to);
    if (last > first) {
      this.buffer.data.fill(0, first * this.width * 4, last * this.width * 4);
      this.dirty = true;
    }
    return this;
  }

  /**
   * Upload what was painted. One texture upload, however many clouds went in;
   * with `rows`, only that band of rows (`to` exclusive) - the water surface
   * covers the screen and changes only where the puddles are.
   */
  commit(rows?: { readonly from: number; readonly to: number }): this {
    if (!this.dirty) {
      return this;
    }
    if (rows === undefined) {
      this.texture.update(this.bytes);
    } else {
      this.texture.uploadRows(this.bytes, Math.max(0, rows.from), Math.min(this.height, rows.to));
    }
    this.dirty = false;
    return this;
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}

/** Where each picture landed in a packed set. */
export interface PackedFrame {
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

/** Pictures laid side by side in one RGBA block, top-aligned; an empty one keeps a transparent pixel. */
export interface PackedFrames {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly frames: readonly PackedFrame[];
}

/** Lay `buffers` out in a row, each at the right of the last. Pure. */
export function packFrames(buffers: readonly PixelBuffer[]): PackedFrames {
  const frames: PackedFrame[] = [];
  let width = 0;
  let height = 1;
  for (const buffer of buffers) {
    const frame = { x: width, width: Math.max(buffer.width, 1), height: Math.max(buffer.height, 1) };
    frames.push(frame);
    width += frame.width;
    height = Math.max(height, frame.height);
  }
  const data = new Uint8Array(new ArrayBuffer(Math.max(width, 1) * height * 4));
  buffers.forEach((buffer, index) => {
    const left = frames[index]?.x ?? 0;
    for (let row = 0; row < buffer.height; row += 1) {
      const from = row * buffer.width * 4;
      data.set(buffer.data.subarray(from, from + buffer.width * 4), (row * width + left) * 4);
    }
  });
  return { width: Math.max(width, 1), height, data, frames };
}

/**
 * Install buffers of any sizes as one texture, side by side, one frame each,
 * named "0".."n-1". One upload and one texture for a whole set - a body's
 * horizon ladder is forty pictures, and forty textures each was two thousand
 * across a wood. Returns false when the key already exists.
 */
export function installFrames(textures: TextureStore, key: string, buffers: readonly PixelBuffer[]): boolean {
  if (textures.exists(key) || buffers.length === 0) {
    return false;
  }
  const packed = packFrames(buffers);
  const texture = textures.addBytes(key, packed.data, packed.width, packed.height);
  packed.frames.forEach((frame, index) => {
    texture.add(String(index), frame.x, 0, frame.width, frame.height);
  });
  return true;
}

/**
 * Install equally-sized buffers as one texture, one frame each, named "0".."n-1".
 *
 * Laid out in a row, so frame `i` is at `x = i * width`. Returns false when the
 * key already exists, which lets a caller bake lazily and idempotently.
 */
export function installStrip(textures: TextureStore, key: string, frames: readonly PixelBuffer[]): boolean {
  const first = frames[0];
  frames.forEach((frame, index) => {
    if (first !== undefined && (frame.width !== first.width || frame.height !== first.height)) {
      throw new Error(`Strip '${key}' frame ${index} is ${frame.width}x${frame.height}; expected ${first.width}x${first.height}`);
    }
  });
  return installFrames(textures, key, frames);
}

/** Install a single buffer as a texture. */
export function installBuffer(textures: TextureStore, key: string, buffer: PixelBuffer): boolean {
  return installStrip(textures, key, [buffer]);
}
