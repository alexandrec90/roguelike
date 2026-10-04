/**
 * The WebGL2 half of the skin: the only file here that touches the context.
 *
 * Three kinds of buffer and two passes. Each chunk of the planet is two static
 * buffers uploaded once (`world-chunks.ts`); the hero and the actors are
 * re-uploaded each frame, a few hundred triangles. The solid pass draws them
 * all with depth; the sheer pass lays shadows, water and spell light over it,
 * blended, without writing depth. The sky is one triangle before either.
 *
 * Budget: ~140 draw calls and ~150k triangles, almost all of them static - an
 * integrated GPU's comfortable territory. The CPU's share is building the
 * actor meshes (well under a millisecond) and setting a dozen uniforms.
 */

import type { Atmosphere } from "../../game/atmosphere";
import { rgb, VERTEX_BYTES, type Rgb } from "./mesh";
import { DEPTH_FAR, DEPTH_NEAR, type LowpolyView } from "./placement";
import { SKY_FRAGMENT, SKY_VERTEX, WORLD_FRAGMENT, WORLD_VERTEX } from "./shaders";

interface Drawable {
  readonly vao: WebGLVertexArrayObject;
  readonly buffer: WebGLBuffer;
  count: number;
}

/** What one draw needs besides its buffer: where its origin is, and whether it turns with the world. */
export interface DrawFrame {
  /** Planet tiles from the hero to the buffer's origin. */
  readonly offset: readonly [number, number];
  /** The turn applied to it: the world's, or 0 for something built in the local frame. */
  readonly turn: number;
}

export interface FrameUniforms {
  readonly view: LowpolyView;
  readonly atmosphere: Atmosphere;
  readonly shake: { readonly x: number; readonly y: number };
}

export class LowpolyRenderer {
  private readonly world: WebGLProgram;
  private readonly sky: WebGLProgram;
  private readonly skyVao: WebGLVertexArrayObject;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.world = program(gl, WORLD_VERTEX, WORLD_FRAGMENT);
    this.sky = program(gl, SKY_VERTEX, SKY_FRAGMENT);
    this.skyVao = gl.createVertexArray();
  }

  /** A buffer for geometry, filled now (static) or every frame (`update`). */
  createDrawable(bytes?: Uint8Array): Drawable {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.BYTE, true, VERTEX_BYTES, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, VERTEX_BYTES, 24);
    gl.bindVertexArray(null);
    const drawable = { vao, buffer, count: 0 };
    if (bytes !== undefined) {
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      drawable.count = bytes.byteLength / VERTEX_BYTES;
    }
    return drawable;
  }

  /** Refill a per-frame buffer. */
  update(drawable: Drawable, bytes: Uint8Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    drawable.count = bytes.byteLength / VERTEX_BYTES;
  }

  /** Clear to the sky, and set everything a world draw shares this frame. */
  begin(width: number, height: number, frame: FrameUniforms): void {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const { view, atmosphere } = frame;
    gl.useProgram(this.sky);
    this.set3(this.sky, "u_top", rgb(atmosphere.skyTop));
    this.set3(this.sky, "u_bottom", rgb(atmosphere.skyHorizon));
    this.set3(this.sky, "u_haze", rgb(atmosphere.haze));
    gl.uniform1f(this.at(this.sky, "u_height"), view.height);
    gl.uniform1f(this.at(this.sky, "u_horizon"), view.layout.horizonY + frame.shake.y);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.world);
    gl.uniform4f(this.at(this.world, "u_view"), view.width, view.height, view.footX, view.footY);
    gl.uniform4f(this.at(this.world, "u_roll"), view.layout.groundTop, view.layout.rollHeight, view.knee, view.atanRows);
    gl.uniform2f(this.at(this.world, "u_depth"), DEPTH_NEAR, DEPTH_FAR);
    gl.uniform2f(this.at(this.world, "u_shake"), frame.shake.x, frame.shake.y);
    this.set3(this.world, "u_lightDir", lightDirection(atmosphere));
    this.set3(this.world, "u_ambient", rgb(atmosphere.ambient));
    this.set3(this.world, "u_haze", rgb(atmosphere.haze));
    gl.uniform3f(this.at(this.world, "u_shading"), 0.35 + 0.65 * atmosphere.daylight, atmosphere.shadowStrength, atmosphere.daylight);
  }

  /** The opaque pass: depth tested and written. */
  solid(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** The sheer pass: blended over the solid one, depth tested but never written. */
  sheer(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  draw(drawable: Drawable, frame: DrawFrame): void {
    if (drawable.count === 0) {
      return;
    }
    const gl = this.gl;
    gl.uniform2f(this.at(this.world, "u_offset"), frame.offset[0], frame.offset[1]);
    gl.uniform2f(this.at(this.world, "u_rot"), Math.cos(frame.turn), Math.sin(frame.turn));
    gl.bindVertexArray(drawable.vao);
    gl.drawArrays(gl.TRIANGLES, 0, drawable.count);
  }

  private set3(target: WebGLProgram, name: string, value: Rgb): void {
    this.gl.uniform3f(this.at(target, name), value[0], value[1], value[2]);
  }

  private at(target: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${target === this.world ? "w" : "s"}:${name}`;
    if (!this.uniforms.has(key)) {
      this.uniforms.set(key, this.gl.getUniformLocation(target, name));
    }
    return this.uniforms.get(key) ?? null;
  }
}

/**
 * The atmosphere's light as a direction in the local frame.
 *
 * Its `light` is screen-space - +x right, +y *down* - and stays so: the sun
 * turns with the camera, as in the pixel skin, so the planet never needs
 * re-lighting per heading. Screen-up reads as "from above and a little behind
 * the viewer", so faces turned to the camera catch it; the elevation lifts it.
 */
export function lightDirection(atmosphere: Pick<Atmosphere, "light" | "elevation">): Rgb {
  const x = atmosphere.light.x;
  const y = atmosphere.light.y * 0.45;
  const z = 0.3 + atmosphere.elevation;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const made = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) {
      throw new Error("Could not create a shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Low-poly shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
    }
    gl.attachShader(made, shader);
  }
  gl.linkProgram(made);
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) {
    throw new Error(`Low-poly program failed to link: ${gl.getProgramInfoLog(made) ?? ""}`);
  }
  return made;
}
