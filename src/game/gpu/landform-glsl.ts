/**
 * The GLSL the landform passes share: the vertex stage, the inputs and the one
 * probe every pass walks the schedule with (`LANDFORM_MARCH_LIBRARY`), and the
 * look - ramps, grain, strata, windows, the cutaway and the cloud shade - that
 * colours a painted pixel (`LANDFORM_COLOUR_LIBRARY`).
 *
 * Each function here mirrors one in `landform-march.ts` or
 * `landform-colour.ts`, line for line where it can; the passes themselves, and
 * why there are three, are `landform-shader.ts`.
 */

import { RAMPS, SEAM, STRATA, WINDOW } from "../landform-colour";
import { MAX_VIEWS, SCHEDULE_WIDTH } from "../landform-gpu-data";
import { CLIFF, GRASS, ROCK, ROOF, SNOW, WALL } from "../landforms";
import { HAZE_STEPS } from "../roll-ground";
import { BAYER_4X4 } from "../shading";

/** The ramps in one array: materials 0..5, then the cliff's strata as 6. */
const RAMP_LIST = [
  RAMPS[GRASS],
  RAMPS[ROCK],
  RAMPS[SNOW],
  RAMPS[CLIFF],
  RAMPS[WALL],
  RAMPS[ROOF],
  STRATA,
].map((ramp) => ramp ?? []);

/** `vec3` per ramp entry, 0..255, and `(offset, length)` per ramp. */
export const RAMP_COLOURS = new Float32Array(RAMP_LIST.flatMap((ramp) => ramp.flatMap((rgb) => [rgb.r, rgb.g, rgb.b])));
export const RAMP_SPANS = new Float32Array(
  RAMP_LIST.flatMap((ramp, index) => [RAMP_LIST.slice(0, index).reduce((sum, r) => sum + r.length, 0), ramp.length]),
);
export const WINDOW_COLOUR = new Float32Array([WINDOW.r, WINDOW.g, WINDOW.b]);
const RAMP_SIZE = RAMP_COLOURS.length / 3;

const BAYER = BAYER_4X4.flat()
  .map((value) => value.toFixed(6))
  .join(", ");

/** `t'` for a step that cannot lower the column: past any scanline. */
export const NO_TOP = 255;

/**
 * The vertex stage for a shader pass's quad (`engine/pass.ts`): `outTexCoord`
 * with (0, 0) at the quad's top-left. The pass hands the coordinate over with
 * y up; flipped here. The passes themselves read `gl_FragCoord`, where row 0 is
 * the bottom of the target.
 */
export const LANDFORM_VERTEX_SHADER = `#version 300 es
uniform mat4 uProjectionMatrix;
in vec2 inPosition;
in vec2 inTexCoord;
out vec2 outTexCoord;
void main() {
  gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);
  outTexCoord = vec2(inTexCoord.x, 1.0 - inTexCoord.y);
}
`;

/** The version line, precision, the Bayer matrix and JavaScript's `%`: every pass opens with this. */
export const LANDFORM_COMMON = `#version 300 es
precision highp float;
precision highp int;

const float BAYER[16] = float[16](${BAYER});
float bayer(int x, int y) { return BAYER[(y & 3) * 4 + (x & 3)]; }

// JavaScript's %, which keeps the sign of the dividend.
float jsmod(float a, float b) { return a - b * trunc(a / b); }
`;

