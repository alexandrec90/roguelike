/**
 * The WebGL2 renderer for volume bodies.
 *
 * One context, one program, one quad, reused for every body: the per-body cost
 * is a handful of `uniform*` calls and a two-triangle draw. Nothing here is
 * clever — the interesting part is all in the shader — but three details are
 * load-bearing:
 *
 * - **One offscreen canvas for the whole game.** A WebGL context is an expensive,
 *   limited resource (browsers cap them around sixteen and silently drop the
 *   oldest), so a context per body is not a performance idea, it is a crash.
 * - **The viewport is sized to the body's box in *logical* pixels**, so one
 *   fragment is one art pixel and the pixel contract survives the trip through
 *   the GPU. No scaling happens here; the integer upscale is still the display's
 *   job.
 * - **`readPixels` is the slow path and is only for the lab.** Reading back
 *   stalls the pipeline waiting for the GPU to finish, and that is not a small
 *   tax — it is most of the win.
 *
 * Measured on the chestnut canopy, 300 renders, one desktop GPU:
 *
 * | path                                   | ms per render |
 * | -------------------------------------- | ------------- |
 * | `volumeCloud` on the CPU               | 4.104         |
 * | `drawVolume`, submit only              | 0.028         |
 * | `drawVolume` + `gl.finish()`           | **0.055**     |
 * | `drawVolume` + `readVolume`            | 1.162         |
 *
 * So the shader itself is about **75x** the CPU path, and reading the answer
 * back costs twenty times what computing it did. That single row is the
 * architecture: the canvas is bound as a texture and drawn from, never read.
 * `readVolume` exists for the parity view and for baking, and both are
 * offline.
 *
 * Everything is guarded rather than assumed: a machine without WebGL2, or one
 * that loses the context, gets `null` and the caller falls back to the CPU path
 * that has always worked.
 */

import type { Box, VolumeLight, VolumeSpec } from "../procgen/volume";
import { volumeBox } from "../procgen/volume";
import {
  burnUniforms,
  HEAT_TEXTURE_UNIT,
  shadowBox,
  volumeUniforms,
  type VolumeShadow,
  type VolumeUniforms,
} from "./volume-uniforms";
import type { HeatGrid } from "../burnable";
import { VOLUME_FRAGMENT_SHADER, VOLUME_VERTEX_SHADER } from "./volume-shader";

