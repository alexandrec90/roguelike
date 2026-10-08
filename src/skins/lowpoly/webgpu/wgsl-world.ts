/**
 * The world in WGSL: `shaders.ts` and `water-glsl.ts` ported to WebGPU, with
 * one change - the water's slope comes from the wave simulation's heights
 * (`wave-sim.ts`) instead of from procedural rings.
 *
 * The vertex stage is `placement.ts` again, as the GLSL is; keep all three in
 * step. Two WebGPU differences are handled here and nowhere else: clip-space
 * depth runs 0..1 rather than -1..1, and a fragment's position and a texture's
 * rows both count from the top, so the mirror is read without a flip.
 */

import { HORIZON_SCALE, HORIZON_SINK_RATE, ROLL_ROWS } from "../../../game/horizon";
import { PLANET_TILES } from "../../../game/planet";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../../../game/projection";
import { Kind } from "../mesh";
import { TOWARD_VIEWER } from "../placement";
import { MAX_PUSHES, SWAY_WGSL } from "../sway";
import { LAKE_DEPTH_PER_TILE, WATER_DEEP_ARGS, WATER_LOOK } from "../water-glsl";
import { LAKE_RANGE_TILES } from "../water-texels";
import { WAVE_N, WAVE_RES } from "./waves";

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** Bindings shared by the world and the wave simulation's reading of the water. */
export const WORLD_BINDINGS = `
struct Frame {
  view: vec4f,
  roll: vec4f,
  depthShake: vec4f,
  hero: vec4f,
  lightDir: vec4f,
  ambient: vec4f,
  haze: vec4f,
  shading: vec4f,
  water: vec4f,
  sim: vec4f,
  wind: vec4f,
  cut: vec4f,
  pushes: array<vec4f, ${MAX_PUSHES}>,
};

struct Draw {
  place: vec4f,
  mirror: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> draws: array<Draw>;
@group(0) @binding(2) var waterMask: texture_2d<f32>;
@group(0) @binding(3) var repeatSampler: sampler;
@group(0) @binding(4) var mirrorTexture: texture_2d<f32>;
@group(0) @binding(5) var clampSampler: sampler;
@group(0) @binding(6) var waveSurface: texture_2d<f32>; // height, slope x, slope y (wave-surface.ts)
`;

/**
 * The cut a fragment may make, as in `shaders.ts`: only in the variant that
 * needs it, because a shader that can discard loses the early depth test.
 */
const CLIP_WGSL = `
  let lies = input.kind == ${Kind.ground}u || input.kind == ${Kind.shadow}u || input.kind == ${Kind.water}u;
  if (lies && (input.rows > ROLL_ROWS || input.mirror < 0.0)) {
    discard;
  }
  // Past the horizon the ground hides a body; the mirror draws no ground, so it skips them too.
  if (input.mirror < 0.0 && input.rows > ROLL_ROWS) {
    discard;
  }
  // The window round the hero (\`cutaway.ts\`): land nearer than his foot, inside the oval.
  if (input.kind == ${Kind.land}u && input.mirror > 0.0 && frame.cut.z > 0.0 && input.ahead < 0.0 && cutAway(input.clip.xy)) {
    discard;
  }`;

/** The world shader: `clips` for the ground, the mirror and the sheer pass; without, for what stands on screen. */
export function worldWgsl(clips: boolean): string {
  return WORLD_SOURCE.replace("/*CLIP*/", clips ? CLIP_WGSL : "");
}

/**
 * The projection in WGSL, over \`frame\`: \`placement.ts\` line for line, shared
 * by the world and the impostors (\`wgsl-impostor.ts\`).
 */
