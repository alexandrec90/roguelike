/**
 * Standing water, per pixel: where it is, how it moves, what it shows.
 *
 * - **Where:** the shared puddle field (`water/puddle-field.ts`) uploaded as a
 *   texture and read at the pixel's planet point against the level the rain has
 *   raised - the same bytes and the same bilinear read the simulation uses, so a
 *   footstep ripple lands in water the picture shows. The lakes ride in the
 *   texture's second channel (`water-texels.ts`), so the ground draws them too.
 * - **What it shows:** the world mirrored. This projection is parallel, so the
 *   reflection of a point `(x, y, z)` in still water at `z = 0` is just
 *   `(x, y, -z)`; the skin draws the world once with height flipped into a half-
 *   size target, and water reads it at its own screen position. Exact, and one
 *   cheap extra pass rather than a ray per pixel.
 * - **How it moves:** rings, as surface slope. Rain is a lattice of cells on the
 *   planet, each dropping a ring on its own seeded beat (the Rainier Mood idea,
 *   pinned to the planet so the rings stay put as the world turns); footsteps
 *   and landings are up to `MAX_RIPPLES` rings handed in as uniforms. The slope
 *   bends the reflection and catches the light.
 */

import { PLANET_TILES } from "../../game/planet";
import { LOWPOLY } from "./palette";
import { LAKE_RANGE_TILES } from "./water-texels";

/**
 * A lake's tiles inside its shore, in the basin field's depth units: how
 * steeply its water comes in from the shore line - over a sixteenth of a tile,
 * with a damp rim a little wider outside, so its edge is as crisp as a puddle's.
 */
export const LAKE_DEPTH_PER_TILE = 0.2;

/** Rings from footsteps and landings the shader is handed at once. */
export const MAX_RIPPLES = 16;

/** How long a footstep ring spreads before it is gone, seconds. */
export const RIPPLE_LIFE_S = 1.6;

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/**
 * How a water surface is shaded, the same numbers in both backends: only how
 * it moves differs between them. Water is mostly its own body - the bed seen
 * through it, going to `LOWPOLY.waterDeep` as it deepens - with the sky laid
 * over it, never the other way about: a near-total mirror with nothing of its
 * own reads as polished metal. And a wave shows by how it *tilts*, never by
 * how high it stands - a crest painted brighter for its height is a bead of
 * chrome, not a ripple.
 */
export const WATER_LOOK = {
  /** Share of the reflection laid over the water's body. */
  reflect: 0.5,
  /** Steepest slope the shading takes: past it a crest would bend the mirror to something tiles away. */
  slopeCap: 0.7,
  /** Share of the screen the steepest slope bends the mirror by, across and down. */
  bendX: 0.006,
  bendY: 0.01,
  /**
   * How much a face tilted toward the viewer darkens the sky it shows, and one
   * tilted away brightens it - the zenith is deeper than the horizon. One side
   * of a ring lighter and the other darker is what reads as a ripple.
   */
  sheen: 0.6,
  /** The sun's glint: how tight, and how bright at full sun. */
  glintPower: 140,
  glint: 0.45,
  /** How far a puddle's body goes toward the deep colour, and a lake's middle. */
  puddleDeep: 0.3,
  lakeDeep: 0.85,
} as const;

/** `LOWPOLY.waterDeep` as a shader constant's arguments, for either language. */
export const WATER_DEEP_ARGS = LOWPOLY.waterDeep.map(float).join(", ");

/**
 * Uniforms and functions shared by the world fragment shader. Without
 * `ripples` (`?off=ripples`) the water is still: `waterColour` takes no slope,
 * so neither ring lattice is compiled in.
 */
export function waterGlsl(ripples: boolean): string {
  return ripples ? WATER_GLSL : WATER_GLSL.replace(RIPPLE_SLOPE, "vec2 slope = vec2(0.0);");
}

/** The one line of `waterColour` the rings enter by. */
const RIPPLE_SLOPE = "vec2 slope = rainSlope(planet) * 0.6 + stepSlope(planet);";

