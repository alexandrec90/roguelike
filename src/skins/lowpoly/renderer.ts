/**
 * The WebGL2 backend: the fallback wherever WebGPU is missing (`backend.ts`).
 * The only files here that touch a WebGL context are this one and the passes
 * it owns (`reflection.ts`, `rain-pass.ts`).
 *
 * A frame is four passes. The world **mirrored** - what stands, height flipped -
 * into a half-size target. Then the sky; the **solid** pass, where the ground
 * reads its puddles, its lakes and the mirror; the **sheer** pass of shadows and
 * spell light, blended without writing depth; and the **rain** over all of it.
 * The trip (`trip.ts`) may add two: its overhead world after the sky, and its
 * trails over the finished frame (`trail-pass.ts`).
 * Its water moves by procedural rings (`water-glsl.ts`); WebGPU's simulates.
 *
 * Budget: the static geometry twice (once mirrored, at a quarter of the pixels),
 * ~280 draw calls; water costs per pixel only where there is water.
 */

import { FIELD_SIZE } from "../../game/water/puddle-field";
import type { DrawableHandle, DrawCall, FrameScene, FrameUniforms, LowpolyBackend } from "./backend";
import { program, Uniforms } from "./gl-util";
import { rgb, VERTEX_BYTES } from "./mesh";
import { DEPTH_FAR, DEPTH_NEAR } from "./placement";
import { RainPass } from "./rain-pass";
import { ReflectionTarget } from "./reflection";
import { SKY_FRAGMENT, SKY_VERTEX, WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID, WORLD_VERTEX } from "./shaders";
import { lightDirection, stillSky } from "./sky-light";
import { TrailPass } from "./trail-pass";
import { trailFrame, tripMirrorSky } from "./trip";
import { waterTexels } from "./water-texels";

interface Drawable extends DrawableHandle {
  readonly vao: WebGLVertexArrayObject;
  readonly buffer: WebGLBuffer;
}

/** Texture units: the puddle field (with the lakes) and the mirror. */
const PUDDLE_UNIT = 1;
const REFLECT_UNIT = 2;