export interface VolumeGl {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly locations: Map<string, WebGLUniformLocation | null>;
  /** One texture, reused: a burning body re-uploads it, nothing else binds it. */
  readonly heatTexture: WebGLTexture | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Surfaced rather than swallowed: a shader that fails to compile otherwise
    // shows up as an empty canvas, which reads as "the body has no pixels".
    console.error("volume shader failed to compile:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Build the renderer, or return null on any machine that cannot run it. */
export function createVolumeGl(): VolumeGl | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (gl === null) {
    return null;
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, VOLUME_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, VOLUME_FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (vertex === null || fragment === null || program === null) {
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("volume program failed to link:", gl.getProgramInfoLog(program));
    return null;
  }

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Two triangles covering clip space. The vertex stage does nothing else.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "a_clip");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

  // NEAREST and clamped, because a texel is a *cell* rather than a sample of
  // something continuous: filtering it would blur the fire across cell borders
  // and stop the GPU agreeing with the CPU's map lookup.
  const heatTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + HEAT_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, heatTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { canvas, gl, program, locations: new Map(), heatTexture };
}

function locate(renderer: VolumeGl, name: string): WebGLUniformLocation | null {
  const cached = renderer.locations.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const location = renderer.gl.getUniformLocation(renderer.program, name);
  renderer.locations.set(name, location);
  return location;
}

/** Push one body's uniforms. Names come from the packer, so they cannot drift. */
function applyUniforms(renderer: VolumeGl, uniforms: VolumeUniforms): void {
  const { gl } = renderer;
  const set = <T>(name: string, apply: (location: WebGLUniformLocation) => T): void => {
    const location = locate(renderer, name);
    if (location !== null) {
      apply(location);
    }
  };

  set("u_boxOrigin", (l) => gl.uniform2f(l, uniforms.u_boxOrigin[0], uniforms.u_boxOrigin[1]));
  set("u_viewport", (l) => gl.uniform2f(l, uniforms.u_viewport[0], uniforms.u_viewport[1]));
  set("u_clipRect", (l) =>
    gl.uniform4f(
      l,
      uniforms.u_clipRect[0],
      uniforms.u_clipRect[1],
      uniforms.u_clipRect[2],
      uniforms.u_clipRect[3],
    ),
  );
  set("u_lobes", (l) => gl.uniform3fv(l, uniforms.u_lobes));
  set("u_lobeEnds", (l) => gl.uniform3fv(l, uniforms.u_lobeEnds));
  set("u_lobeCount", (l) => gl.uniform1i(l, uniforms.u_lobeCount));
  set("u_weld", (l) => gl.uniform1f(l, uniforms.u_weld));
  set("u_warpOn", (l) => gl.uniform1i(l, uniforms.u_warpOn));
  set("u_warpAmplitude", (l) =>
    gl.uniform2f(l, uniforms.u_warpAmplitude[0], uniforms.u_warpAmplitude[1]),
  );
  set("u_warpScale", (l) => gl.uniform1f(l, uniforms.u_warpScale));
  set("u_warpDrift", (l) => gl.uniform1f(l, uniforms.u_warpDrift));
  set("u_warpSeed", (l) => gl.uniform1i(l, uniforms.u_warpSeed));
  set("u_warpOctaves", (l) => gl.uniform1i(l, uniforms.u_warpOctaves));
  set("u_ramp", (l) => gl.uniform3fv(l, uniforms.u_ramp));
  set("u_rampSteps", (l) => gl.uniform1i(l, uniforms.u_rampSteps));
  set("u_light", (l) => gl.uniform2f(l, uniforms.u_light[0], uniforms.u_light[1]));
  set("u_ambient", (l) => gl.uniform1f(l, uniforms.u_ambient));
  set("u_occlusion", (l) => gl.uniform1f(l, uniforms.u_occlusion));
  set("u_normalEpsilon", (l) => gl.uniform1f(l, uniforms.u_normalEpsilon));
  set("u_flat", (l) => gl.uniform1i(l, uniforms.u_flat));
  set("u_dither", (l) => gl.uniform1i(l, uniforms.u_dither));
  set("u_shadowOn", (l) => gl.uniform1i(l, uniforms.u_shadowOn));
  set("u_shadowSpread", (l) => gl.uniform1f(l, uniforms.u_shadowSpread));
  set("u_shadowSlope", (l) => gl.uniform1f(l, uniforms.u_shadowSlope));
  set("u_shadowSquash", (l) => gl.uniform1f(l, uniforms.u_shadowSquash));
  set("u_shadowSoftness", (l) => gl.uniform1f(l, uniforms.u_shadowSoftness));
  set("u_shadowSeed", (l) => gl.uniform1i(l, uniforms.u_shadowSeed));
  set("u_heatOn", (l) => gl.uniform1i(l, uniforms.u_heatOn));
  set("u_heat", (l) => gl.uniform1i(l, uniforms.u_heat));
  set("u_heatOrigin", (l) => gl.uniform2f(l, uniforms.u_heatOrigin[0], uniforms.u_heatOrigin[1]));
  set("u_heatSize", (l) => gl.uniform2f(l, uniforms.u_heatSize[0], uniforms.u_heatSize[1]));
  set("u_heatCell", (l) => gl.uniform1f(l, uniforms.u_heatCell));
  set("u_emberRamp", (l) => gl.uniform3fv(l, uniforms.u_emberRamp));
  set("u_emberSteps", (l) => gl.uniform1i(l, uniforms.u_emberSteps));
  set("u_charColor", (l) =>
    gl.uniform3f(l, uniforms.u_charColor[0], uniforms.u_charColor[1], uniforms.u_charColor[2]),
  );
  set("u_heatFlicker", (l) => gl.uniform1i(l, uniforms.u_heatFlicker));
}

export interface VolumeDraw {
  readonly box: Box;
  readonly width: number;
  readonly height: number;
}

/**
 * Render one body into the renderer's canvas and say where it landed.
 *
 * The canvas is resized to the body's box, so the caller composites it at
 * `box.left, box.top`. No readback here: a caller that only wants it on screen
 * can use the canvas directly as a texture or a `drawImage` source.
 */
export interface VolumeBurn {
  readonly grid: HeatGrid;
  readonly elapsedMs: number;
  readonly seed: number;
}

export function drawVolume(
  renderer: VolumeGl,
  spec: VolumeSpec,
  light: VolumeLight,
  clip?: Partial<Box>,
  burn?: VolumeBurn,
): VolumeDraw {
  return render(renderer, spec, light, { ...volumeBox(spec), ...clip }, undefined, burn);
}

/** Upload the fire's current state. A few hundred texels; cheaper than diffing. */
function uploadHeat(renderer: VolumeGl, grid: HeatGrid): void {
  const { gl } = renderer;
  gl.activeTexture(gl.TEXTURE0 + HEAT_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, renderer.heatTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    grid.width,
    grid.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    grid.data,
  );
}

/**
 * Render the body's shadow onto the ground, as its own pass over the same field.
 *
 * A different rectangle and a different question — "which body pixel would have
 * darkened this patch of ground" — but the same lobes, so the shadow cannot
 * drift from the thing casting it. The result is `void` pixels, which punch a
 * hole in whatever lit ground is composited underneath.
 */
export function drawVolumeShadow(
  renderer: VolumeGl,
  spec: VolumeSpec,
  light: VolumeLight,
  shadow: VolumeShadow,
): VolumeDraw {
  return render(renderer, spec, light, shadowBox(spec, shadow), shadow);
}

function render(
  renderer: VolumeGl,
  spec: VolumeSpec,
  light: VolumeLight,
  box: Box,
  shadow?: VolumeShadow,
  burn?: VolumeBurn,
): VolumeDraw {
  const width = Math.max(1, box.right - box.left + 1);
  const height = Math.max(1, box.bottom - box.top + 1);

  const { gl, canvas } = renderer;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  gl.useProgram(renderer.program);
  if (burn !== undefined) {
    uploadHeat(renderer, burn.grid);
  }
  applyUniforms(
    renderer,
    volumeUniforms(
      spec,
      light,
      box,
      shadow,
      burn === undefined ? undefined : burnUniforms(burn.grid, burn.elapsedMs, burn.seed),
    ),
  );
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  return { box, width, height };
}

/**
 * Read the last draw back into CPU memory. **The lab's path, not the game's.**
 *
 * `readPixels` blocks until the GPU has finished, which throws away most of the
 * reason to be on the GPU at all. It is here so the parity view can compare
 * against the CPU reference pixel for pixel, and for baking.
 *
 * WebGL's origin is bottom-left and a pixel cloud's is top-left, so the rows
 * come back flipped and are turned over here rather than in the shader — the
 * shader's coordinates have to stay identical to the CPU's for the port to mean
 * anything.
 */
export function readVolume(renderer: VolumeGl, draw: VolumeDraw): Uint8ClampedArray {
  const { gl } = renderer;
  const raw = new Uint8Array(draw.width * draw.height * 4);
  gl.readPixels(0, 0, draw.width, draw.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);

  const flipped = new Uint8ClampedArray(raw.length);
  const stride = draw.width * 4;
  for (let row = 0; row < draw.height; row += 1) {
    const from = (draw.height - 1 - row) * stride;
    flipped.set(raw.subarray(from, from + stride), row * stride);
  }
  return flipped;
}