/** The march's inputs and the one probe every pass shares. */
export const LANDFORM_MARCH_LIBRARY = `${LANDFORM_COMMON}
uniform highp sampler2D u_field;
uniform highp sampler2D u_steps;
uniform highp sampler2D u_columns;  // per column: first step, last step, top, view mask

uniform vec2 u_size;
uniform vec4 u_frame;      // footX, footY, phaseX, phaseY
uniform int u_stepCount;
uniform vec4 u_viewA[${MAX_VIEWS}];   // centre x, centre y, half, res
uniform vec4 u_viewB[${MAX_VIEWS}];   // atlas x, atlas y, size, peak
uniform vec4 u_viewC[${MAX_VIEWS}];   // kind, radius, height, seed
uniform vec4 u_viewD[${MAX_VIEWS}];   // blocks, roofed, far, 0
uniform vec2 u_turn;       // cos, sin of the pose's turn

out vec4 fragColor;

const float NO_TOP = ${NO_TOP.toFixed(1)};

vec4 stepTexel(int index) {
  return texelFetch(u_steps, ivec2(index % ${SCHEDULE_WIDTH}, index / ${SCHEDULE_WIDTH}), 0);
}

vec4 fieldTexel(int v, int i, int j) {
  return texelFetch(u_field, ivec2(int(u_viewB[v].x) + i, int(u_viewB[v].y) + j), 0);
}

float fieldBound(int v, float dx, float dy) {
  float halfSide = u_viewA[v].z;
  int blocks = int(u_viewD[v].x);
  int bi = int(floor(dx + halfSide));
  int bj = int(floor(dy + halfSide));
  if (bi < 0 || bj < 0 || bi >= blocks || bj >= blocks) return 0.0;
  return texelFetch(u_field, ivec2(int(u_viewB[v].x) + int(u_viewB[v].z) + bi, int(u_viewB[v].y) + bj), 0).r;
}

float fieldHeight(int v, float dx, float dy) {
  float halfSide = u_viewA[v].z;
  float res = u_viewA[v].w;
  float size = u_viewB[v].z;
  float u = (dx + halfSide) * res;
  float w = (dy + halfSide) * res;
  if (u < 0.0 || w < 0.0 || u >= size - 1.0 || w >= size - 1.0) return 0.0;
  int i = int(floor(u));
  int j = int(floor(w));
  float fu = u - float(i);
  float fv = w - float(j);
  float h00 = fieldTexel(v, i, j).r;
  float h10 = fieldTexel(v, i + 1, j).r;
  float h01 = fieldTexel(v, i, j + 1).r;
  float h11 = fieldTexel(v, i + 1, j + 1).r;
  float nearH = h00 + (h10 - h00) * fu;
  float farH = h01 + (h11 - h01) * fu;
  return nearH + (farH - nearH) * fv;
}

// The tallest land at column x and step k: (height, view, planet x, planet y).
// 'lowest' is the column's highest painted scanline so far, for the CPU's own
// skips; pass a huge value to probe without them.
vec4 probe(int k, int x, float lowest, int columnMask) {
  vec4 a = stepTexel(k * 2);
  vec4 b = stepTexel(k * 2 + 1);
  float depth = a.x;
  float ground = a.y;
  float scale = a.z;
  float across = 16.0 * scale;
  float column = float(x) + 0.5;
  int mask = int(b.z) & columnMask;
  vec4 best = vec4(0.0, -1.0, 0.0, 0.0);
  for (int v = 0; v < ${MAX_VIEWS}; v += 1) {
    if (((mask >> v) & 1) == 0) continue;
    float reachTop = max(ground - u_viewB[v].w * scale, b.w);
    if (reachTop >= u_size.y) continue;
    float centre = u_frame.x + (u_viewA[v].x - u_frame.z) * across;
    float dy = depth - u_viewA[v].y;
    float outer = u_viewC[v].y + 1.0;
    float chord = sqrt(max(0.0, outer * outer - dy * dy));
    float left = max(0.0, floor(centre - chord * across));
    float right = min(u_size.x - 1.0, ceil(centre + chord * across));
    if (float(x) < left || float(x) > right) continue;
    if (lowest <= reachTop) continue;
    float dx = (column - u_frame.x) / across + u_frame.z - u_viewA[v].x;
    float px = dx * u_turn.x + dy * u_turn.y;
    float py = -dx * u_turn.y + dy * u_turn.x;
    float bound = fieldBound(v, px, py);
    if (bound < 0.5 || ground - bound * scale >= lowest) continue;
    float h = fieldHeight(v, px, py);
    if (h > best.x) best = vec4(h, float(v), px, py);
  }
  return best;
}

// t' for a step: the scanline it can lower the column to, or NO_TOP.
float topOf(int k, float h) {
  if (h < 0.5) return NO_TOP;
  vec4 a = stepTexel(k * 2);
  float to = max(floor(a.y - h * a.z + 0.5), 0.0);
  float ceiling = min(min(floor(a.y + 0.5), floor(a.w + 0.5)), u_size.y);
  return to < ceiling ? to : NO_TOP;
}
`;

