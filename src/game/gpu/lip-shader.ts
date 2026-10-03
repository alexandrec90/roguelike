/**
 * The horizon lip in one pass: every pixel of `rollGroundPixels`, on the GPU.
 *
 * Line for line it is `WorldTexels.write` in `roll-ground.ts`, from the tables
 * `lip-gpu-data.ts` builds: which world texel the pixel reads, its tile's
 * texel or its cell's far colour, the puddle over it, the grass over that, and
 * the haze. Every step rounds to a byte where the CPU stores into a
 * `Uint8ClampedArray` - half to even, as that does - so the two agree pixel for
 * pixel but for float rounding at the odd exact half.
 *
 * The grass is the one part done differently. The CPU stamps each cell's tufts
 * into an overlay, nearer rows after farther ones and left to right, then reads
 * the overlay; this reads the same tufts straight from the tuft atlas and keeps
 * the last that covers the texel, in the same order.
 */

import { TUFT_FRAME, BEND_LEVELS } from "../ground/tufts";
import { HAZE_STEPS } from "../roll-ground";
import { MAX_WATER_ALPHAS } from "../roll-water";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { TUFTS_PER_CELL } from "../lip-gpu-data";
import { LANDFORM_COMMON } from "./landform-glsl";

export const LIP_FRAGMENT_SHADER = `${LANDFORM_COMMON}
uniform highp sampler2D u_lines;      // MAX_LINES x 2: (gy, 1/scale, fog, distant), (tufted, y, 0, 0)
uniform highp sampler2D u_cells;      // per lip cell: (tile slot, far code + 1, water slot, 0)
uniform highp sampler2D u_pages;      // 16 x 12 pages, bytes
uniform highp sampler2D u_tufts;      // per grass cell, ${TUFTS_PER_CELL} of (frame + 1, dx, dy, 0)
uniform highp sampler2D u_tuftAtlas;  // shapes down, bends across, bytes

uniform vec2 u_size;          // width, scanlines
uniform vec2 u_frame;         // footX, scroll x
uniform vec4 u_cellBounds;    // min x, min y, width, height
uniform vec4 u_tuftBounds;    // min x, min y, max x, max y
uniform float u_pageColumns;
uniform vec3 u_far[2];        // grass, dirt; 0..255
uniform vec3 u_haze;          // 0..255, already divided by the ambient
uniform float u_alphas[${MAX_WATER_ALPHAS}];

out vec4 fragColor;

const int TW = ${TILE_WIDTH};
const int TD = ${TILE_DEPTH};
const int TUFT_W = ${TUFT_FRAME.width};
const int TUFT_H = ${TUFT_FRAME.height};
const int TUFT_OX = ${TUFT_FRAME.originX};
const int TUFT_OY = ${TUFT_FRAME.originY};
const int BENDS = ${BEND_LEVELS};
const int PER_CELL = ${TUFTS_PER_CELL};
const float HAZE_STEPS = ${HAZE_STEPS.toFixed(1)};

int floorDiv(int a, int b) { return int(floor(float(a) / float(b))); }

vec4 cellAt(int cx, int cy) {
  int x = cx - int(u_cellBounds.x);
  int y = cy - int(u_cellBounds.y);
  if (x < 0 || y < 0 || x >= int(u_cellBounds.z) || y >= int(u_cellBounds.w)) return vec4(0.0);
  return texelFetch(u_cells, ivec2(x, y), 0);
}

// A page texel, 0..255 per channel.
vec4 pageAt(float slot, int column, int row) {
  int s = int(slot + 0.5);
  int columns = int(u_pageColumns);
  return texelFetch(u_pages, ivec2((s % columns) * TW + column, (s / columns) * TD + row), 0) * 255.0;
}

// The grass at a world texel, 0..255 with alpha, or zero: the last tuft that
// covers it, in the order the CPU overlay stamps them.
vec4 grassAt(int gx, int gy, int cx, int cy) {
  int minX = int(u_tuftBounds.x);
  int minY = int(u_tuftBounds.y);
  int maxX = int(u_tuftBounds.z);
  int maxY = int(u_tuftBounds.w);
  if (gx < minX * TW || gx >= (maxX + 1) * TW || gy < minY * TD || gy >= (maxY + 1) * TD) return vec4(0.0);
  vec4 hit = vec4(0.0);
  for (int dy = 0; dy >= -1; dy -= 1) {
    int ty = cy + dy;
    if (ty < minY || ty > maxY) continue;
    for (int dx = -1; dx <= 1; dx += 1) {
      int tx = cx + dx;
      if (tx < minX || tx > maxX) continue;
      for (int k = 0; k < PER_CELL; k += 1) {
        vec4 tuft = texelFetch(u_tufts, ivec2((tx - minX) * PER_CELL + k, ty - minY), 0);
        if (tuft.x < 0.5) break;
        int frame = int(tuft.x + 0.5) - 1;
        int u = TUFT_OX + gx - tx * TW - int(tuft.y);
        int v = TUFT_OY + ty * TD + (TD - 1) - int(tuft.z) - gy;
        if (u < 0 || v < 0 || u >= TUFT_W || v >= TUFT_H) continue;
        vec4 pixel = texelFetch(u_tuftAtlas, ivec2((frame % BENDS) * TUFT_W + u, (frame / BENDS) * TUFT_H + v), 0);
        if (pixel.a > 0.0) hit = pixel * 255.0;
      }
    }
  }
  return hit;
}

void main() {
  int x = int(gl_FragCoord.x);
  int line = int(u_size.y) - 1 - int(gl_FragCoord.y);
  vec4 a = texelFetch(u_lines, ivec2(line, 0), 0);
  vec4 b = texelFetch(u_lines, ivec2(line, 1), 0);
  int gy = int(a.x);
  int y = int(b.y);
  int gx = int(floor((float(x) + 0.5 - u_frame.x) * a.y + float(TW / 2))) - int(u_frame.y);
  int cx = floorDiv(gx, TW);
  int cy = floorDiv(gy, TD);
  vec4 cell = cellAt(cx, cy);

  bool blurred = a.w > 0.0 && a.w > bayer(x + 2, y + 1);
  vec3 rgb;
  if (blurred) {
    rgb = u_far[int(cell.y + 0.5) == 2 ? 1 : 0];
  } else {
    rgb = pageAt(cell.x, gx - cx * TW, (TD - 1) - (gy - cy * TD)).rgb;
  }

  bool drowned = false;
  if (cell.z > 0.5) {
    vec4 water = pageAt(cell.z, gx - cx * TW, gy - cy * TD);
    int code = int(water.a + 0.5);
    if (code != 0) {
      float alpha = u_alphas[(code & 127) - 1];
      rgb = roundEven(water.rgb * alpha + rgb * (1.0 - alpha));
      drowned = code >= 128;
    }
  }

  if (b.x > 0.5 && !blurred && !drowned) {
    vec4 grass = grassAt(gx, gy, cx, cy);
    if (grass.a > 0.0) rgb = roundEven(rgb + ((grass.rgb - rgb) * grass.a) / 255.0);
  }

  float level = a.z * HAZE_STEPS;
  if (level >= 1.0 / 16.0) {
    float step = floor(level) + (level - floor(level) > bayer(x, y) ? 1.0 : 0.0);
    if (step > 0.0) rgb = roundEven(rgb + (u_haze - rgb) * (step / HAZE_STEPS));
  }
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, 1.0);
}
`;
