/**
 * Textures and the named frames within them.
 *
 * Two kinds, distinguished by which way up their rows are:
 *
 * - **Pictures** - bytes uploaded from a buffer, top row first. Premultiplied on
 *   the way up (`UNPACK_PREMULTIPLY_ALPHA_WEBGL`), because every draw here blends
 *   premultiplied (`blend.ts`).
 * - **Targets** - what a framebuffer renders into, bottom row first as GL
 *   lays them out. A shader pass reads them with `gl_FragCoord`/`texelFetch`
 *   in that layout, so they are kept that way and flipped only when drawn as an
 *   image (`flipY`).
 *
 * Data textures for shaders - floats, codes - are `gpu/float-texture.ts`, over
 * `rawTexture` here.
 */

import type { FrameRect } from "./quad";

/** The frame name that means the whole texture. */
export const BASE_FRAME = "__BASE";

export class Texture {
  private readonly frames = new Map<string, FrameRect>();

  constructor(
    readonly key: string,
    readonly gl: WebGL2RenderingContext,
    readonly glTexture: WebGLTexture,
    readonly width: number,
    readonly height: number,
    /** True for a framebuffer's texture: row 0 is the bottom of the picture. */
    readonly flipY: boolean,
  ) {
    this.frames.set(BASE_FRAME, { x: 0, y: 0, width, height });
  }

  /** Name a rectangle of this texture. */
  add(name: string | number, x: number, y: number, width: number, height: number): FrameRect {
    const frame = { x, y, width, height };
    this.frames.set(String(name), frame);
    return frame;
  }

  has(name: string | number): boolean {
    return this.frames.has(String(name));
  }

  /** A named frame, or the whole texture when unnamed or unknown (as Phaser falls back). */
  frame(name?: string | number): FrameRect {
    if (name === undefined) {
      return this.frames.get(BASE_FRAME) as FrameRect;
    }
    return this.frames.get(String(name)) ?? (this.frames.get(BASE_FRAME) as FrameRect);
  }

  frameNames(): string[] {
    return [...this.frames.keys()].filter((name) => name !== BASE_FRAME);
  }

  /** Re-upload the whole picture from `bytes` (RGBA, top row first). */
  update(bytes: Uint8Array): void {
    this.uploadRows(bytes, 0, this.height);
  }

  /** Re-upload rows `from..to` (exclusive) of a picture from the full-size `bytes`. */
  uploadRows(bytes: Uint8Array, from: number, to: number): void {
    if (to <= from) {
      return;
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, this.width, to - from, gl.RGBA, gl.UNSIGNED_BYTE, bytes, from * this.width * 4);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  destroy(): void {
    this.gl.deleteTexture(this.glTexture);
  }
}

/** A bare texture with nearest filtering and clamped edges, bound on unit 0. */
export function rawTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (texture === null) {
    throw new Error("Could not create a texture");
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Every texture by key. Keys are unique: adding one that exists is an error, as it was under Phaser. */
export class TextureStore {
  private readonly textures = new Map<string, Texture>();

  constructor(readonly gl: WebGL2RenderingContext) {}

  exists(key: string): boolean {
    return this.textures.has(key);
  }

  get(key: string): Texture {
    const texture = this.textures.get(key);
    if (texture === undefined) {
      throw new Error(`No texture '${key}'`);
    }
    return texture;
  }

  find(key: string): Texture | undefined {
    return this.textures.get(key);
  }

  keys(): string[] {
    return [...this.textures.keys()];
  }

  add(texture: Texture): Texture {
    if (this.textures.has(texture.key)) {
      throw new Error(`Texture '${texture.key}' already exists`);
    }
    this.textures.set(texture.key, texture);
    return texture;
  }

  /** A picture from RGBA bytes, top row first. */
  addBytes(key: string, bytes: Uint8Array, width: number, height: number): Texture {
    const gl = this.gl;
    const glTexture = rawTexture(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return this.add(new Texture(key, gl, glTexture, width, height, false));
  }

  /** An empty RGBA8 texture a framebuffer can render into. */
  addTarget(key: string, width: number, height: number): Texture {
    const gl = this.gl;
    const glTexture = rawTexture(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    return this.add(new Texture(key, gl, glTexture, width, height, true));
  }

  /** Register a texture made elsewhere (a data texture a pass reads) under a key. */
  addGL(key: string, glTexture: WebGLTexture, width: number, height: number): Texture {
    return this.add(new Texture(key, this.gl, glTexture, width, height, false));
  }

  remove(key: string): void {
    const texture = this.textures.get(key);
    if (texture !== undefined) {
      texture.destroy();
      this.textures.delete(key);
    }
  }
}