export class WebGlBackend implements LowpolyBackend {
  readonly kind = "webgl";
  /** The world, able to discard: the ground, the mirror and the sheer pass. */
  private readonly world: Uniforms;
  /** The world for what stands on screen: no discard, so early depth testing stays on. */
  private readonly solidWorld: Uniforms;
  private readonly sky: Uniforms;
  private readonly skyVao: WebGLVertexArrayObject;
  private readonly puddles: WebGLTexture;
  private readonly reflection: ReflectionTarget;
  private readonly rain: RainPass;
  private readonly trail: TrailPass;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    puddleField: Uint8Array,
  ) {
    this.world = new Uniforms(gl, program(gl, WORLD_VERTEX, WORLD_FRAGMENT));
    this.solidWorld = new Uniforms(gl, program(gl, WORLD_VERTEX, WORLD_FRAGMENT_SOLID));
    this.sky = new Uniforms(gl, program(gl, SKY_VERTEX, SKY_FRAGMENT));
    this.skyVao = gl.createVertexArray();
    this.puddles = puddleTexture(gl, puddleField);
    this.reflection = new ReflectionTarget(gl);
    this.rain = new RainPass(gl);
    this.trail = new TrailPass(gl);
  }

  createDrawable(bytes?: Uint8Array): DrawableHandle {
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
    const drawable: Drawable = { vao, buffer, count: 0 };
    if (bytes !== undefined) {
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      drawable.count = bytes.byteLength / VERTEX_BYTES;
    }
    return drawable;
  }

  update(handle: DrawableHandle, bytes: Uint8Array): void {
    const gl = this.gl;
    const drawable = handle as Drawable;
    gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    drawable.count = bytes.byteLength / VERTEX_BYTES;
  }

  render(frame: FrameUniforms, scene: FrameScene): void {
    const gl = this.gl;
    const clipping = this.world;
    // What stands near enough to be seen in water, mirrored.
    this.setWorld(this.solidWorld, frame, 1);
    this.setWorld(clipping, frame, -1);
    this.reflection.bind(frame.width, frame.height, tripMirrorSky(stillSky(frame.atmosphere), frame.trip));
    this.solid();
    this.drawAll(clipping, scene.mirrored);

    // Then the world itself, over the sky: the ground first, so it hides what stands behind it.
    this.reflection.unbind();
    gl.viewport(0, 0, frame.width, frame.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.drawSky(frame);
    gl.useProgram(clipping.target);
    gl.uniform1f(clipping.at("u_mirror"), 1);
    gl.activeTexture(gl.TEXTURE0 + REFLECT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.reflection.texture);
    this.solid();
    // The trip's sky: the world overhead, in the back of the depth range, before the world itself.
    if (scene.overhead.grounds.length > 0 || scene.overhead.solids.length > 0) {
      this.drawAll(clipping, scene.overhead.grounds, 1);
      gl.useProgram(this.solidWorld.target);
      this.drawAll(this.solidWorld, scene.overhead.solids, 1);
      gl.useProgram(clipping.target);
    }
    this.drawAll(clipping, scene.grounds);
    // The land can discard only on a frame with a window in it: elsewhere it keeps the early depth test.
    const land = frame.cutaway === undefined ? this.solidWorld : clipping;
    gl.useProgram(land.target);
    this.drawAll(land, scene.lands);
    gl.useProgram(this.solidWorld.target);
    this.drawAll(this.solidWorld, scene.solids);
    gl.useProgram(clipping.target);
    this.sheer();
    this.drawAll(clipping, scene.sheers);
    this.rain.draw({ ...scene.rain, width: frame.view.width, height: frame.view.height });
    const trail = trailFrame(frame);
    if (trail !== undefined) {
      this.trail.draw(trail);
    }
  }

  /** The opaque pass: depth tested and written. */
  private solid(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** The sheer pass: blended over the solid one, depth tested but never written. */
  private sheer(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Draw `calls` with the program in use; `flip` 1 draws them overhead, upside down (the trip's sky). */
  private drawAll(world: Uniforms, calls: readonly DrawCall[], flip = 0): void {
    const gl = this.gl;
    gl.uniform1f(world.at("u_flip"), flip);
    for (const call of calls) {
      const drawable = call.drawable as Drawable;
      if (drawable.count === 0) {
        continue;
      }
      gl.uniform2f(world.at("u_offset"), call.offset[0], call.offset[1]);
      gl.uniform2f(world.at("u_rot"), Math.cos(call.turn), Math.sin(call.turn));
      gl.bindVertexArray(drawable.vao);
      gl.drawArrays(gl.TRIANGLES, 0, drawable.count);
    }
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

  /** Use one of the world programs and set everything it shares this frame, `mirror` included. */
  private setWorld(world: Uniforms, frame: FrameUniforms, mirror: number): void {
    const gl = this.gl;
    const { view, atmosphere, water } = frame;
    gl.useProgram(world.target);
    const at = (name: string): WebGLUniformLocation | null => world.at(name);
    gl.uniform1f(at("u_mirror"), mirror);
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
    const cut = frame.cutaway;
    gl.uniform4f(at("u_cut"), cut?.x ?? 0, cut?.y ?? 0, cut?.radiusX ?? 0, cut?.radiusY ?? 1);
    gl.uniform4f(at("u_water"), water.level, water.wetness, water.rain, water.seconds);
    gl.uniform4f(at("u_trip"), frame.trip, water.seconds, frame.fx, 0);
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
 * The puddle field and the lakes as a two-channel texture (`water-texels.ts`),
 * read bilinearly and wrapping - as `sampleField` reads it.
 */
function puddleTexture(gl: WebGL2RenderingContext, field: Uint8Array): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + PUDDLE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, FIELD_SIZE, FIELD_SIZE, 0, gl.RG, gl.UNSIGNED_BYTE, waterTexels(field));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return texture;
}
