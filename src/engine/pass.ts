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
 *
 * `ScreenPass` is the same thing drawn onto the canvas at its full resolution
 * instead of into a target: the backdrop behind the world (`game.ts`).
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

/**
 * A linked program, the quad it draws and its uniforms by name: what a
 * `ShaderPass` and a `ScreenPass` share.
 */
class Program {
  readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly slots = new Map<string, UniformSlot>();

  /** `corners` is x, y, u, v for a strip of two triangles. */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    name: string,
    corners: Float32Array,
  ) {
    this.program = compileProgram(gl, vertexSource, fragmentSource, name);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (vao === null || buffer === null) {
      throw new Error(`Could not create pass '${name}'`);
    }
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    for (const [attribute, offset] of [
      ["inPosition", 0],
      ["inTexCoord", 8],
    ] as const) {
      const location = gl.getAttribLocation(this.program, attribute);
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
  }

  /**
   * Draw the quad into whatever framebuffer and viewport are bound, unblended:
   * samplers on units in order, then every uniform.
   */
  draw(textures: TextureStore, samplers: readonly [string, string][], uniforms: Readonly<Record<string, UniformValue>>): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    samplers.forEach(([uniform, key], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures.get(key).glTexture);
      this.set(uniform, unit);
    });
    for (const [name, value] of Object.entries(uniforms)) {
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
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}

export class ShaderPass {
  readonly texture: Texture;
  private readonly program: Program;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly samplers: readonly [string, string][];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly textures: TextureStore,
    key: string,
    private readonly options: PassOptions,
  ) {
    this.texture = textures.addTarget(key, options.width, options.height);
    const { width: w, height: h } = options;
    this.program = new Program(
      gl,
      options.vertexSource,
      options.fragmentSource,
      options.name,
      new Float32Array([0, 0, 0, 0, w, 0, 1, 0, 0, h, 0, 1, w, h, 1, 1]),
    );
    const framebuffer = gl.createFramebuffer();
    if (framebuffer === null) {
      throw new Error(`Could not create pass '${options.name}'`);
    }
    this.framebuffer = framebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture.glTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.program.draw(this.textures, this.samplers, {
      uProjectionMatrix: pixelProjection(this.options.width, this.options.height),
      ...this.options.uniforms(),
    });
  }

  destroy(): void {
    this.program.destroy();
    this.gl.deleteFramebuffer(this.framebuffer);
    this.textures.remove(this.texture.key);
  }
}

/** A device-pixel rectangle of the canvas, measured from its top-left. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenPassOptions {
  readonly name: string;
  readonly fragmentSource: string;
  /** Sampler uniform → key of the texture it reads. Bound to units in this order. */
  readonly samplers: Readonly<Record<string, string>>;
}

/**
 * The quad over the viewport, in clip space. The fragment stage reads
 * `gl_FragCoord`, which counts from the canvas's bottom-left whatever the viewport.
 */
const SCREEN_VERTEX_SHADER = `#version 300 es
in vec2 inPosition;
void main() {
  gl_Position = vec4(inPosition, 0.0, 1.0);
}
`;

/**
 * A fragment shader over a rectangle of the canvas itself, at the canvas's
 * own resolution - not into a target of its own, and not at the 320×180 the
 * world is drawn at. What `Game` draws a `Backdrop` with (`game.ts`): the one
 * place the game puts pixels finer than a logical pixel.
 */
export class ScreenPass {
  private readonly program: Program;
  private readonly samplers: readonly [string, string][];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly textures: TextureStore,
    options: ScreenPassOptions,
  ) {
    this.program = new Program(
      gl,
      SCREEN_VERTEX_SHADER,
      options.fragmentSource,
      options.name,
      new Float32Array([-1, -1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0]),
    );
    this.samplers = Object.entries(options.samplers);
  }

  /** Run the shader over `rect` of the bound canvas, `canvasHeight` device pixels tall. */
  render(rect: ScreenRect, canvasHeight: number, uniforms: Readonly<Record<string, UniformValue>>): void {
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const gl = this.gl;
    gl.viewport(rect.x, canvasHeight - rect.y - rect.height, rect.width, rect.height);
    this.program.draw(this.textures, this.samplers, uniforms);
  }

  destroy(): void {
    this.program.destroy();
  }
}
