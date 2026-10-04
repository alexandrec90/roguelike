/**
 * Where the world is drawn mirrored, for the water to read back.
 *
 * Half the drawing buffer's size each way - a quarter of the pixels - because a
 * reflection is always seen through a ripple, and nobody can tell. Cleared to
 * the sky still water shows: in a parallel projection every pixel of a mirror
 * looks the same way up, so that is one colour, not a gradient.
 */

/** The share of the drawing buffer the reflection is drawn at, each way. */
export const REFLECTION_SCALE = 0.5;

export class ReflectionTarget {
  private readonly framebuffer: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  private readonly depth: WebGLRenderbuffer;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.framebuffer = gl.createFramebuffer();
    this.texture = gl.createTexture();
    this.depth = gl.createRenderbuffer();
  }

  /** Draw into it from now on, sized for a drawing buffer this big, cleared to `sky`. */
  bind(bufferWidth: number, bufferHeight: number, sky: readonly [number, number, number]): void {
    const gl = this.gl;
    this.fit(Math.max(1, Math.round(bufferWidth * REFLECTION_SCALE)), Math.max(1, Math.round(bufferHeight * REFLECTION_SCALE)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Back to the screen. */
  unbind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private fit(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    // Whatever unit was active now holds the target: let go, or drawing into it reads it too.
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