export const PLACE_WGSL = `
const ROLL_ROWS = ${f(ROLL_ROWS)};
const HORIZON_SCALE = ${f(HORIZON_SCALE)};
const SINK_RATE = ${f(HORIZON_SINK_RATE)};
const TILE_WIDTH = ${f(TILE_WIDTH)};
const TILE_DEPTH = ${f(TILE_DEPTH)};
const WALL_RISE = ${f(WALL_RISE)};

fn turned(p: vec2f, rot: vec2f) -> vec2f {
  return vec2f(p.x * rot.x - p.y * rot.y, p.x * rot.y + p.y * rot.x);
}
${SWAY_WGSL}
fn squash(row: f32) -> f32 {
  let r = row / frame.roll.z;
  return 1.0 / (1.0 + r * r);
}

fn shrinkAt(rows: f32) -> f32 {
  if (rows > ROLL_ROWS) {
    return HORIZON_SCALE * ROLL_ROWS / rows;
  }
  if (frame.roll.z <= 0.0) {
    return HORIZON_SCALE;
  }
  let far = squash(ROLL_ROWS);
  let share = max(0.0, (squash(rows) - far) / (1.0 - far));
  return HORIZON_SCALE + (1.0 - HORIZON_SCALE) * sqrt(share);
}

/** Where a point of a body lands: logical x, y (shake included), the body's scale, its rows past the field. */
fn place(foot: vec2f, off: vec2f, rise: f32) -> vec4f {
  let groundTop = frame.roll.x;
  let affineY = frame.view.w - foot.y * TILE_DEPTH;
  var ground = affineY;
  var scale = 1.0;
  var rows = 0.0;
  if (affineY < groundTop) {
    rows = (groundTop - affineY) / TILE_DEPTH;
    var lift = 1.0;
    if (frame.roll.z > 0.0) {
      lift = min(atan(rows / frame.roll.z) / frame.roll.w, 1.0);
    }
    scale = shrinkAt(rows);
    let over = rows - ROLL_ROWS;
    let sink = select(0.0, SINK_RATE * over * over, over > 0.0);
    ground = groundTop - frame.roll.y * lift + sink * scale;
  }
  let x = frame.view.z + (foot.x + off.x) * TILE_WIDTH * scale + frame.depthShake.z;
  let y = ground - (off.y * TILE_DEPTH + rise * WALL_RISE) * scale + frame.depthShake.w;
  return vec4f(x, y, scale, rows);
}

/** A depth key, rows ahead, as WebGPU's 0..1 clip depth. */
fn clipDepth(depth: f32) -> f32 {
  return clamp((depth - frame.depthShake.x) / (frame.depthShake.y - frame.depthShake.x), 0.0, 1.0);
}
`;

