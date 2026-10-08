/**
 * The impostors in GLSL: a quad per ball, the ball worked out per pixel.
 * `webgpu/wgsl-impostor.ts` is this again in WGSL; change one, change both.
 *
 * The vertex shader places the ball's centre through the world's own
 * projection (`PLACE_GLSL`) - lip, sink, sway and all - and spreads the quad
 * to the ellipse a sphere of that radius projects to. A cloud puff skips the
 * planet: it is already in screen pixels (`sky-puffs.ts`).
 *
 * The fragment shader has two ways to draw what is inside:
 *
 * - **A ball** (the default): the outline is pushed in and out by noise, so a
 *   crown is leafy and a puff billows; the normal is the sphere's, bent by the
 *   same noise, built in the screen's basis and turned into the local frame so
 *   it lights exactly as a mesh face does. It writes its own depth - the front
 *   of the sphere at that pixel - so a crown swallows its own trunk and two
 *   puffs cut into each other where they meet. An old puff of smoke wastes
 *   away - shrinks, its lumps parting - rather than fading, so nothing blends.
 * - **A volume** (`?volume=1`, smoke and clouds only): the ray through the
 *   pixel is marched through a noise density inside the ball, each sample lit
 *   by a short march toward the sun (self-shadowing), front to back with
 *   Beer-Lambert absorption, out premultiplied. Several times the cost per
 *   pixel - the expensive end of the menu, cheap at `?res=low`.
 */

import { ROLL_ROWS } from "../../game/horizon";
import { QUAD_REACH, SCREEN_RISE, SCREEN_UP } from "./impostor";
import { Kind } from "./mesh";
import { LOWPOLY } from "./palette";
import { TOWARD_VIEWER } from "./placement";
import { PLACE_GLSL } from "./shaders";

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);
const vec3 = (v: readonly number[]): string => `vec3(${v.map(float).join(", ")})`;

/** A cloud sits this far back in the depth buffer: behind everything drawn, in front of the cleared sky. */
export const CLOUD_DEPTH = 0.9999;

export const IMPOSTOR_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_centre;
layout(location = 1) in vec2 a_foot;
layout(location = 2) in float a_radius;
layout(location = 3) in vec4 a_colour;
layout(location = 4) in vec4 a_info;   // kind, seed, age, corner: bytes, not normalised
${PLACE_GLSL}
out vec4 v_colour;
out vec2 v_corner;
out float v_rows;
out float v_depth;
out float v_reach;
out float v_cut;
out float v_seed;
out float v_age;
flat out int v_kind;

const float REACH = ${float(QUAD_REACH)};
const float RISE = ${float(SCREEN_RISE)};

void main() {
  int kind = int(a_info.x + 0.5);
  int corner = int(a_info.w + 0.5);
  vec2 c = vec2(float(corner & 1), float((corner >> 1) & 1)) * 2.0 - 1.0;
  v_corner = c * REACH;
  v_colour = a_colour;
  v_seed = a_info.y / 255.0;
  v_age = a_info.z / 255.0;
  v_kind = kind;
  if (kind == ${Kind.cloud}) {
    vec2 at = a_centre.xy + vec2(c.x, -c.y) * a_foot * REACH + u_shake;
    v_cut = (a_centre.z - a_centre.y) / max(a_foot.y, 0.001);
    v_rows = 0.0;
    v_depth = u_depth.y;
    v_reach = 0.0;
    gl_Position = vec4(at.x / u_view.x * 2.0 - 1.0, 1.0 - at.y / u_view.y * 2.0, ${float(CLOUD_DEPTH * 2 - 1)}, 1.0);
    return;
  }
  vec2 foot = turned(a_foot + u_offset);
  vec3 sway = swayOffset(kind, a_foot + u_offset, a_centre.z);
  vec2 off = turned(a_centre.xy - a_foot) + sway.xy;
  float height = a_centre.z + sway.z;
  vec4 placed = place(foot, off, height * u_mirror);
  vec2 radii = vec2(TILE_WIDTH, RISE) * a_radius * placed.z;
  vec2 at = placed.xy + vec2(c.x, -c.y) * radii * REACH;
  v_rows = placed.w;
  v_depth = foot.y + off.y * placed.z;
  v_reach = a_radius * placed.z;
  v_cut = 9.0;
  gl_Position = vec4(at.x / u_view.x * 2.0 - 1.0, 1.0 - at.y / u_view.y * 2.0, clipDepth(v_depth), 1.0);
}
`;

export const IMPOSTOR_FRAGMENT = `#version 300 es
precision highp float;

