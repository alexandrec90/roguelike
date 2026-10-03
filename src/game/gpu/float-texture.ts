/**
 * A float texture Phaser can hand to a `Shader`: data, not a picture. Or a
 * byte texture on the same terms (`format: "byte"`), for data that fits in
 * bytes - tile texels, codes - at a quarter of the upload.
 *
 * Phaser's texture wrapper only ever uploads bytes, so the texture is made
 * through it (keeping Phaser's own bookkeeping of what is bound where) and then
 * re-specified as RGBA32F. Every upload binds through `glTextureUnits` with
 * both force flags: without them the bind can leave another unit active, and
 * the upload lands in whatever texture that unit holds - silently, as the
 * first attempt at this found.
 *
 * Read in GLSL with `texelFetch` only. Float textures are not filterable
 * without an extension, and nothing here wants filtering.
 */

import Phaser from "phaser";

/** What a data texture holds per channel: a 32-bit float, or a byte read back as `value / 255`. */
export type TexelFormat = "float" | "byte";

export class FloatTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly format: TexelFormat;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly wrapper: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;

  constructor(scene: Phaser.Scene, key: string, width: number, height: number, format: TexelFormat = "float") {
    this.key = key;
    this.width = width;
    this.height = height;
    this.format = format;
    this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = this.renderer.gl as WebGL2RenderingContext;
    this.wrapper = this.renderer.createTexture2D(
      0,
      gl.NEAREST,
      gl.NEAREST,
      gl.CLAMP_TO_EDGE,
      gl.CLAMP_TO_EDGE,
      gl.RGBA,
      undefined,
      1,
      1,
      false,
      true,
      false,
    );
    // Registered first, on a one-texel byte placeholder: `addGLTexture` sets
    // the filter, which re-specifies the texture as bytes - and wiped every
    // float uploaded before it, with no error, the first time this was tried.
    scene.textures.addGLTexture(key, this.wrapper);
    this.allocate(gl);
  }

  /**
   * Swap the placeholder for immutable RGBA32F storage. Immutable, so anything
   * that later tries to re-specify it as bytes fails loudly instead of quietly
   * zeroing it. Phaser's record of which unit holds the wrapper is dropped
   * first, so nothing is left believing the old texture is still bound.
   */
  private allocate(gl: WebGL2RenderingContext): void {
    this.renderer.glTextureUnits.unbindTexture(this.wrapper);
    const placeholder = this.wrapper.webGLTexture;
    const storage = gl.createTexture();
    if (storage === null) {
      throw new Error(`Could not create float texture '${this.key}'`);
    }
    this.wrapper.webGLTexture = storage;
    this.wrapper.width = this.width;
    this.wrapper.height = this.height;
    this.bind();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.format === "float" ? gl.RGBA32F : gl.RGBA8, this.width, this.height);
    gl.deleteTexture(placeholder);
  }

  /**
   * Write a block of texels, four channels each, with its top-left at (x, y):
   * floats for a float texture, bytes for a byte one. `offset` is where in
   * `data` the block starts, in elements.
   */
  write(x: number, y: number, width: number, height: number, data: Float32Array | Uint8Array, offset = 0): void {
    const gl = this.renderer.gl as WebGL2RenderingContext;
    this.bind();
    const type = this.format === "float" ? gl.FLOAT : gl.UNSIGNED_BYTE;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, type, data, offset);
  }

  /**
   * Bind for an upload, with the unpack state data needs. WebGL applies
   * flip-Y and premultiplied alpha to typed arrays too, and Phaser leaves
   * premultiply on for its pictures: the fields keep material and detail in
   * alpha, which would multiply every other channel. Set through Phaser's own
   * state tracker, so the next picture it uploads sets it back.
   */
  private bind(): void {
    this.renderer.glWrapper.updateTexturing({ texturing: { flipY: false, premultiplyAlpha: false } });
    this.renderer.glTextureUnits.bind(this.wrapper, 0, true, true);
  }
}

/** Whether this scene renders on WebGL2, which every GPU pass here needs. */
export function hasWebGL2(scene: Phaser.Scene): boolean {
  const renderer = scene.sys.renderer as Partial<Phaser.Renderer.WebGL.WebGLRenderer>;
  return typeof WebGL2RenderingContext !== "undefined" && renderer.gl instanceof WebGL2RenderingContext;
}
