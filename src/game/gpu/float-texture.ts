/**
 * A data texture a shader pass reads: floats, or bytes (`format: "byte"`) for
 * data that fits in them - tile texels, codes - at a quarter of the upload.
 *
 * Immutable storage (`texStorage2D`), so nothing can re-specify it as some
 * other format behind its back, and registered in the texture store under its
 * key so a pass names it the way it names any other input. Uploaded with no
 * flip and no premultiply: the fields keep material and detail in alpha, which
 * premultiplying would fold into every other channel.
 *
 * Read in GLSL with `texelFetch` only. Float textures are not filterable
 * without an extension, and nothing here wants filtering.
 */

import { rawTexture, type Scene } from "../../engine";

/** What a data texture holds per channel: a 32-bit float, or a byte read back as `value / 255`. */
export type TexelFormat = "float" | "byte";

export class FloatTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly format: TexelFormat;
  private readonly gl: WebGL2RenderingContext;
  private readonly texture: WebGLTexture;

  constructor(scene: Scene, key: string, width: number, height: number, format: TexelFormat = "float") {
    this.key = key;
    this.width = width;
    this.height = height;
    this.format = format;
    this.gl = scene.gl;
    const gl = this.gl;
    this.texture = rawTexture(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format === "float" ? gl.RGBA32F : gl.RGBA8, width, height);
    scene.textures.addGL(key, this.texture, width, height);
  }

  /**
   * Write a block of texels, four channels each, with its top-left at (x, y):
   * floats for a float texture, bytes for a byte one. `offset` is where in
   * `data` the block starts, in elements.
   */
  write(x: number, y: number, width: number, height: number, data: Float32Array | Uint8Array, offset = 0): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const type = this.format === "float" ? gl.FLOAT : gl.UNSIGNED_BYTE;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, type, data, offset);
  }
}

/**
 * Whether per-pixel passes can run. The engine only runs on WebGL2, so this is
 * true wherever the game runs at all; it remains so a layer can ask, and so
 * `?render=cpu` has one place to be honoured.
 */
export function hasWebGL2(scene: Scene): boolean {
  return typeof WebGL2RenderingContext !== "undefined" && scene.gl instanceof WebGL2RenderingContext;
}
