/**
 * The sky at the screen's own resolution, in one fragment shader (`?sky=hd`).
 *
 * Drawn by a `ScreenPass` behind the world (`engine/game.ts`), over the rows of
 * the canvas above the horizon line, a pixel of the canvas at a time. Every
 * pixel is divided back down to logical coordinates first, so each term below
 * is the pixel sky's (`sky-paint.ts`) at a finer grid:
 *
 *     gradient   zenith to horizon, continuous - no dithered bands
 *     stars      a hashed lattice on the panorama, each a soft dot a screen pixel or two across
 *     sun, moon  a disc with an antialiased rim, a tight halo and a wide bloom
 *     clouds     the puffs of `sky-clouds.ts`, read from a data texture
 *
 * A cloud is coverage and light from its puffs. Coverage is how far inside the
 * nearest puff's ellipse the pixel is, roughened by noise in the cloud's own
 * frame - so it drifts with the cloud and does not crawl - cut flat at the
 * base, and antialiased over about one screen pixel. The light is the pixel
 * sky's: the surface of the puff the pixel sits highest on, lit from above and
 * the sun's side, darkened toward the base, then ramped smoothly through the
 * three tones instead of dithered between them. Where two puffs meet, the two
 * lights are blended over a short band, which keeps the crease that separates
 * the bumps without cutting it with a hard line.
 *
 * Screen-resolution noise of up to half a level either way goes on last, to
 * break the 8-bit banding a long gradient otherwise shows.
 */

import { PANORAMA_WIDTH } from "../panorama";
import { CLOUD_TEXELS, MAX_CLOUD_PUFFS, MAX_SKY_CLOUDS } from "../sky-hd";
import { FLATTEN } from "../sky-clouds";

const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

export const SKY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec4 u_view;          // device pixels a logical one, canvas height, scroll x, scroll y
uniform vec4 u_band;          // sky scanlines, horizon line, panorama offset, seconds
uniform vec3 u_skyTop;
uniform vec3 u_skyHorizon;
uniform vec3 u_ambient;
uniform vec4 u_sun;          // centre x, centre y, radius, veil
uniform vec4 u_light;         // day, star alpha, sun side, overcast
uniform vec3 u_sunCore;
uniform vec3 u_sunRim;
uniform vec3 u_sunHalo;
uniform vec3 u_shade;
uniform vec3 u_body;
uniform vec3 u_lit;
uniform int u_clouds;
uniform highp sampler2D u_cloudData;   // ${CLOUD_TEXELS} texels a cloud, a cloud a row

out vec4 fragColor;

const float PANORAMA = ${float(PANORAMA_WIDTH)};
const float FLATTEN = ${float(FLATTEN)};
const int MAX_CLOUDS = ${MAX_SKY_CLOUDS};
const int MAX_PUFFS = ${MAX_CLOUD_PUFFS};

// An integer hash: three lattice coordinates, all non-negative, to 0..1.
float hash01(ivec3 cell) {
  uvec3 v = uvec3(cell) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float((v.x ^ v.y ^ v.z) & 0xffffffu) / 16777216.0;
}

float valueNoise(vec2 p, int seed) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(cell);
  float a = hash01(ivec3(c, seed));
  float b = hash01(ivec3(c + ivec2(1, 0), seed));
  float d = hash01(ivec3(c + ivec2(0, 1), seed));
  float e = hash01(ivec3(c + ivec2(1, 1), seed));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

// Three octaves, centred on zero: -0.5..0.5. \`p\` must stay positive.
float fbm(vec2 p, int seed) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 3; octave++) {
    sum += amplitude * valueNoise(p, seed + octave * 7);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum / 0.875 - 0.5;
}

vec3 gradient(float y) {
  float t = clamp(y / max(u_band.x - 1.0, 1.0), 0.0, 1.0);
  return mix(u_skyTop, u_skyHorizon, pow(t, 1.4));
}

// A star a cell of the panorama, at most: 1.5% of cells hold one, a quarter of those bright.
vec3 stars(vec3 col, vec2 p, float scale) {
  float alpha = u_light.y;
  if (alpha <= 0.02 || p.y < 0.0) {
    return col;
  }
  vec2 q = vec2(mod(p.x + u_band.z, PANORAMA), p.y);
  ivec2 cell = ivec2(floor(q));
  if (hash01(ivec3(cell, 11)) >= 0.015) {
    return col;
  }
  vec2 at = vec2(cell) + 0.2 + 0.6 * vec2(hash01(ivec3(cell, 12)), hash01(ivec3(cell, 13)));
  bool bright = hash01(ivec3(cell, 14)) < 0.25;
  float size = bright ? 1.1 : 0.6;
  float spot = 1.0 - smoothstep(size, size + 1.0, length(q - at) * scale);
  float twinkle = 0.65 + 0.35 * sin(u_band.w / 0.7 + hash01(ivec3(cell, 15)) * 6.2832);
  float fade = 1.0 - smoothstep(u_band.x - 5.0, u_band.x - 2.0, p.y);
  vec3 colour = bright ? vec3(0.957, 0.945, 1.0) : vec3(0.604, 0.651, 0.847);
  return mix(col, colour, clamp(spot * alpha * twinkle * fade * (bright ? 1.0 : 0.7), 0.0, 1.0));
}

