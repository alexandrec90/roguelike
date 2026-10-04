/**
 * The skin's two programs: the world, and the sky behind it.
 *
 * The world's vertex shader is `placement.ts` in GLSL, line for line - the
 * pixel skin's oblique local view and the treadmill lip, with depth. Change one
 * and change the other; `placement.test.ts` pins the TypeScript to the pixel
 * skin's own projection, and this is held to the TypeScript by reading.
 *
 * Shading is deliberately plain, because minimal is the look: one light from
 * the atmosphere's screen-space direction (so it turns with the camera, as the
 * pixel skin's does), a sky-from-above ambient term, the hour's ambient colour
 * multiplied over everything, and the far field fading into the haze as it goes
 * over the lip.
 */

import { HORIZON_SCALE, HORIZON_SINK_RATE, ROLL_ROWS } from "../../game/horizon";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../../game/projection";
import { Kind } from "./mesh";
import { WATER_GLSL } from "./water-glsl";

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

export const WORLD_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_anchor;
layout(location = 2) in vec4 a_normal;
layout(location = 3) in vec4 a_colour;

uniform vec2 u_offset;   // planet tiles from the hero to this draw's origin
uniform vec2 u_rot;      // cos, sin of the turn: planet to local
uniform vec4 u_view;     // logical width, height, foot x, foot y
uniform vec4 u_roll;     // ground top, roll height, knee, atan(ROLL_ROWS / knee)
uniform vec2 u_depth;    // nearest and farthest depth key
uniform vec2 u_shake;    // logical pixels
uniform vec2 u_hero;     // the hero's planet point
uniform float u_mirror;  // 1, or -1 to draw the world reflected in still water at z = 0

out vec4 v_colour;
out vec3 v_normal;
out float v_rows;
out vec2 v_planet;
flat out int v_kind;

const float ROLL_ROWS = ${float(ROLL_ROWS)};
const float HORIZON_SCALE = ${float(HORIZON_SCALE)};
const float SINK_RATE = ${float(HORIZON_SINK_RATE)};
const float TILE_WIDTH = ${float(TILE_WIDTH)};
const float TILE_DEPTH = ${float(TILE_DEPTH)};
const float WALL_RISE = ${float(WALL_RISE)};

vec2 turned(vec2 p) {
  return vec2(p.x * u_rot.x - p.y * u_rot.y, p.x * u_rot.y + p.y * u_rot.x);
}

float squash(float row) {
  float r = row / u_roll.z;
  return 1.0 / (1.0 + r * r);
}

float shrinkAt(float rows) {
  if (rows > ROLL_ROWS) {
    return HORIZON_SCALE * ROLL_ROWS / rows;
  }
  if (u_roll.z <= 0.0) {
    return HORIZON_SCALE;
  }
  float far = squash(ROLL_ROWS);
  float share = max(0.0, (squash(rows) - far) / (1.0 - far));
  return HORIZON_SCALE + (1.0 - HORIZON_SCALE) * sqrt(share);
}

void main() {
  int kind = int(a_normal.w * 127.0 + 0.5);
  vec2 foot = turned(a_anchor + u_offset);
  vec2 off = turned(a_pos.xy - a_anchor);

  float groundTop = u_roll.x;
  float affineY = u_view.w - foot.y * TILE_DEPTH;
  float ground = affineY;
  float scale = 1.0;
  float rows = 0.0;
  if (affineY < groundTop) {
    rows = (groundTop - affineY) / TILE_DEPTH;
    float lift = u_roll.z > 0.0 ? min(atan(rows / u_roll.z) / u_roll.w, 1.0) : 1.0;
    scale = shrinkAt(rows);
    float over = rows - ROLL_ROWS;
    float sink = over > 0.0 ? SINK_RATE * over * over : 0.0;
    ground = groundTop - u_roll.y * lift + sink * scale;
  }
  float x = u_view.z + (foot.x + off.x) * TILE_WIDTH * scale + u_shake.x;
  float y = ground - (off.y * TILE_DEPTH + a_pos.z * u_mirror * WALL_RISE) * scale + u_shake.y;

  // Things lying on the ground sit a hair behind anything standing on the same row.
  float bias = kind == ${Kind.ground} ? 0.06 : (kind == ${Kind.shadow} ? 0.04 : (kind == ${Kind.water} ? 0.03 : 0.0));
  float depth = foot.y + off.y * scale + bias;
  float z = clamp((depth - u_depth.x) / (u_depth.y - u_depth.x), 0.0, 1.0) * 2.0 - 1.0;

  gl_Position = vec4(x / u_view.x * 2.0 - 1.0, 1.0 - y / u_view.y * 2.0, z, 1.0);
  v_colour = a_colour;
  v_normal = vec3(turned(a_normal.xy), a_normal.z);
  v_rows = rows;
  v_planet = a_pos.xy + u_offset + u_hero;
  v_kind = kind;
}
`;

/**
 * The cut a fragment may make: what lies past the horizon, and in the mirror
 * anything lying flat or sunk past it.
 *
 * Only in the variant that needs it. A shader that *can* discard switches off
 * the GPU's early depth test for every draw it makes, so every hidden fragment
 * of every overlapping mountain and tree is shaded in full - measured at most of
 * the frame on an integrated GPU. What stands, on screen, never needs to
 * discard, and draws with `WORLD_FRAGMENT_SOLID`.
 */
const CLIP_GLSL = `
  bool lies = v_kind == ${Kind.ground} || v_kind == ${Kind.shadow} || v_kind == ${Kind.water};
  // The reflection is of what stands; the ground it would lie on is the water itself.
  if (lies && (v_rows > ROLL_ROWS || u_mirror < 0.0)) {
    discard;
  }
  // Past the horizon a body is hidden behind the curve by the ground in front of
  // it. The mirror draws no ground, so it must not draw those bodies either, or
  // their sunken images land in the middle of every puddle.
  if (u_mirror < 0.0 && v_rows > ROLL_ROWS) {
    discard;
  }`;

const worldFragment = (clips: boolean): string => `#version 300 es
precision highp float;

