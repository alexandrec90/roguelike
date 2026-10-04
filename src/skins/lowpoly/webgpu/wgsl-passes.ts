/**
 * The two full-screen passes in WGSL: the sky behind the world and the rain over
 * it - `shaders.ts`' sky and `rain-pass.ts`' streaks, ported. They share one
 * small uniform block, `Passes`, written once a frame (`packPasses`).
 */

import type { FrameUniforms, RainState } from "../backend";
import { rgb } from "../mesh";

/** Floats in `Passes`: six `vec4f`. */
export const PASSES_FLOATS = 24;

const PASSES = `
struct Passes {
  skyTop: vec4f,
  skyBottom: vec4f,
  haze: vec4f,
  sky: vec4f,      // logical height, horizon line
  size: vec4f,     // logical width, height
  rain: vec4f,     // strength, seconds, slant, light
};

@group(0) @binding(0) var<uniform> passes: Passes;

struct Screen {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn screenVertex(@builtin(vertex_index) index: u32) -> Screen {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var screen: Screen;
  screen.uv = vec2f(corner.x, 1.0 - corner.y);
  screen.clip = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  return screen;
}
`;

/** Top to the horizon line, the sky's gradient; below it, the haze the ground fades into. */
export const SKY_WGSL = `${PASSES}
@fragment
fn skyFragment(screen: Screen) -> @location(0) vec4f {
  let y = screen.uv.y * passes.sky.x;
  let t = clamp(y / max(passes.sky.y, 1.0), 0.0, 1.0);
  let sky = mix(passes.skyTop.rgb, passes.skyBottom.rgb, t * t);
  return vec4f(select(sky, passes.haze.rgb, y > passes.sky.y), 1.0);
}
`;

/** Streaks on a lattice of screen cells, sheared by the wind, three layers deep. */
export const RAIN_WGSL = `${PASSES}
fn hash(cell: vec2f, salt: f32) -> f32 {
  let q = vec2u(vec2i(cell) + 4096) * vec2u(1597334673u, 3812015801u) + vec2u(u32(salt * 131.0));
  var n = (q.x ^ q.y) * 1597334673u;
  n ^= n >> 15u;
  n *= 2246822519u;
  n ^= n >> 13u;
  return f32(n) / 4294967295.0;
}

@fragment
fn rainFragment(screen: Screen) -> @location(0) vec4f {
  let p = screen.uv * passes.size.xy;
  var alpha = 0.0;
  for (var layer = 0; layer < 3; layer++) {
    let l = f32(layer);
    let cell = vec2f(5.0 + l * 2.0, 22.0 + l * 10.0);
    let speed = 150.0 + l * 70.0;
    let q = vec2f(p.x - p.y * passes.rain.z, p.y - passes.rain.y * speed + l * 37.0);
    let index = floor(q / cell);
    let inside = fract(q / cell);
    if (hash(index, l) > passes.rain.x * 0.75) {
      continue;
    }
    let column = 0.2 + 0.6 * hash(index, l + 9.0);
    let thin = 1.0 - smoothstep(0.0, 0.5 / cell.x, abs(inside.x - column));
    let span = 0.35 + 0.3 * hash(index, l + 17.0);
    let streak = smoothstep(0.0, 0.08, inside.y) * (1.0 - smoothstep(span - 0.08, span, inside.y));
    alpha = max(alpha, thin * streak * (0.16 + 0.08 * l));
  }
  return vec4f(vec3f(0.78, 0.84, 0.95) * passes.rain.w, alpha);
}
`;

/** `Passes`, in field order. */
export function packPasses(frame: FrameUniforms, rain: RainState, out: Float32Array = new Float32Array(PASSES_FLOATS)): Float32Array {
  const { atmosphere, view } = frame;
  const top = rgb(atmosphere.skyTop);
  const bottom = rgb(atmosphere.skyHorizon);
  const haze = rgb(atmosphere.haze);
  out.set([top[0], top[1], top[2], 0], 0);
  out.set([bottom[0], bottom[1], bottom[2], 0], 4);
  out.set([haze[0], haze[1], haze[2], 0], 8);
  out.set([view.height, view.layout.horizonY + frame.shake.y, 0, 0], 12);
  out.set([view.width, view.height, 0, 0], 16);
  out.set([rain.strength, rain.seconds, rain.slant, rain.light], 20);
  return out;
}