vec3 sunAndMoon(vec3 col, vec2 p, float scale) {
  vec2 centre = u_sun.xy;
  float radius = u_sun.z;
  float veil = u_sun.w;
  bool day = u_light.x > 0.5;
  float d = distance(p, centre);
  float outside = max(d - radius, 0.0);
  float glow = (exp(-outside / 2.2) * 0.45 + exp(-outside / 10.0) * 0.18) * veil * (day ? 1.0 : 0.55);
  col = mix(col, u_sunHalo, clamp(glow, 0.0, 1.0));
  float aa = 0.8 / scale;
  float disc = 1.0 - smoothstep(radius - aa, radius + aa, d);
  vec3 face = mix(u_sunCore, u_sunRim, smoothstep(radius * 0.55, radius, d));
  if (!day) {
    // The moon is a crescent: its lit side faces where the sun went.
    float shadowed = 1.0 - smoothstep(radius - 0.3 - aa, radius - 0.3 + aa, distance(p, centre + vec2(-1.4, 0.6)));
    face = mix(face, mix(col, u_sunHalo, 0.35), shadowed);
  }
  return mix(col, face, disc * veil);
}

// The pixel sky's light on a puff's surface: from above, the sun's side, and a little toward the viewer.
float puffLight(vec2 n) {
  float nz = sqrt(max(0.0, 1.0 - dot(n, n)));
  return (n.x * u_light.z * 0.5 + n.y * 0.75 + nz * 0.45) / 1.0075;
}

vec3 cloud(vec3 col, vec2 p, float scale, int row) {
  vec4 head = texelFetch(u_cloudData, ivec2(0, row), 0);
  vec4 extent = texelFetch(u_cloudData, ivec2(1, row), 0);
  float dx = p.x - head.x;
  float up = head.y + 1.0 - p.y;
  if (abs(dx) > extent.x + 2.0 || up < -1.0 || up > extent.y + 2.0) {
    return col;
  }
  int puffs = int(head.w);
  float best = -1e9;
  float second = -1e9;
  vec2 nearest = vec2(0.0);
  vec2 behind = vec2(0.0);
  float radius = 1.0;
  for (int k = 0; k < MAX_PUFFS; k++) {
    if (k >= puffs) {
      break;
    }
    vec4 puff = texelFetch(u_cloudData, ivec2(2 + k, row), 0);
    vec2 n = vec2((dx - puff.x) / puff.z, (up - puff.y) / (puff.z * FLATTEN));
    float depth = 1.0 - dot(n, n);
    if (depth > best) {
      second = best;
      behind = nearest;
      best = depth;
      nearest = n;
      radius = puff.z;
    } else if (depth > second) {
      second = depth;
      behind = n;
    }
  }
  // In the cloud's own frame, offset positive for the hash: the noise rides with it.
  vec2 local = vec2(dx + extent.z, up) + 4096.0;
  int seed = int(extent.z);
  // About a logical pixel of signed distance, inside positive, roughened into billows.
  float edge = best * radius * FLATTEN * 0.5 + fbm(local * 0.35, seed) * 0.9;
  float inside = min(edge, up + 0.15);
  float aa = 0.7 / scale + 0.12;
  float cover = smoothstep(-aa, aa, inside) * head.z;
  if (cover <= 0.0) {
    return col;
  }
  float light = mix(puffLight(behind), puffLight(nearest), 0.5 + 0.5 * smoothstep(0.0, 0.12, best - second));
  // The flat base sits in the cloud's own shade, and a sunward rim catches the light.
  light -= (1.0 - smoothstep(0.0, 1.6, up)) * 0.35;
  light += fbm(local * 0.6, seed + 101) * 0.12;
  light += (1.0 - smoothstep(0.0, 0.8, edge)) * max(nearest.x * u_light.z, 0.0) * 0.25;
  vec3 tone = mix(u_shade, u_body, smoothstep(0.10, 0.26, light));
  tone = mix(tone, u_lit, smoothstep(0.60, 0.76, light));
  return mix(col, tone, cover);
}

void main() {
  float scale = u_view.x;
  vec2 p = vec2(gl_FragCoord.x / scale + u_view.z, (u_view.y - gl_FragCoord.y) / scale + u_view.w);
  vec3 col = gradient(p.y);
  col = stars(col, p, scale);
  col = sunAndMoon(col, p, scale);
  for (int row = 0; row < MAX_CLOUDS; row++) {
    if (row >= u_clouds) {
      break;
    }
    col = cloud(col, p, scale, row);
  }
  // The pixel sky is painted divided by the ambient and multiplied back by the
  // lighting pass, which clamps whatever is brighter than the ambient to it:
  // night clouds and the moon are as bright as the moonlight and no brighter.
  col = min(col, u_ambient);
  col +=(hash01(ivec3(ivec2(gl_FragCoord.xy), 7)) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`;