/** What colours a painted pixel: its inputs, and `landform-colour.ts` ported. */
export const LANDFORM_COLOUR_LIBRARY = `
uniform highp sampler2D u_cloud;
uniform highp sampler2D u_tops;
uniform highp sampler2D u_blocks;

uniform vec4 u_viewE[${MAX_VIEWS}];   // seed mod 2pi, seed mod 7, bays, 0
uniform vec3 u_light;      // the light in the camera's frame: x right, y away, z up
uniform vec3 u_haze;       // 0..255, already divided by the ambient
uniform vec4 u_cut;        // x, y, radius x, radius y
uniform vec2 u_cutRow;     // row, 1 when there is a cutaway
uniform vec4 u_shade;      // offset x, offset y, strength, margin
uniform vec2 u_cloudSize;
uniform float u_rowBase;
uniform vec3 u_ramp[${RAMP_SIZE}];
uniform vec2 u_rampSpan[7];
uniform vec3 u_window;

const int GRASS = ${GRASS};
const int ROCK = ${ROCK};
const int SNOW = ${SNOW};
const int CLIFF = ${CLIFF};
const int WALL = ${WALL};
const int ROOF = ${ROOF};
const float SEAM = ${SEAM.toFixed(6)};
const float HAZE_STEPS = ${HAZE_STEPS.toFixed(1)};
const float PI2 = 6.283185307179586;

float topAt(int x, int k) { return floor(texelFetch(u_tops, ivec2(x, k), 0).r * 255.0 + 0.5); }

float wrapLevel(float facing) {
  float index = floor((clamp(facing, -1.0, 1.0) * 0.5 + 0.5) * 256.0 + 0.5);
  return 0.12 + 0.88 * pow(index / 256.0, 1.4);
}

vec3 stepOf(int ramp, float level, int x, int y) {
  int offset = int(u_rampSpan[ramp].x);
  int count = int(u_rampSpan[ramp].y);
  float scaled = clamp(level, 0.0, 1.0) * float(count - 1);
  float base = floor(scaled);
  float blend = (scaled - base - (0.5 - SEAM)) / (2.0 * SEAM);
  int index = int(base);
  if (blend >= 1.0 || (blend > 0.0 && blend > bayer(x, y))) index += 1;
  return u_ramp[offset + min(index, count - 1)];
}

float blockHash(int a, int b, uint seed) {
  uint h = (uint(a) ^ 0x27d4eb2du) * 0x165667b1u ^ (uint(b) ^ seed) * 0x9e3779b1u;
  h ^= h >> 15u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  return float(h) / 4294967296.0;
}

int wallMaterial(int v, float z) {
  int kind = int(u_viewC[v].x);
  float height = u_viewC[v].z;
  if (kind == 0) return z > height * 0.75 ? SNOW : ROCK;
  if (kind == 1) return CLIFF;
  if (kind == 2) return ROCK;
  return z > height + 0.5 && u_viewD[v].y > 0.5 ? ROOF : WALL;
}

float faceGrain(int v, float around01, float z) {
  int kind = int(u_viewC[v].x);
  uint seed = uint(u_viewC[v].w);
  float around = around01 * PI2 * u_viewC[v].y * 16.0;
  if (kind == 3) {
    float course = floor(z / 6.0);
    if (z - course * 6.0 < 1.0) return -0.16;
    float along = around + jsmod(course, 2.0) * 7.0;
    return jsmod(along, 14.0) < 1.0 ? -0.12 : (blockHash(int(floor(along / 14.0)), int(course), seed) - 0.5) * 0.08;
  }
  float ledge = jsmod(z + 4.0 * sin(around / 9.0 + u_viewE[v].x), 13.0);
  if (ledge < 1.2) return -0.18;
  return (blockHash(int(floor(around / 9.0)), int(floor(z / 7.0)), seed) - 0.5) * 0.22;
}

bool isStratum(int v, float z, float wander) {
  float band = (z + wander) / 11.0 + u_viewE[v].y;
  float phase = band - floor(band);
  return jsmod(floor(band), 3.0) == 0.0 && phase < 0.45;
}

bool isWindow(int v, float around01, float z) {
  float height = u_viewC[v].z;
  if (z < 22.0 || z > height - 16.0) return false;
  float around = around01 * u_viewE[v].z;
  float bay = floor(around);
  float across = around - bay;
  float floorAt = (z - 22.0) / 30.0;
  float up = floorAt - floor(floorAt);
  return jsmod(bay, 3.0) == 1.0 && across > 0.25 && across < 0.75 && up > 0.35 && up < 0.8;
}

vec3 colourOf(int v, int material, float z, float level, bool wall, float around, float wander, int x, int y) {
  int kind = int(u_viewC[v].x);
  if (wall && kind == 3 && isWindow(v, around, z)) return u_window;
  float lit = wall ? level + faceGrain(v, around, z) : level;
  if (material == CLIFF && isStratum(v, z, wander)) return stepOf(6, lit * 0.85, x, y);
  if (wall && kind == 0 && z < u_viewC[v].z * 0.7) return stepOf(ROCK, lit, x, y);
  return stepOf(material, lit, x, y);
}

bool cutAway(int x, int y, float row) {
  if (u_cutRow.y < 0.5 || row <= u_cutRow.x) return false;
  float fx = float(x);
  float fy = float(y);
  if (abs(fx - u_cut.x) >= u_cut.z || abs(fy - u_cut.y) >= u_cut.w) return false;
  float dx = (fx - u_cut.x) / u_cut.z;
  float dy = (fy - u_cut.y) / u_cut.w;
  float distance = sqrt(dx * dx + dy * dy);
  if (distance >= 1.0) return false;
  return distance < 0.8 || (1.0 - distance) / 0.2 > bayer(x, y);
}

float cloudAt(int x, int y) {
  if (u_shade.z <= 0.0 || y < 0 || float(y) >= u_size.y) return 1.0;
  int w = int(u_cloudSize.x);
  int h = int(u_cloudSize.y);
  int u = ((x + int(u_shade.w) - int(u_shade.x)) % w + w) % w;
  int t = ((y + int(u_shade.w) - int(u_shade.y)) % h + h) % h;
  float value = texelFetch(u_cloud, ivec2(u, t), 0).r;
  return 1.0 - (1.0 - value) * u_shade.z;
}

// The least t' over steps from..to inclusive, read one at a time.
float leastTop(int x, int from, int to) {
  float least = NO_TOP;
  for (int j = from; j <= to; j += 1) least = min(least, topAt(x, j));
  return least;
}
`;
