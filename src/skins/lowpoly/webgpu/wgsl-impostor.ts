/**
 * The impostors in WGSL: `impostor-glsl.ts` ported, line for line; change one,
 * change both. It shares the world's bindings and its projection
 * (`PLACE_WGSL`), so a ball lands where a mesh vertex would.
 *
 * Three things only WebGPU needs: clip depth runs 0..1, the per-draw entry's
 * `mirror.y` says whether this is the volume pass, and the hour's cloud shade
 * rides in the spare `w` of three `Frame` fields (`packFrame`).
 */

import { ROLL_ROWS } from "../../../game/horizon";
import { ALL_FEATURES, type ShaderFeatures } from "../backend";
import { QUAD_REACH, SCREEN_RISE, SCREEN_UP } from "../impostor";
import { CLOUD_DEPTH } from "../impostor-glsl";
import { Kind } from "../mesh";
import { LOWPOLY } from "../palette";
import { TOWARD_VIEWER } from "../placement";
import { PLACE_WGSL, swayWgsl, WORLD_BINDINGS } from "./wgsl-world";

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);
const vec3 = (v: readonly number[]): string => `vec3f(${v.map(f).join(", ")})`;

/** The impostors, with or without the sway (`ShaderFeatures`), as the world is. */
export function impostorWgsl(features: ShaderFeatures): string {
  return IMPOSTOR_SOURCE.replace("/*SWAY*/", () => swayWgsl(features));
}