in vec4 v_colour;
in vec2 v_corner;
in float v_rows;
in float v_depth;
in float v_reach;
in float v_cut;
in float v_seed;
in float v_age;
flat in int v_kind;

uniform vec2 u_depth;       // nearest and farthest depth key
uniform vec3 u_lightDir;    // toward the light, local frame
uniform vec3 u_ambient;
uniform vec3 u_haze;
uniform vec4 u_shading;     // sun strength, shadow strength, daylight, stepped (look.ts; unread here)
uniform vec4 u_water;       // .w: the shaders' clock, seconds
uniform float u_mirror;     // -1 while drawing the reflection
uniform float u_volume;     // 1: march smoke and clouds as volumes
uniform vec3 u_cloudShade;  // the hour's cloud shade tone

out vec4 outColour;

const float ROLL_ROWS = ${float(ROLL_ROWS)};
const float REACH = ${float(QUAD_REACH)};
const vec3 SCREEN_RIGHT = vec3(1.0, 0.0, 0.0);
const vec3 SCREEN_UP = ${vec3(SCREEN_UP)};
const vec3 TOWARD_VIEWER = ${vec3(TOWARD_VIEWER)};
const vec3 EMBER = ${vec3(LOWPOLY.ember)};

float hash3(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 32768);
  uint n = (q.x * 1597334673u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
  n = (n ^ (n >> 15u)) * 2246822519u;
  n ^= n >> 13u;
  return float(n) / 4294967295.0;
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

/** Three octaves of value noise, 0..1. */
float fbm(vec3 p) {
  return 0.57 * noise3(p) + 0.29 * noise3(p * 2.03 + 17.1) + 0.14 * noise3(p * 4.01 + 31.7);
}

/** How a kind billows: the lumps' size in radii, how many fit round it, how fast they roll. */
vec3 billowOf(int kind) {
  if (kind == ${Kind.smoke}) { return vec3(0.24, 1.7, 0.55); }
  if (kind == ${Kind.cloud}) { return vec3(0.14, 1.4, 0.07); }
  return vec3(0.18, 2.4, 0.0);
}

/** Rows of haze over the far field, as the world's fragment shader lays it. */
float hazeAt(float rows) {
  float far = clamp(rows / ROLL_ROWS, 0.0, 1.0);
  return rows > ROLL_ROWS ? 0.82 : far * far * (3.0 - 2.0 * far) * 0.78;
}

/** Glow from the vent on a young puff's underside. */
float heatOf(float up) {
  return (1.0 - smoothstep(0.0, 0.16, v_age)) * clamp(0.55 - up, 0.0, 1.0);
}

/** A lit ball with a billowing outline; \`lift\` is the depth, in radii, of its front at this pixel. */
vec4 ball(vec2 q, float seed, float t, out float lift) {
  vec3 b = billowOf(v_kind);
  vec2 dir = q / max(length(q), 1e-4);
  float lump = fbm(vec3(dir * b.y + seed, t * b.y * b.z + seed * 0.37));
  // An old puff of smoke wastes away: it shrinks, and its lumps part from each other as it goes.
  float waste = v_kind == ${Kind.smoke} ? smoothstep(0.5, 1.0, v_age) : 0.0;
  float edge = (1.0 + b.x * (lump * 2.0 - 1.0)) * (1.0 - waste * (1.15 - lump));
  if (dot(q, q) > edge * edge) {
    discard;
  }
  vec2 p = q / edge;
  vec3 s = vec3(p, sqrt(max(1.0 - dot(p, p), 0.0)));
  lift = s.y * SCREEN_UP.y + s.z * TOWARD_VIEWER.y;
  // The same field inside the outline, bending the normal: clusters, not a smooth bead.
  float grain = fbm(vec3(q * b.y * 1.7 + seed * 3.1, t * b.z));
  vec3 bent = normalize(s + vec3(p * (grain - 0.5) * 0.9, 0.0));
  vec3 n = bent.x * SCREEN_RIGHT + bent.y * SCREEN_UP + bent.z * TOWARD_VIEWER;
  if (u_mirror < 0.0) {
    n.z = -n.z;
  }
  float light = dot(n, u_lightDir);
  if (v_kind == ${Kind.cloud}) {
    return vec4(mix(u_cloudShade, v_colour.rgb, smoothstep(-0.5, 0.6, light + (grain - 0.5) * 0.5)), 1.0);
  }
  float crease = 0.8 + 0.4 * grain;
  float sky = 0.5 + 0.5 * n.z;
  if (v_kind == ${Kind.smoke}) {
    // Smoke scatters: the shaded side is grey, not black.
    vec3 lit = v_colour.rgb * crease * (0.52 + 0.2 * sky + 0.38 * (light * 0.5 + 0.5) * u_shading.x) * u_ambient;
    return vec4(lit + EMBER * heatOf(s.y) * 0.9, 1.0);
  }
  return vec4(v_colour.rgb * crease * (0.4 + 0.24 * sky + 0.58 * max(light, 0.0) * u_shading.x) * u_ambient, 1.0);
}

/** Density of a smoke or cloud puff at a point inside its ball, radii from its centre. */
float density(vec3 p, float seed, float t, vec3 b) {
  if (v_kind == ${Kind.cloud} && p.y < -v_cut) {
    return 0.0;
  }
  float body = 1.0 - length(p);
  float n = fbm(p * b.y * 1.2 + vec3(seed, seed * 0.7 - t * b.z, t * b.z * 0.6));
  return clamp(body * 2.2 + (n - 0.5) * 2.0 - 0.15, 0.0, 1.0);
}

/** A puff as a volume: marched front to back, each sample lit by a short march toward the sun. */
vec4 volume(vec2 q, float seed, float t, out float lift) {
  float r2 = dot(q, q);
  if (r2 >= REACH * REACH) {
    discard;
  }
  vec3 b = billowOf(v_kind);
  float span = sqrt(REACH * REACH - r2);
  lift = q.y * SCREEN_UP.y + span * TOWARD_VIEWER.y;
  vec3 sun = vec3(u_lightDir.x, dot(u_lightDir, SCREEN_UP), dot(u_lightDir, TOWARD_VIEWER));
  bool cloud = v_kind == ${Kind.cloud};
  float fade = cloud ? 1.0 : 1.0 - smoothstep(0.5, 1.0, v_age);
  float thick = (cloud ? 3.0 : 4.0) * v_colour.a * fade;
  vec3 bright = cloud ? v_colour.rgb : v_colour.rgb * (0.6 + 0.5 * u_shading.x) * u_ambient;
  vec3 dark = cloud ? u_cloudShade : v_colour.rgb * 0.42 * u_ambient;
  const int STEPS = 12;
  float dt = 2.0 * span / float(STEPS);
  float through = 1.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = vec3(q, span - (float(i) + 0.5) * dt);
    float d = density(p, seed, t, b) * thick;
    if (d <= 0.001) {
      continue;
    }
    float shade = density(p + sun * 0.3, seed, t, b) + density(p + sun * 0.65, seed, t, b);
    vec3 c = mix(dark, bright, exp(-shade * thick * 0.45));
    if (!cloud) {
      c += EMBER * heatOf(p.y) * 1.2;
    }
    float a = 1.0 - exp(-d * dt);
    sum += through * a * c;
    through *= 1.0 - a;
    if (through < 0.03) {
      break;
    }
  }
  if (through > 0.996) {
    discard;
  }
  return vec4(sum, 1.0 - through);
}

void main() {
  if (u_mirror < 0.0 && v_rows > ROLL_ROWS) {
    discard;
  }
  vec2 q = v_corner;
  if (v_kind == ${Kind.cloud} && q.y < -v_cut) {
    discard;
  }
  float seed = v_seed * 61.0;
  float t = u_water.w;
  float lift = 0.0;
  bool soft = u_volume > 0.5 && v_kind != ${Kind.foliage};
  vec4 colour = soft ? volume(q, seed, t, lift) : ball(q, seed, t, lift);
  if (v_kind != ${Kind.cloud}) {
    // Smoke stands high above the far field's haze: it takes only some of it.
    float haze = hazeAt(v_rows) * (v_kind == ${Kind.smoke} ? 0.55 : 1.0);
    colour.rgb = mix(colour.rgb, u_haze * colour.a, haze);
  }
  float key = v_depth + v_reach * lift;
  gl_FragDepth = v_kind == ${Kind.cloud} ? ${float(CLOUD_DEPTH)} : clamp((key - u_depth.x) / (u_depth.y - u_depth.x), 0.0, 1.0);
  outColour = colour;
}
`;
