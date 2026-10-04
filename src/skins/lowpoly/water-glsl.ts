/**
 * Standing water, per pixel: where it is, how it moves, what it shows.
 *
 * - **Where:** the shared puddle field (`water/puddle-field.ts`) uploaded as a
 *   texture and read at the pixel's planet point against the level the rain has
 *   raised - the same bytes and the same bilinear read the simulation uses, so a
 *   footstep ripple lands in water the picture shows.
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

/** Rings from footsteps and landings the shader is handed at once. */
export const MAX_RIPPLES = 16;

/** How long a footstep ring spreads before it is gone, seconds. */
export const RIPPLE_LIFE_S = 1.6;

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** Uniforms and functions shared by the world fragment shader. */
export const WATER_GLSL = `
uniform sampler2D u_puddles;   // the basin field, one planet lap, REPEAT
uniform sampler2D u_reflect;   // the world mirrored, this frame
uniform vec2 u_resolution;     // drawing buffer, device pixels
uniform vec4 u_water;          // level, wetness, rain, time (seconds)
uniform vec4 u_ripples[${MAX_RIPPLES}]; // planet x, y, birth (seconds), strength

const float LAP = ${float(PLANET_TILES)};
const float RIPPLE_LIFE = ${float(RIPPLE_LIFE_S)};

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

/** Slope of one expanding ring at distance \`d\` past its front: a short, damped wave. */
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
  for (int layer = 0; layer < 2; layer++) {
    float size = layer == 0 ? 0.5 : 0.8;
    float cells = LAP / size;
    vec2 base = floor(p / size);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = base + vec2(i, j);
        vec4 h = cellHash(mod(cell, cells), float(layer));
        if (h.z > rain * 0.85) {
          continue;
        }
        float period = 0.9 + h.w * 0.6;
        float t = fract(u_water.w / period + h.w * 7.0);
        vec2 centre = (cell + 0.15 + 0.7 * h.xy) * size;
        vec2 away = p - centre;
        float dist = length(away);
        float past = dist - t * size * 0.9;
        float fade = (1.0 - t) * (1.0 - t);
        slope += (away / max(dist, 1e-4)) * ringWave(past, 900.0) * fade;
      }
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
      slope += (away / max(dist, 1e-4)) * ringWave(past, 260.0) * life * life * ripple.w;
    }
  }
  return slope;
}

/**
 * Water over a bed of colour \`bed\` (already lit): the reflection, bent by the
 * slope, over a glimpse of the bed, and a glint where a ring faces the light.
 */
vec3 waterColour(vec2 planet, vec3 bed, vec3 lightDir) {
  vec2 slope = rainSlope(planet) * 0.6 + stepSlope(planet);
  vec2 uv = gl_FragCoord.xy / u_resolution + slope * vec2(0.012, -0.02);
  vec3 mirrored = texture(u_reflect, uv).rgb;
  vec3 normal = normalize(vec3(-slope * 0.35, 1.0));
  vec3 halfway = normalize(lightDir + vec3(0.0, -0.45, 0.9));
  float glint = pow(max(dot(normal, halfway), 0.0), 60.0) * 0.5;
  return mix(bed, mirrored, 0.72) + glint;
}

/** How deep the field's water is at a planet point: < 0 dry, > 0 standing water. */
float puddleAt(vec2 planet) {
  return texture(u_puddles, planet / LAP).r - u_water.x;
}
`;