const IMPOSTOR_SOURCE = `${WORLD_BINDINGS}
${PLACE_WGSL}
/*SWAY*/
const REACH = ${f(QUAD_REACH)};
const RISE = ${f(SCREEN_RISE)};
const SCREEN_RIGHT = vec3f(1.0, 0.0, 0.0);
const SCREEN_UP = ${vec3(SCREEN_UP)};
const TOWARD_VIEWER = ${vec3(TOWARD_VIEWER)};
const EMBER = ${vec3(LOWPOLY.ember)};
const CLOUD_DEPTH = ${f(CLOUD_DEPTH)};

struct BallIn {
  @location(0) centre: vec3f,
  @location(1) foot: vec2f,
  @location(2) radius: f32,
  @location(3) colour: vec4f,
  @location(4) info: vec4u,   // kind, seed, age, corner
  @builtin(instance_index) draw: u32,
};

struct BallOut {
  @builtin(position) clip: vec4f,
  @location(0) colour: vec4f,
  @location(1) corner: vec2f,
  @location(2) rows: f32,
  @location(3) depth: f32,
  @location(4) reach: f32,
  @location(5) cut: f32,
  @location(6) seed: f32,
  @location(7) age: f32,
  @location(8) @interpolate(flat) kind: u32,
  @location(9) @interpolate(flat) mirror: f32,
  @location(10) @interpolate(flat) volume: f32,
};

@vertex
fn ballVertex(input: BallIn) -> BallOut {
  let draw = draws[input.draw];
  let rot = draw.place.zw;
  let mirror = draw.mirror.x;
  let kind = input.info.x;
  let c = vec2f(f32(input.info.w & 1u), f32((input.info.w >> 1u) & 1u)) * 2.0 - 1.0;
  var result: BallOut;
  result.corner = c * REACH;
  result.colour = input.colour;
  result.seed = f32(input.info.y) / 255.0;
  result.age = f32(input.info.z) / 255.0;
  result.kind = kind;
  result.mirror = mirror;
  result.volume = draw.mirror.y;
  if (kind == ${Kind.cloud}u) {
    let at = input.centre.xy + vec2f(c.x, -c.y) * input.foot * REACH + frame.depthShake.zw;
    result.cut = (input.centre.z - input.centre.y) / max(input.foot.y, 0.001);
    result.rows = 0.0;
    result.depth = frame.depthShake.y;
    result.reach = 0.0;
    result.clip = vec4f(at.x / frame.view.x * 2.0 - 1.0, 1.0 - at.y / frame.view.y * 2.0, CLOUD_DEPTH, 1.0);
    return result;
  }
  let foot = turned(input.foot + draw.place.xy, rot);
  let sway = swayOffset(kind, input.foot + draw.place.xy, input.centre.z, rot);
  let off = turned(input.centre.xy - input.foot, rot) + sway.xy;
  let height = input.centre.z + sway.z;
  let placed = place(foot, off, height * mirror);
  let radii = vec2f(TILE_WIDTH, RISE) * input.radius * placed.z;
  let at = placed.xy + vec2f(c.x, -c.y) * radii * REACH;
  result.rows = placed.w;
  result.depth = foot.y + off.y * placed.z;
  result.reach = input.radius * placed.z;
  result.cut = 9.0;
  result.clip = vec4f(at.x / frame.view.x * 2.0 - 1.0, 1.0 - at.y / frame.view.y * 2.0, clipDepth(result.depth), 1.0);
  return result;
}

fn hash3(p: vec3f) -> f32 {
  let q = vec3u(vec3i(p) + 32768);
  var n = (q.x * 1597334673u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
  n = (n ^ (n >> 15u)) * 2246822519u;
  n ^= n >> 13u;
  return f32(n) / 4294967295.0;
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let fr = fract(p);
  let u = fr * fr * (3.0 - 2.0 * fr);
  let a = mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let b = mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let c = mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let d = mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

fn fbm(p: vec3f) -> f32 {
  return 0.57 * noise3(p) + 0.29 * noise3(p * 2.03 + 17.1) + 0.14 * noise3(p * 4.01 + 31.7);
}

fn billowOf(kind: u32) -> vec3f {
  if (kind == ${Kind.smoke}u) { return vec3f(0.24, 1.7, 0.55); }
  if (kind == ${Kind.cloud}u) { return vec3f(0.14, 1.4, 0.07); }
  return vec3f(0.18, 2.4, 0.0);
}

fn hazeAt(rows: f32) -> f32 {
  let far = clamp(rows / ${f(ROLL_ROWS)}, 0.0, 1.0);
  return select(far * far * (3.0 - 2.0 * far) * 0.78, 0.82, rows > ${f(ROLL_ROWS)});
}

fn heatOf(age: f32, up: f32) -> f32 {
  return (1.0 - smoothstep(0.0, 0.16, age)) * clamp(0.55 - up, 0.0, 1.0);
}

fn cloudShade() -> vec3f {
  return vec3f(frame.lightDir.w, frame.ambient.w, frame.haze.w);
}

/** A ball's surface at \`q\`, and into \`lift\` the depth of its front in radii; alpha < 0 is outside it. */
fn ball(input: BallOut, q: vec2f, seed: f32, t: f32, lift: ptr<function, f32>) -> vec4f {
  let b = billowOf(input.kind);
  let dir = q / max(length(q), 1e-4);
  let lump = fbm(vec3f(dir * b.y + seed, t * b.y * b.z + seed * 0.37));
  // An old puff of smoke wastes away: it shrinks, and its lumps part from each other as it goes.
  let waste = select(0.0, smoothstep(0.5, 1.0, input.age), input.kind == ${Kind.smoke}u);
  let edge = (1.0 + b.x * (lump * 2.0 - 1.0)) * (1.0 - waste * (1.15 - lump));
  if (dot(q, q) > edge * edge) {
    return vec4f(0.0, 0.0, 0.0, -1.0);
  }
  let p = q / edge;
  let s = vec3f(p, sqrt(max(1.0 - dot(p, p), 0.0)));
  *lift = s.y * SCREEN_UP.y + s.z * TOWARD_VIEWER.y;
  let grain = fbm(vec3f(q * b.y * 1.7 + seed * 3.1, t * b.z));
  let bent = normalize(s + vec3f(p * (grain - 0.5) * 0.9, 0.0));
  var n = bent.x * SCREEN_RIGHT + bent.y * SCREEN_UP + bent.z * TOWARD_VIEWER;
  if (input.mirror < 0.0) {
    n.z = -n.z;
  }
  let light = dot(n, frame.lightDir.xyz);
  if (input.kind == ${Kind.cloud}u) {
    return vec4f(mix(cloudShade(), input.colour.rgb, smoothstep(-0.5, 0.6, light + (grain - 0.5) * 0.5)), 1.0);
  }
  let crease = 0.8 + 0.4 * grain;
  let sky = 0.5 + 0.5 * n.z;
  if (input.kind == ${Kind.smoke}u) {
    let lit = input.colour.rgb * crease * (0.52 + 0.2 * sky + 0.38 * (light * 0.5 + 0.5) * frame.shading.x) * frame.ambient.rgb;
    return vec4f(lit + EMBER * heatOf(input.age, s.y) * 0.9, 1.0);
  }
  return vec4f(input.colour.rgb * crease * (0.4 + 0.24 * sky + 0.58 * max(light, 0.0) * frame.shading.x) * frame.ambient.rgb, 1.0);
}

fn density(input: BallOut, p: vec3f, seed: f32, t: f32, b: vec3f) -> f32 {
  if (input.kind == ${Kind.cloud}u && p.y < -input.cut) {
    return 0.0;
  }
  let body = 1.0 - length(p);
  let n = fbm(p * b.y * 1.2 + vec3f(seed, seed * 0.7 - t * b.z, t * b.z * 0.6));
  return clamp(body * 2.2 + (n - 0.5) * 2.0 - 0.15, 0.0, 1.0);
}

/** A puff marched as a volume, premultiplied; alpha 0 is nothing there. */
fn volume(input: BallOut, q: vec2f, seed: f32, t: f32) -> vec4f {
  let r2 = dot(q, q);
  if (r2 >= REACH * REACH) {
    return vec4f(0.0);
  }
  let b = billowOf(input.kind);
  let span = sqrt(REACH * REACH - r2);
  let light = frame.lightDir.xyz;
  let sun = vec3f(light.x, dot(light, SCREEN_UP), dot(light, TOWARD_VIEWER));
  let cloud = input.kind == ${Kind.cloud}u;
  let fade = select(1.0 - smoothstep(0.5, 1.0, input.age), 1.0, cloud);
  let thick = select(4.0, 3.0, cloud) * input.colour.a * fade;
  let bright = select(input.colour.rgb * (0.6 + 0.5 * frame.shading.x) * frame.ambient.rgb, input.colour.rgb, cloud);
  let dark = select(input.colour.rgb * 0.42 * frame.ambient.rgb, cloudShade(), cloud);
  let steps = 12;
  let dt = 2.0 * span / f32(steps);
  var through = 1.0;
  var sum = vec3f(0.0);
  for (var i = 0; i < steps; i++) {
    let p = vec3f(q, span - (f32(i) + 0.5) * dt);
    let d = density(input, p, seed, t, b) * thick;
    if (d <= 0.001) {
      continue;
    }
    let shade = density(input, p + sun * 0.3, seed, t, b) + density(input, p + sun * 0.65, seed, t, b);
    var c = mix(dark, bright, exp(-shade * thick * 0.45));
    if (!cloud) {
      c += EMBER * heatOf(input.age, p.y) * 1.2;
    }
    let a = 1.0 - exp(-d * dt);
    sum += through * a * c;
    through *= 1.0 - a;
    if (through < 0.03) {
      break;
    }
  }
  return vec4f(sum, 1.0 - through);
}

struct BallFragment {
  @location(0) colour: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn ballFragment(input: BallOut) -> BallFragment {
  if (input.mirror < 0.0 && input.rows > ${f(ROLL_ROWS)}) {
    discard;
  }
  let q = input.corner;
  if (input.kind == ${Kind.cloud}u && q.y < -input.cut) {
    discard;
  }
  let seed = input.seed * 61.0;
  let t = frame.water.w;
  let soft = input.volume > 0.5 && input.kind != ${Kind.foliage}u;
  var colour: vec4f;
  var lift = 0.0;
  if (soft) {
    colour = volume(input, q, seed, t);
    if (colour.a < 0.004) {
      discard;
    }
    lift = q.y * SCREEN_UP.y + sqrt(max(REACH * REACH - dot(q, q), 0.0)) * TOWARD_VIEWER.y;
  } else {
    colour = ball(input, q, seed, t, &lift);
    if (colour.a < 0.0) {
      discard;
    }
  }
  if (input.kind != ${Kind.cloud}u) {
    // Smoke stands high above the far field's haze: it takes only some of it.
    let haze = hazeAt(input.rows) * select(1.0, 0.55, input.kind == ${Kind.smoke}u);
    colour = vec4f(mix(colour.rgb, frame.haze.rgb * colour.a, haze), colour.a);
  }
  var result: BallFragment;
  result.colour = colour;
  result.depth = select(clipDepth(input.depth + input.reach * lift), CLOUD_DEPTH, input.kind == ${Kind.cloud}u);
  return result;
}
`;

/** The impostors with everything in them. */
export const IMPOSTOR_WGSL = impostorWgsl(ALL_FEATURES);