/** The water's shader source with every ring in it. */
export const WATER_GLSL = `
uniform sampler2D u_puddles;   // the basin field, one planet lap, REPEAT
uniform sampler2D u_reflect;   // the world mirrored, this frame
uniform vec2 u_resolution;     // drawing buffer, device pixels
uniform vec4 u_water;          // level, wetness, rain, time (seconds)
uniform vec4 u_ripples[${MAX_RIPPLES}]; // planet x, y, birth (seconds), strength

const float LAP = ${float(PLANET_TILES)};
const float LAKE_RANGE = ${float(LAKE_RANGE_TILES)};
const float LAKE_DEPTH = ${float(LAKE_DEPTH_PER_TILE)};
const float RIPPLE_LIFE = ${float(RIPPLE_LIFE_S)};
const vec3 WATER_DEEP = vec3(${WATER_DEEP_ARGS});
const float REFLECT = ${float(WATER_LOOK.reflect)};
const float SLOPE_CAP = ${float(WATER_LOOK.slopeCap)};
const vec2 BEND = vec2(${float(WATER_LOOK.bendX)}, -${float(WATER_LOOK.bendY)});
const float SHEEN = ${float(WATER_LOOK.sheen)};
const float GLINT_POWER = ${float(WATER_LOOK.glintPower)};
const float GLINT = ${float(WATER_LOOK.glint)};
const float PUDDLE_DEEP = ${float(WATER_LOOK.puddleDeep)};
const float LAKE_DEEP = ${float(WATER_LOOK.lakeDeep)};

/** The shortest way from b to a round the planet. */
vec2 wrapped(vec2 a, vec2 b) {
  vec2 d = a - b;
  return d - LAP * floor(d / LAP + 0.5);
}

/** Four seeded unit floats for an integer cell. */
vec4 cellHash(vec2 cell, float salt) {
  uvec2 q = uvec2(ivec2(cell)) * uvec2(1597334673u, 3812015801u) + uvec2(uint(salt * 977.0));
  uint n = (q.x ^ q.y) * 1597334673u;
  uvec4 h = uvec4(n, n * 3812015801u, n * 2798796415u, n * 1979697957u);
  h ^= h >> 15u;
  h *= 2246822519u;
  h ^= h >> 13u;
  return vec4(h) / 4294967295.0;
}

/** Slope of one expanding ring at distance \`past\` beyond its front: a short, damped wave. */
float ringWave(float past, float sharp) {
  return exp(-past * past * sharp) * sin(past * 38.0);
}

/** Slope from rain: a lattice of cells, each dropping a ring on its own beat. */
vec2 rainSlope(vec2 p) {
  vec2 slope = vec2(0.0);
  float rain = u_water.z;
  if (rain <= 0.0) {
    return slope;
  }
  // One lattice, and only the four cells nearest the pixel: a ring never grows
  // past its own cell's width, so those four hold every ring that can reach it.
  // Two lattices of nine cells each cost the fallback ~6 ms a frame on an
  // integrated GPU; this is under a quarter of that.
  const float size = 0.6;
  float cells = LAP / size;
  vec2 base = floor(p / size - 0.5);
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      vec2 cell = base + vec2(i, j);
      vec4 h = cellHash(mod(cell, cells), 0.0);
      if (h.z > rain * 0.85) {
        continue;
      }
      float period = 0.9 + h.w * 0.6;
      float t = fract(u_water.w / period + h.w * 7.0);
      vec2 centre = (cell + 0.25 + 0.5 * h.xy) * size;
      vec2 away = p - centre;
      float dist = length(away);
      float past = dist - t * size * 0.75;
      float fade = (1.0 - t) * (1.0 - t);
      float wave = ringWave(past, 900.0) * fade;
      slope += (away / max(dist, 1e-4)) * wave;
    }
  }
  return slope;
}

/** Slope from footsteps and landings. */
vec2 stepSlope(vec2 p) {
  vec2 slope = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 ripple = u_ripples[i];
    float age = u_water.w - ripple.z;
    if (ripple.w <= 0.0 || age < 0.0 || age > RIPPLE_LIFE) {
      continue;
    }
    vec2 away = wrapped(p, ripple.xy);
    float dist = length(away);
    float life = 1.0 - age / RIPPLE_LIFE;
    for (int ring = 0; ring < 2; ring++) {
      float past = dist - age * (0.75 - 0.25 * float(ring));
      float wave = ringWave(past, 260.0) * life * life * ripple.w;
      slope += (away / max(dist, 1e-4)) * wave;
    }
  }
  return slope;
}

/**
 * Water over a bed of colour \`bed\` (already lit), \`deep\` of the way to the
 * deep colour: the reflection, bent and shaded by the slope, laid over the
 * water's own body, and a glint where a ring faces the sun. \`WATER_LOOK\`.
 */
vec3 waterColour(vec2 planet, vec3 bed, vec3 lightDir, float deep) {
  vec2 slope = rainSlope(planet) * 0.6 + stepSlope(planet);
  slope *= min(1.0, SLOPE_CAP / max(length(slope), 1e-4));
  vec2 uv = gl_FragCoord.xy / u_resolution + slope * BEND;
  vec3 mirrored = texture(u_reflect, uv).rgb * (1.0 + SHEEN * slope.y);
  vec3 normal = normalize(vec3(-slope * 0.35, 1.0));
  vec3 halfway = normalize(lightDir + vec3(0.0, -0.45, 0.9));
  float glint = pow(max(dot(normal, halfway), 0.0), GLINT_POWER) * GLINT * u_shading.x;
  vec3 body = mix(bed, WATER_DEEP * u_ambient, deep);
  return mix(body, mirrored, REFLECT) + glint * u_ambient;
}

/**
 * Standing water at a planet point: x how deep, in the basin field's units
 * (< 0 dry, > 0 water), y how many tiles inside a lake's shore (< 0 outside).
 * A lake is the deeper of the two wherever it lies, so it is drawn exactly as a
 * puddle is, out of the same ground and the same mirror.
 */
vec2 waterAt(vec2 planet) {
  vec2 mask = texture(u_puddles, planet / LAP).rg;
  float lake = (mask.g - 0.5) * LAKE_RANGE;
  return vec2(max(mask.r - u_water.x, lake * LAKE_DEPTH), lake);
}
`;