const WORLD_SOURCE = `${WORLD_BINDINGS}
${PLACE_WGSL}
const LAP = ${f(PLANET_TILES)};
const LAKE_RANGE = ${f(LAKE_RANGE_TILES)};
const LAKE_DEPTH = ${f(LAKE_DEPTH_PER_TILE)};
const WAVE_RES = ${f(WAVE_RES)};
const WAVE_N = ${WAVE_N}i;
const WATER_DEEP = vec3f(${WATER_DEEP_ARGS});
const REFLECT = ${f(WATER_LOOK.reflect)};
const SLOPE_CAP = ${f(WATER_LOOK.slopeCap)};
const BEND = vec2f(${f(WATER_LOOK.bendX)}, ${f(WATER_LOOK.bendY)});
const SHEEN = ${f(WATER_LOOK.sheen)};
const GLINT_POWER = ${f(WATER_LOOK.glintPower)};
const GLINT = ${f(WATER_LOOK.glint)};
const PUDDLE_DEEP = ${f(WATER_LOOK.puddleDeep)};
const LAKE_DEEP = ${f(WATER_LOOK.lakeDeep)};
const TOWARD_VIEWER = vec3f(${TOWARD_VIEWER.map(f).join(", ")});

struct VertexIn {
  @location(0) pos: vec3f,
  @location(1) anchor: vec2f,
  @location(2) normal: vec4f,
  @location(3) colour: vec4f,
  @builtin(instance_index) draw: u32,
};

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) colour: vec4f,
  @location(1) normal: vec3f,
  @location(2) rows: f32,
  @location(3) planet: vec2f,
  @location(4) @interpolate(flat) kind: u32,
  @location(5) @interpolate(flat) mirror: f32,
  @location(6) ahead: f32,
};

@vertex
fn vertexMain(input: VertexIn) -> VertexOut {
  let draw = draws[input.draw];
  let rot = draw.place.zw;
  let mirror = draw.mirror.x;
  let kind = u32(input.normal.w * 127.0 + 0.5);
  let foot = turned(input.anchor + draw.place.xy, rot);
  let sway = swayOffset(kind, input.anchor + draw.place.xy, input.pos.z, rot);
  let off = turned(input.pos.xy - input.anchor, rot) + sway.xy;
  let height = input.pos.z + sway.z;
  let placed = place(foot, off, height * mirror);
  let scale = placed.z;

  var bias = 0.0;
  if (kind == ${Kind.ground}u) { bias = 0.06; }
  if (kind == ${Kind.shadow}u) { bias = 0.04; }
  if (kind == ${Kind.water}u) { bias = 0.03; }
  let depth = foot.y + off.y * scale + bias;

  var result: VertexOut;
  result.clip = vec4f(placed.x / frame.view.x * 2.0 - 1.0, 1.0 - placed.y / frame.view.y * 2.0, clipDepth(depth), 1.0);
  result.colour = input.colour;
  result.normal = vec3f(turned(input.normal.xy, rot), input.normal.z);
  result.rows = placed.w;
  result.planet = input.pos.xy + draw.place.xy + frame.hero.xy;
  result.kind = kind;
  result.mirror = mirror;
  result.ahead = foot.y + off.y * scale;
  return result;
}

/** Whether the window takes this device pixel: inside the oval, its rim dithered over the outer fifth. */
fn cutAway(fragment: vec2f) -> bool {
  let logical = fragment / frame.hero.zw * frame.view.xy;
  let distance = length((logical - frame.cut.xy) / frame.cut.zw);
  var bayer = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let cell = vec2u(fragment) % vec2u(4u);
  let threshold = (bayer[cell.y * 4u + cell.x] + 0.5) / 16.0;
  return distance < 0.8 || (distance < 1.0 && (1.0 - distance) / 0.2 > threshold);
}

fn lit(colour: vec3f, normal: vec3f) -> vec3f {
  let n = normalize(normal);
  let lambert = max(dot(n, frame.lightDir.xyz), 0.0);
  let sky = 0.5 + 0.5 * n.z;
  return colour * (0.4 + 0.24 * sky + 0.58 * lambert * frame.shading.x) * frame.ambient.rgb;
}

/** Jelly, as \`shaders.ts\` has it: lit, a highlight, and a rim thickening to the silhouette. */
fn liquid(colour: vec3f, alpha: f32, normal: vec3f) -> vec4f {
  let n = normalize(normal);
  let facing = max(dot(n, TOWARD_VIEWER), 0.0);
  let rim = (1.0 - facing) * (1.0 - facing);
  let toward = max(dot(n, normalize(frame.lightDir.xyz + TOWARD_VIEWER)), 0.0);
  let glint = (0.9 * pow(toward, 48.0) + 0.15 * pow(toward, 6.0)) * frame.shading.x;
  let shaded = lit(colour, normal) * (1.0 + 0.35 * rim) + glint * frame.ambient.rgb;
  return vec4f(shaded, clamp(mix(alpha, 1.0, 0.75 * rim) + glint, 0.0, 1.0));
}

/**
 * Standing water at a planet point, as \`waterAt\` in \`water-glsl.ts\`: x how
 * deep (> 0 is water), y tiles inside a lake's shore. A lake is the deeper of
 * the two, so it is drawn exactly as a puddle is.
 */
fn waterAt(planet: vec2f) -> vec2f {
  let mask = textureSampleLevel(waterMask, repeatSampler, planet / LAP, 0.0);
  let lake = (mask.g - 0.5) * LAKE_RANGE;
  return vec2f(max(mask.r - frame.water.x, lake * LAKE_DEPTH), lake);
}

/**
 * The water's slope and height from the simulation, or flat outside the window
 * it covers: one filtered sample of the surface the compute pass wrote. Cell
 * a covers planet [a, a + 1) / WAVE_RES, so its centre is texel a's, and the
 * grid wraps as REPEAT addressing does.
 */
fn waveSlope(planet: vec2f) -> vec3f {
  let fromHero = planet * WAVE_RES - frame.sim.xy;
  let limit = f32(WAVE_N) * 0.5 - 2.0;
  if (abs(fromHero.x) > limit || abs(fromHero.y) > limit) {
    return vec3f(0.0);
  }
  let surface = textureSampleLevel(waveSurface, repeatSampler, planet * WAVE_RES / f32(WAVE_N), 0.0);
  return vec3f(surface.yz * 3.0, surface.x);
}

/**
 * Water over a lit bed, \`deep\` of the way to the deep colour: the mirror bent
 * and shaded by the waves' slope over the water's own body, a glint where a
 * ring faces the sun - \`waterColour\` in \`water-glsl.ts\`, by \`WATER_LOOK\`.
 * The height itself never shows: a crest painted for how high it stands reads
 * as a bead of molten metal.
 */
fn waterColour(planet: vec2f, bed: vec3f, position: vec2f, deep: f32) -> vec3f {
  let wave = waveSlope(planet);
  let slope = wave.xy * min(1.0, SLOPE_CAP / max(length(wave.xy), 1e-4));
  let uv = position / frame.hero.zw + slope * BEND;
  let mirrored = textureSampleLevel(mirrorTexture, clampSampler, uv, 0.0).rgb * (1.0 + SHEEN * slope.y);
  let normal = normalize(vec3f(-slope * 0.35, 1.0));
  let halfway = normalize(frame.lightDir.xyz + vec3f(0.0, -0.45, 0.9));
  let glint = pow(max(dot(normal, halfway), 0.0), GLINT_POWER) * GLINT * frame.shading.x;
  let body = mix(bed, WATER_DEEP * frame.ambient.rgb, deep);
  return mix(body, mirrored, REFLECT) + glint * frame.ambient.rgb;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {/*CLIP*/
  var colour = input.colour.rgb;
  var alpha = input.colour.a;
  let wet = frame.water.y;
  if (input.kind == ${Kind.shadow}u) {
    alpha *= frame.shading.y;
  } else if (input.kind == ${Kind.water}u) {
    colour = waterColour(input.planet, lit(colour, input.normal) * 0.6, input.clip.xy, 0.5);
    alpha = 0.94;
  } else if (input.kind == ${Kind.ground}u) {
    var ground = lit(colour, input.normal) * (1.0 - 0.18 * wet);
    let water = waterAt(input.planet);
    let depth = water.x;
    ground *= 1.0 - 0.22 * smoothstep(-0.03, 0.0, depth);
    colour = ground;
    if (depth > 0.0) {
      let deep = max(PUDDLE_DEEP * smoothstep(0.0, 0.15, depth), LAKE_DEEP * smoothstep(0.3, 3.0, water.y));
      colour = mix(ground, waterColour(input.planet, ground * 0.7, input.clip.xy, deep), smoothstep(0.0, 0.012, depth));
    }
  } else if (input.kind == ${Kind.liquid}u) {
    let jelly = liquid(colour, alpha, input.normal);
    colour = jelly.rgb;
    alpha = jelly.a;
  } else if (input.kind != ${Kind.glow}u) {
    colour = lit(colour, input.normal);
  }
  let far = clamp(input.rows / ROLL_ROWS, 0.0, 1.0);
  let haze = select(far * far * (3.0 - 2.0 * far) * 0.78, 0.82, input.rows > ROLL_ROWS);
  colour = mix(colour, frame.haze.rgb, haze);
  return vec4f(colour, alpha);
}
`;
