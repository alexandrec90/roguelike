/**
 * The volume body, as a GLSL ES 3.00 fragment shader.
 *
 * This is a **port, not a reimplementation**. Every function below mirrors a
 * function in `procgen/` line for line — `pixelHash`, `valueNoise2/3`, `fbm3`,
 * `sdSmoothUnion`, `warpField`, `fieldNormal`, `rampInk`, `ditherThreshold` —
 * because the CPU path is the tested reference and the whole value of a GPU
 * path is that it draws *the same tree*, faster. A shader that invents its own
 * noise is a second art direction with a plausible excuse.
 *
 * ## Why WebGL2, and not a Phaser shader
 *
 * Phaser 4.2 creates a **WebGL1** context (`'webgl'` / `experimental-webgl`,
 * GLSL ES 1.00). GLSL ES 1.00 has no unsigned integers and no bitwise
 * operators, and `pixelHash` is nothing but shifts, xors and a wrapping 32-bit
 * multiply. It cannot be expressed there. The usual workaround —
 * `fract(sin(dot(p, k)) * 43758.5453)` — is a *different hash*, which produces
 * different lattice values, a different warp and therefore a visibly different
 * silhouette from the CPU model. That is not an optimisation, it is a fork.
 *
 * So the bodies render in a WebGL2 context of their own and reach Phaser as a
 * texture. Phaser stays on its own renderer and never learns about any of this.
 *
 * ## What still differs, and by how much
 *
 * The CPU computes `h / 0xffffffff` in float64; the shader has float32, whose
 * 24-bit mantissa cannot hold a 32-bit integer exactly. Lattice values agree to
 * roughly 1e-7, which survives every smoothstep and threshold except where a
 * level lands within that of a ramp step or a Bayer threshold.
 *
 * Measured, rather than assumed, by the tree lab's `diff` renderer over 18
 * poses of the chestnut across three light angles: **worst case 8 pixels of
 * roughly 550, mean 1.2, and 0 in fifteen of the eighteen.** The boulder, the
 * mushroom ring and a *burning* bush — body, fire and char together — are
 * pixel-exact at every pose tried. The disagreements are single pixels sitting
 * on a dither boundary, never a change of silhouette.
 *
 * The one deliberate approximation is the **shadow**. Its inverse projection is
 * exact per row but the rounding is not invertible — a shallow sun squashes
 * five or six body rows onto one row of ground — so the pass walks that band in
 * four samples instead of resolving it exactly. The parity claim above is for
 * bodies; shadows are dithered and match by eye.
 */

/** Fixed-size uniform arrays: GLSL ES 3.00 needs a compile-time bound. */
export const MAX_LOBES = 12;
export const MAX_RAMP = 6;
export const MAX_OCTAVES = 4;

/**
 * Two vertex shaders, one per host, and both have exactly one job: deliver
 * `outTexCoord` with (0, 0) at the **top-left of the quad**.
 *
 * The fragment stage derives its cloud coordinate from that, so it does not
 * care whether it is being drawn by our own full-screen quad or by Phaser's
 * positioned one. Getting the orientation wrong here renders the body upside
 * down and nowhere else — which is why it is stated twice rather than inferred.
 */
export const VOLUME_VERTEX_SHADER = `#version 300 es
in vec2 a_clip;
out vec2 outTexCoord;
void main() {
  gl_Position = vec4(a_clip, 0.0, 1.0);
  // Clip space has +1 at the top; the cloud has row 0 there.
  outTexCoord = vec2(a_clip.x * 0.5 + 0.5, 0.5 - a_clip.y * 0.5);
}
`;

/**
 * The same, for a Phaser `GameObjects.Shader` quad.
 *
 * Phaser supplies `inPosition` in quad space and expects it through
 * `uProjectionMatrix`, and hands the texture coordinate over as `inTexCoord`.
 * Matching those three names is the whole contract.
 */
export const VOLUME_PHASER_VERTEX_SHADER = `#version 300 es
uniform mat4 uProjectionMatrix;
in vec2 inPosition;
in vec2 inTexCoord;
out vec2 outTexCoord;
void main() {
  gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);
  // Flipped: Phaser hands over a texture coordinate with y=0 at the BOTTOM,
  // and a pixel cloud counts rows from the top. Without this every body renders
  // upside down — canopy under trunk — which is the one failure mode of this
  // whole migration that compiles, runs, reports no error, and is instantly
  // obvious on screen.
  outTexCoord = vec2(inTexCoord.x, 1.0 - inTexCoord.y);
}
`;

export const VOLUME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 outTexCoord;
out vec4 fragColor;

// The QUAD: where its top-left pixel sits in cloud space, and how many pixels
// across it is. These describe the rectangle being rasterised, which for a
// Phaser game object is a fixed footprint and for our own renderer is the
// body's tight box.
uniform vec2 u_boxOrigin;
uniform vec2 u_viewport;

