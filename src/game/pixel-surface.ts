/**
 * Pixel buffers on the GPU: the fast bridge from a cloud to the screen.
 *
 * `drawCloud` strokes a `Graphics` with one `fillRect` per pixel, which is fine
 * for a few hundred pixels and ruinous for tens of thousands — the first profile
 * of the full-colour scene spent a third of every frame there. This is the
 * replacement for anything big or baked:
 *
 * - `PixelSurface` is a per-frame canvas: clear it, paint clouds into its
 *   buffer, `commit()` once, and the whole thing reaches the GPU as one texture
 *   upload and one quad. The hero, the slimes and the effects draw this way.
 * - `installStrip` bakes a run of poses of one thing into one texture with a
 *   frame per pose, once. Scenery, grass and ground tiles draw this way — the
 *   work happens at load (or the first time a body is seen) and each frame
 *   afterwards is just choosing a frame.
 */

import type Phaser from "phaser";

import type { PixelCloud } from "./ink";
import { clearBuffer, createBuffer, paintInto, type PixelBuffer } from "./pixel-buffer";

let surfaceCount = 0;

/** A texture key nothing else has taken. */
export function uniqueKey(prefix: string): string {
  surfaceCount += 1;
  return `${prefix}-${surfaceCount}`;
}

export class PixelSurface {
  readonly image: Phaser.GameObjects.Image;
  readonly buffer: PixelBuffer;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly imageData: ImageData;
  private dirty = false;

  constructor(scene: Phaser.Scene, width: number, height: number, prefix = "surface") {
    const key = uniqueKey(prefix);
    const texture = scene.textures.createCanvas(key, width, height);
    if (texture === null) {
      throw new Error(`Could not create surface texture '${key}'`);
    }
    this.texture = texture;
    this.buffer = createBuffer(width, height);
    this.imageData = texture.getContext().createImageData(width, height);
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

  /** Upload what was painted. One texture upload, however many clouds went in. */
  commit(): this {
    if (!this.dirty) {
      return this;
    }
    this.imageData.data.set(this.buffer.data);
    this.texture.getContext().putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    this.dirty = false;
    return this;
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}

/**
 * Install equally-sized buffers as one texture, one frame each, named "0".."n-1".
 *
 * Laid out in a row, so frame `i` is at `x = i * width`. Returns false when the
 * key already exists, which lets a caller bake lazily and idempotently.
 */
export function installStrip(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frames: readonly PixelBuffer[],
): boolean {
  const first = frames[0];
  if (textures.exists(key) || first === undefined) {
    return false;
  }
  const width = first.width;
  const height = first.height;
  const canvas = textures.createCanvas(key, width * frames.length, height);
  if (canvas === null) {
    throw new Error(`Could not create strip texture '${key}'`);
  }
  const context = canvas.getContext();
  frames.forEach((frame, index) => {
    if (frame.width !== width || frame.height !== height) {
      throw new Error(`Strip '${key}' frame ${index} is ${frame.width}x${frame.height}; expected ${width}x${height}`);
    }
    const image = context.createImageData(width, height);
    image.data.set(frame.data);
    context.putImageData(image, index * width, 0);
    canvas.add(String(index), 0, index * width, 0, width, height);
  });
  canvas.refresh();
  return true;
}

/** Install a single buffer as a texture. */
export function installBuffer(
  textures: Phaser.Textures.TextureManager,
  key: string,
  buffer: PixelBuffer,
): boolean {
  return installStrip(textures, key, [buffer]);
}