in vec4 v_colour;
in vec3 v_normal;
in float v_rows;
in vec2 v_planet;
flat in int v_kind;

uniform vec3 u_lightDir;  // toward the light, local frame
uniform vec3 u_ambient;   // the hour's colour, multiplied over everything lit
uniform vec3 u_haze;      // the air at the far edge of the world
uniform vec3 u_shading;   // sun strength, shadow strength, daylight
uniform float u_mirror;   // -1 while drawing the reflection

out vec4 outColour;

const float ROLL_ROWS = ${float(ROLL_ROWS)};

${WATER_GLSL}

/** A face lit by the sun and the sky, under the hour's colour. */
vec3 lit(vec3 colour) {
  vec3 n = normalize(v_normal);
  float lambert = max(dot(n, u_lightDir), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  return colour * (0.4 + 0.24 * sky + 0.58 * lambert * u_shading.x) * u_ambient;
}

void main() {${clips ? CLIP_GLSL : ""}
  vec3 colour = v_colour.rgb;
  float alpha = v_colour.a;
  float wet = u_water.y;
  if (v_kind == ${Kind.shadow}) {
    alpha *= u_shading.y;
  } else if (v_kind == ${Kind.water}) {
    colour = waterColour(v_planet, lit(colour) * 0.6, u_lightDir);
    alpha = 0.94;
  } else if (v_kind == ${Kind.ground}) {
    // Soaked ground is darker; standing water is a mirror over it, with a damp rim.
    vec3 ground = lit(colour) * (1.0 - 0.18 * wet);
    float depth = puddleAt(v_planet);
    float rim = smoothstep(-0.03, 0.0, depth);
    ground *= 1.0 - 0.22 * rim;
    colour = depth > 0.0 ? mix(ground, waterColour(v_planet, ground * 0.7, u_lightDir), smoothstep(0.0, 0.012, depth)) : ground;
  } else if (v_kind != ${Kind.glow}) {
    colour = lit(colour);
  }
  float far = clamp(v_rows / ROLL_ROWS, 0.0, 1.0);
  float haze = v_rows > ROLL_ROWS ? 0.82 : far * far * (3.0 - 2.0 * far) * 0.78;
  colour = mix(colour, u_haze, haze);
  outColour = vec4(colour, alpha);
}
`;

/** For the ground, the mirror and the sheer pass: may discard. */
export const WORLD_FRAGMENT = worldFragment(true);

/** For what stands, on screen: never discards, so the depth test runs early. */
export const WORLD_FRAGMENT_SOLID = worldFragment(false);

/** One triangle over the whole screen; the fragment shader paints the sky by scanline. */
export const SKY_VERTEX = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SKY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_height;   // logical scanlines
uniform float u_horizon;  // the horizon line's scanline
uniform vec3 u_top;
uniform vec3 u_bottom;
uniform vec3 u_haze;
out vec4 outColour;
void main() {
  float y = (1.0 - v_uv.y) * u_height;
  float t = clamp(y / max(u_horizon, 1.0), 0.0, 1.0);
  vec3 sky = mix(u_top, u_bottom, t * t);
  outColour = vec4(y > u_horizon ? u_haze : sky, 1.0);
}
`;