// The BODY's own box: everything outside is discarded, and the flat light
// normalises across it. Separate from the quad because a fixed-size game object
// must still light and clip exactly as the CPU's tight box does, or the two
// renderers disagree the moment a body is drawn at a distance.
uniform vec4 u_clipRect;

// Screen pixels per cloud pixel: 1 in the flat field, under 1 on the horizon
// roll. A quad pixel divides by it to find the cloud point it samples, so a far
// body is the same field read at a wider spacing — never a shrunk picture. The
// dither and the shadow's grain stay on the screen pixel, where a dither
// belongs; everything about the body itself stays in cloud units.
uniform float u_scale;

uniform vec3 u_lobes[${MAX_LOBES}];      // x, y, radius
uniform vec3 u_lobeEnds[${MAX_LOBES}];   // toX, toY, 1 when a capsule
uniform int u_lobeCount;
uniform float u_weld;

uniform int u_warpOn;
uniform vec2 u_warpAmplitude;
uniform float u_warpScale;
uniform float u_warpDrift;
uniform int u_warpSeed;
uniform int u_warpOctaves;

uniform vec3 u_ramp[${MAX_RAMP}];
uniform int u_rampSteps;

uniform vec2 u_light;
uniform float u_ambient;
uniform float u_occlusion;
uniform float u_normalEpsilon;
uniform int u_flat;
uniform int u_dither;

// The fire, sampled from a texture the CPU automaton fills in (burnable.ts).
uniform int u_heatOn;
uniform sampler2D u_heat;
uniform vec2 u_heatOrigin;
uniform vec2 u_heatSize;
uniform float u_heatCell;
uniform vec3 u_emberRamp[${MAX_RAMP}];
uniform int u_emberSteps;
uniform vec3 u_charColor;
uniform int u_heatFlicker;

// The shadow pass: same field, read backwards from the ground.
uniform int u_shadowOn;
uniform float u_shadowSpread;
uniform float u_shadowSlope;
uniform float u_shadowSquash;
uniform float u_shadowSoftness;
uniform int u_shadowSeed;

// --- transforms.ts: pixelHash -------------------------------------------------
// Exactly the CPU hash. Math.imul is a wrapping 32-bit multiply, which is what
// uint multiplication is; >>> is uint >>; ^ and << are bit-identical.
float pixelHash(int x, int y, int seed, int salt) {
  uint h = uint(x) ^ (uint(y) << 16) ^ uint(seed) ^ (uint(salt) * 0x9e3779b9u);
  h = h * 0x27d4eb2du;
  h ^= h >> 15;
  h = h * 0x85ebca6bu;
  h ^= h >> 13;
  return float(h) / 4294967295.0;
}

// --- procgen/noise.ts ---------------------------------------------------------
float fade(float t) { return t * t * (3.0 - 2.0 * t); }

float valueNoise2(vec2 p, int seed) {
  int ix = int(floor(p.x));
  int iy = int(floor(p.y));
  float fx = fade(p.x - float(ix));
  float fy = fade(p.y - float(iy));
  float c00 = pixelHash(ix, iy, seed, 0);
  float c10 = pixelHash(ix + 1, iy, seed, 0);
  float c01 = pixelHash(ix, iy + 1, seed, 0);
  float c11 = pixelHash(ix + 1, iy + 1, seed, 0);
  return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
}

float valueNoise3(vec3 p, int seed) {
  int iz = int(floor(p.z));
  float fz = fade(p.z - float(iz));
  int lowerSeed = int(uint(seed) ^ (uint(iz) * 0x9e3779b9u));
  int upperSeed = int(uint(seed) ^ (uint(iz + 1) * 0x9e3779b9u));
  return mix(valueNoise2(p.xy, lowerSeed), valueNoise2(p.xy, upperSeed), fz);
}

