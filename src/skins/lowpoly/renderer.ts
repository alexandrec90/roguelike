/**
 * The WebGL2 half of the skin: the only files here that touch the context are
 * this one and the passes it owns (`reflection.ts`, `rain-pass.ts`).
 *
 * A frame is four passes. The world **mirrored** - what stands, height flipped -
 * into a half-size target. Then the sky; the **solid** pass, where the ground
 * reads its puddles and the mirror; the **sheer** pass of shadows, lakes and
 * spell light, blended without writing depth; and the **rain** over all of it.
 * Each chunk of the planet is two static buffers uploaded once
 * (`world-chunks.ts`); the hero and the actors are re-uploaded each frame.
 *
 * Budget: the static geometry twice (once mirrored, at a quarter of the pixels),
 * ~280 draw calls; water costs per pixel only where there is water. The CPU's
 * share is the actor meshes and a few dozen uniforms.
 */

import type { Atmosphere } from "../../game/atmosphere";
import { FIELD_SIZE } from "../../game/water/puddle-field";
import { program, Uniforms } from "./gl-util";
import { mixRgb, rgb, VERTEX_BYTES, type Rgb } from "./mesh";
import { DEPTH_FAR, DEPTH_NEAR, type LowpolyView } from "./placement";
import { ReflectionTarget } from "./reflection";
import { SKY_FRAGMENT, SKY_VERTEX, WORLD_FRAGMENT, WORLD_VERTEX } from "./shaders";

export interface Drawable {
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

/** The water's state this frame, as the shader reads it. */
export interface WaterState {
  /** The hero's planet point: what a water pixel's planet point is measured from. */
  readonly hero: readonly [number, number];
  /** `waterLevel(wetness)`. */
  readonly level: number;
  readonly wetness: number;
  readonly rain: number;
  /** The shader's clock, seconds. */
  readonly seconds: number;
  /** `RippleRing.slots`. */
  readonly ripples: Float32Array;
}

export interface FrameUniforms {
  readonly view: LowpolyView;
  readonly atmosphere: Atmosphere;
  readonly shake: { readonly x: number; readonly y: number };
  readonly water: WaterState;
  /** The drawing buffer, device pixels. */
  readonly width: number;
  readonly height: number;
}

/** Texture units: the puddle field and the mirror. */
const PUDDLE_UNIT = 1;
const REFLECT_UNIT = 2;

export class LowpolyRenderer {
  private readonly world: Uniforms;
  private readonly sky: Uniforms;
  private readonly skyVao: WebGLVertexArrayObject;
  private readonly puddles: WebGLTexture;
  private readonly reflection: ReflectionTarget;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    puddleField: Uint8Array,
  ) {
    this.world = new Uniforms(gl, program(gl, WORLD_VERTEX, WORLD_FRAGMENT));
    this.sky = new Uniforms(gl, program(gl, SKY_VERTEX, SKY_FRAGMENT));
    this.skyVao = gl.createVertexArray();
    this.puddles = puddleTexture(gl, puddleField);
    this.reflection = new ReflectionTarget(gl);
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

  /**
   * Start the frame: every world uniform it shares, then the mirror pass, into
   * which the caller draws what stands (`solid` is already set up).
   */
  beginReflection(frame: FrameUniforms): void {
    const gl = this.gl;
    gl.useProgram(this.world.target);
    this.setWorld(frame);
    this.reflection.bind(frame.width, frame.height, stillSky(frame.atmosphere));
    gl.uniform1f(this.world.at("u_mirror"), -1);
    this.solid();
  }

  /** Back to the screen: the sky, then ready for the solid pass. */
  beginScreen(frame: FrameUniforms): void {
    const gl = this.gl;
    this.reflection.unbind();
    gl.viewport(0, 0, frame.width, frame.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.drawSky(frame);
    gl.useProgram(this.world.target);
    gl.uniform1f(this.world.at("u_mirror"), 1);
    gl.activeTexture(gl.TEXTURE0 + REFLECT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.reflection.texture);
    this.solid();
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
    gl.uniform2f(this.world.at("u_offset"), frame.offset[0], frame.offset[1]);
    gl.uniform2f(this.world.at("u_rot"), Math.cos(frame.turn), Math.sin(frame.turn));
    gl.bindVertexArray(drawable.vao);
    gl.drawArrays(gl.TRIANGLES, 0, drawable.count);
  }

  private drawSky(frame: FrameUniforms): void {
    const gl = this.gl;
    const { view, atmosphere } = frame;
    gl.useProgram(this.sky.target);
    gl.uniform3fv(this.sky.at("u_top"), rgb(atmosphere.skyTop));
    gl.uniform3fv(this.sky.at("u_bottom"), rgb(atmosphere.skyHorizon));
    gl.uniform3fv(this.sky.at("u_haze"), rgb(atmosphere.haze));
    gl.uniform1f(this.sky.at("u_height"), view.height);
    gl.uniform1f(this.sky.at("u_horizon"), view.layout.horizonY + frame.shake.y);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private setWorld(frame: FrameUniforms): void {
    const gl = this.gl;
    const { view, atmosphere, water } = frame;
    const at = (name: string): WebGLUniformLocation | null => this.world.at(name);
    gl.uniform4f(at("u_view"), view.width, view.height, view.footX, view.footY);
    gl.uniform4f(at("u_roll"), view.layout.groundTop, view.layout.rollHeight, view.knee, view.atanRows);
    gl.uniform2f(at("u_depth"), DEPTH_NEAR, DEPTH_FAR);
    gl.uniform2f(at("u_shake"), frame.shake.x, frame.shake.y);
    gl.uniform3fv(at("u_lightDir"), lightDirection(atmosphere));
    gl.uniform3fv(at("u_ambient"), rgb(atmosphere.ambient));
    gl.uniform3fv(at("u_haze"), rgb(atmosphere.haze));
    gl.uniform3f(at("u_shading"), 0.35 + 0.65 * atmosphere.daylight, atmosphere.shadowStrength, atmosphere.daylight);
    gl.uniform2f(at("u_hero"), water.hero[0], water.hero[1]);
    gl.uniform2f(at("u_resolution"), frame.width, frame.height);
    gl.uniform4f(at("u_water"), water.level, water.wetness, water.rain, water.seconds);
    gl.uniform4fv(at("u_ripples[0]"), water.ripples);
    gl.uniform1i(at("u_puddles"), PUDDLE_UNIT);
    gl.uniform1i(at("u_reflect"), REFLECT_UNIT);
    gl.activeTexture(gl.TEXTURE0 + PUDDLE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.puddles);
    // Nothing reads the mirror while it is being drawn into.
    gl.activeTexture(gl.TEXTURE0 + REFLECT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

/**
 * What still water shows with nothing standing over it. The projection is
 * parallel, so every pixel of a mirror looks up the same way: steeply, at the
 * upper sky, a little toward the horizon's colour.
 */
export function stillSky(atmosphere: Pick<Atmosphere, "skyTop" | "skyHorizon">): Rgb {
  return mixRgb(rgb(atmosphere.skyTop), rgb(atmosphere.skyHorizon), 0.35);
}

/** The puddle field as a one-channel texture, read bilinearly and wrapping - as `sampleField` reads it. */
function puddleTexture(gl: WebGL2RenderingContext, field: Uint8Array): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + PUDDLE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, FIELD_SIZE, FIELD_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, field);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return texture;
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
