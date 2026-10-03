/**
 * A shader pass: one fragment shader run over every pixel of its own target,
 * on demand, off the display list.
 *
 * This is how per-pixel work reaches the GPU (`.claude/rules/rendering.md`):
 * the landform march and the horizon lip are passes, and an image on the list
 * shows the result. `render()` runs it *now* - clears the target and draws one
 * quad over it - so a layer can run a chain of passes in order, each reading
 * the last, within its update.
 *
 * Uniforms are set by the type the linked program reports for each name, so a
 * caller hands over plain numbers and arrays and never picks `uniform4fv` by
 * hand; an array is addressed by its first element, `u_ramp[0]`, as GL names it.
 */

import { compileProgram } from "./batcher";
import type { Texture, TextureStore } from "./texture";

export type UniformValue = number | readonly number[] | Float32Array | Int32Array;

export interface PassOptions {
  readonly name: string;
  readonly vertexSource: string;
  readonly fragmentSource: string;
  readonly width: number;
  readonly height: number;
  /** Sampler uniform → key of the texture it reads. Bound to units in this order. */
  readonly samplers: Readonly<Record<string, string>>;
  /** Called on every render for the other uniforms. */
  readonly uniforms: () => Readonly<Record<string, UniformValue>>;
}

interface UniformSlot {
  readonly location: WebGLUniformLocation;
  readonly type: number;
}

/** A column-major orthographic matrix taking pixels (0..w, 0..h) to clip space, y down. */
export function pixelProjection(width: number, height: number): Float32Array {
  // prettier-ignore
  return new Float32Array([
    2 / width, 0, 0, 0,
    0, -2 / height, 0, 0,
    0, 0, 1, 0,
    -1, 1, 0, 1,
  ]);
}

export class ShaderPass {
  readonly texture: Texture;
  private readonly program: WebGLProgram;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly slots = new Map<string, UniformSlot>();
  private readonly samplers: readonly [string, string][];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly textures: TextureStore,
    key: string,
    private readonly options: PassOptions,
  ) {
    this.texture = textures.addTarget(key, options.width, options.height);
    this.program = compileProgram(gl, options.vertexSource, options.fragmentSource, options.name);
    const framebuffer = gl.createFramebuffer();
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (framebuffer === null || vao === null || buffer === null) {
      throw new Error(`Could not create pass '${options.name}'`);
    }
    this.framebuffer = framebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture.glTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const { width: w, height: h } = options;
    // x, y, u, v for a strip of two triangles over the whole target.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, w, 0, 1, 0, 0, h, 0, 1, w, h, 1, 1]), gl.STATIC_DRAW);
    for (const [name, offset] of [
      ["inPosition", 0],
      ["inTexCoord", 8],
    ] as const) {
      const location = gl.getAttribLocation(this.program, name);
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
      }
    }
    gl.bindVertexArray(null);

    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < count; index += 1) {
      const info = gl.getActiveUniform(this.program, index);
      const location = info === null ? null : gl.getUniformLocation(this.program, info.name);
      if (info !== null && location !== null) {
        this.slots.set(info.name, { location, type: info.type });
      }
    }
    this.samplers = Object.entries(options.samplers);
  }

  get key(): string {
    return this.texture.key;
  }

  /** Clear the target and run the shader over it. */
  render(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.options.width, this.options.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    this.samplers.forEach(([uniform, key], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(key).glTexture);
      this.set(uniform, unit);
    });
    this.set("uProjectionMatrix", pixelProjection(this.options.width, this.options.height));
    for (const [name, value] of Object.entries(this.options.uniforms())) {
      this.set(name, value);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
  }

  /** Set a uniform by the type the program declared; a name it does not use is ignored. */
  private set(name: string, value: UniformValue): void {
    const slot = this.slots.get(name);
    if (slot === undefined) {
      return;
    }
    const gl = this.gl;
    const list: readonly number[] | Float32Array | Int32Array = typeof value === "number" ? [value] : value;
    switch (slot.type) {
      case gl.FLOAT:
        gl.uniform1fv(slot.location, list as Float32List);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(slot.location, list as Float32List);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(slot.location, list as Float32List);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(slot.location, list as Float32List);
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(slot.location, false, list as Float32List);
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(slot.location, list as Int32List);
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(slot.location, list as Int32List);
        break;
      case gl.INT_VEC4:
        gl.uniform4iv(slot.location, list as Int32List);
        break;
      default:
        // int, bool and every sampler type
        gl.uniform1iv(slot.location, list as Int32List);
    }
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vao);
    this.textures.remove(this.texture.key);
  }
}