// The default lacunarity (2) and gain (0.5) only: every caller in the game uses
// the defaults, and a uniform for each would be two more things to keep in step.
float fbm3(vec3 p, int seed, int octaves) {
  float sum = 0.0;
  float amplitude = 1.0;
  float total = 0.0;
  float frequency = 1.0;
  for (int octave = 0; octave < ${MAX_OCTAVES}; octave++) {
    if (octave >= octaves) { break; }
    sum += amplitude * valueNoise3(p * frequency, seed + octave * 101);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total == 0.0 ? 0.0 : sum / total;
}

// --- procgen/sdf.ts + volume.ts ----------------------------------------------
float volumeField(vec2 at) {
  vec2 p = at;
  if (u_warpOn == 1) {
    vec3 base = vec3(at / u_warpScale, u_warpDrift);
    float dx = (fbm3(base, u_warpSeed, u_warpOctaves) - 0.5) * u_warpAmplitude.x;
    float dy = (fbm3(base + vec3(11.0, -7.0, 0.0), u_warpSeed + 91, u_warpOctaves) - 0.5)
      * u_warpAmplitude.y;
    p = at - vec2(dx, dy);
  }

  float best = 1e9;
  for (int index = 0; index < ${MAX_LOBES}; index++) {
    if (index >= u_lobeCount) { break; }
    vec3 lobe = u_lobes[index];
    vec3 end = u_lobeEnds[index];
    float d;
    if (end.z == 1.0) {
      // sdCapsule: distance to the segment, clamped to its ends.
      vec2 seg = end.xy - lobe.xy;
      vec2 rel = p - lobe.xy;
      float lengthSquared = dot(seg, seg);
      float t = lengthSquared == 0.0 ? 0.0 : clamp(dot(rel, seg) / lengthSquared, 0.0, 1.0);
      d = length(rel - seg * t) - lobe.z;
    } else {
      d = length(p - lobe.xy) - lobe.z;
    }
    if (index == 0) {
      best = d;
    } else if (u_weld <= 0.0) {
      best = min(best, d);
    } else {
      float h = clamp(0.5 + (0.5 * (d - best)) / u_weld, 0.0, 1.0);
      best = d + (best - d) * h - u_weld * h * (1.0 - h);
    }
  }
  return best;
}

vec2 fieldNormal(vec2 at, float epsilon) {
  float nx = volumeField(at + vec2(epsilon, 0.0)) - volumeField(at - vec2(epsilon, 0.0));
  float ny = volumeField(at + vec2(0.0, epsilon)) - volumeField(at - vec2(0.0, epsilon));
  float len = length(vec2(nx, ny));
  return len == 0.0 ? vec2(0.0) : vec2(nx, ny) / len;
}

// --- shading.ts: the 4x4 Bayer matrix, as (value + 0.5) / 16 -----------------
float ditherThreshold(int x, int y) {
  int bayer[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  int col = ((x % 4) + 4) % 4;
  int row = ((y % 4) + 4) % 4;
  return (float(bayer[row * 4 + col]) + 0.5) / 16.0;
}

vec3 rampInk(float level, int x, int y) {
  float scaled = clamp(level, 0.0, 1.0) * float(u_rampSteps - 1);
  float base = floor(scaled);
  int index;
  if (u_dither == 1) {
    index = int(base) + ((scaled - base) > ditherThreshold(x, y) ? 1 : 0);
  } else {
    index = int(floor(scaled + 0.5));
  }
  index = clamp(index, 0, u_rampSteps - 1);
  return u_ramp[index];
}

// --- burnable.ts: emberInk ----------------------------------------------------
// A second ramp walk rather than a parameter on the first, because GLSL cannot
// pass an array to a function. The level mapping is the CPU's exactly: heat is
// kept off the top of the ramp so the body of a fire is orange and only a
// scatter of pixels reaches white.
vec3 emberInk(float heat, int x, int y) {
  float jitter = pixelHash(x, y, u_heatFlicker, 4) * 0.28;
  float level = clamp(0.18 + heat * 0.42 + jitter, 0.0, 1.0);
  float scaled = level * float(u_emberSteps - 1);
  float base = floor(scaled);
  int index = int(base) + ((scaled - base) > ditherThreshold(x, y) ? 1 : 0);
  return u_emberRamp[clamp(index, 0, u_emberSteps - 1)];
}

/**
 * Re-ink a pixel from the fire crawling over it, or leave it as it was.
 *
 * One texel per cell, sampled NEAREST, so a pixel takes the state of the cell it
 * falls in — the same lookup burnInk does on the CPU, with a texture standing in
 * for the map.
 */
vec3 burnt(vec3 colour, vec2 at, int x, int y) {
  if (u_heatOn == 0) {
    return colour;
  }
  vec2 cell = floor((at - u_heatOrigin) / u_heatCell);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= u_heatSize.x || cell.y >= u_heatSize.y) {
    return colour;
  }
  vec4 state = texture(u_heat, (cell + 0.5) / u_heatSize);
  if (state.r > 0.34) {
    return emberInk(state.r, x, y);
  }
  // Char is a dark ink, never the background: drawing a burnt body in the
  // void ink deletes it rather than blackening it.
  return state.g > 0.5 ? u_charColor : colour;
}

// The flat path: directionalLevel over the box, exactly as shading.ts computes it.
float acrossBox(vec2 at) {
  vec2 unit = length(u_light) == 0.0 ? vec2(0.0) : normalize(u_light);
  vec2 lo = u_clipRect.xy;
  vec2 hi = u_clipRect.zw;
  float a = unit.x * lo.x + unit.y * lo.y;
  float b = unit.x * hi.x + unit.y * lo.y;
  float c = unit.x * lo.x + unit.y * hi.y;
  float d = unit.x * hi.x + unit.y * hi.y;
  float low = min(min(a, b), min(c, d));
  float span = max(max(a, b), max(c, d)) - low;
  if (span == 0.0) { return 1.0; }
  return (unit.x * at.x + unit.y * at.y - low) / span;
}

// --- trees/foliage.ts: castShadow, read backwards -----------------------------
// The CPU walks the body and asks where each pixel lands on the ground. A
// fragment shader has to go the other way: this fragment IS a patch of ground,
// so invert the projection and ask which body pixel would have darkened it.
//
// The mapping is one-to-one per row, which is what makes the inversion possible
// at all: every pixel at height h lands on the same ground row, shifted by the
// same amount, so a ground row is one body row moved sideways.
//
// The *rounding* is not one-to-one, though: a shallow sun squashes five or six
// body rows onto one row of ground, and the CPU draws the union of all of them.
// Sampling the middle of that band alone drew a visibly thinner, harder shadow —
// so this walks the band, and a ground pixel is in shadow if any height in it
// is. Four samples is enough at every sun angle the game allows, and a shadow
// pass is cheap next to the body it belongs to.
void castShadow(vec2 ground, ivec2 screen) {
  if (ground.y < 0.0 || u_shadowSpread <= 0.0) {
    discard;
  }
  float perRow = 1.0 / (u_shadowSpread * u_shadowSquash);
  float centre = ground.y / (u_shadowSpread * u_shadowSquash);
  float height = -1.0;
  for (int step = 0; step < 4; step++) {
    float candidate = centre + (float(step) / 3.0 - 0.5) * perRow;
    if (candidate <= 0.0) {
      continue;
    }
    float reach = candidate * u_shadowSpread;
    if (volumeField(vec2(ground.x - reach * u_shadowSlope, -candidate)) <= 0.0) {
      height = candidate;
      break;
    }
  }
  if (height < 0.0) {
    discard;
  }
  // Contact hardening: the further from the foot, the more of the shadow the
  // ordered dither eats, so the edge reads as penumbra rather than as noise.
  int gx = screen.x;
  int gy = screen.y;
  float falloff = min(height / 34.0, 1.0);
  if (falloff * u_shadowSoftness
      > ditherThreshold(gx, gy) * 0.9 + pixelHash(gx, gy, u_shadowSeed, 0) * 0.25) {
    discard;
  }
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}

void main() {
  // From the quad's own texture coordinate rather than gl_FragCoord, so the
  // body does not care where on screen it was placed — which is what lets a
  // Phaser game object draw it anywhere in the world.
  // \`screen\` is the pixel relative to the foot; \`at\` is the cloud point it
  // samples. They are the same numbers in the field, and diverge on the roll.
  vec2 screen = u_boxOrigin + floor(outTexCoord * u_viewport);
  vec2 at = screen / u_scale;
  if (at.x < u_clipRect.x || at.y < u_clipRect.y || at.x > u_clipRect.z || at.y > u_clipRect.w) {
    discard;
  }
  int px = int(screen.x);
  int py = int(screen.y);

  if (u_shadowOn == 1) {
    castShadow(at, ivec2(px, py));
    return;
  }

  float distance = volumeField(at);
  if (distance > 0.0) {
    discard;
  }

  float facing;
  if (u_flat == 1) {
    facing = acrossBox(at);
  } else {
    vec2 unit = length(u_light) == 0.0 ? vec2(0.0) : normalize(u_light);
    vec2 normal = fieldNormal(at, u_normalEpsilon);
    facing = (normal.x * unit.x + normal.y * unit.y + 1.0) / 2.0;
  }

  float buried = min(1.0, -distance * u_occlusion);
  float level = clamp(u_ambient + (1.0 - u_ambient) * facing - buried, 0.0, 1.0);
  fragColor = vec4(burnt(rampInk(level, px, py), at, px, py), 1.0);
}
`;

/**
 * Uniform names the shader declares, in source order.
 *
 * Exported so a test can assert the packer sets exactly these. A misspelled
 * uniform is silently ignored by `getUniformLocation`, which makes it one of
 * the few shader bugs that produces a plausible-looking wrong picture rather
 * than a compile error — and the one most worth catching without a GPU.
 */
export function declaredUniforms(source = VOLUME_FRAGMENT_SHADER): string[] {
  const names: string[] = [];
  for (const line of source.split("\n")) {
    const match = /^uniform\s+\w+\s+(\w+)/.exec(line.trim());
    if (match?.[1] !== undefined) {
      names.push(match[1]);
    }
  }
  return names;
}
