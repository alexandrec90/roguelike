/**
 * The landform march, as GLSL ES 3.00 passes: a port of `landform-march.ts`
 * and `landform-colour.ts`, whose shared code is `landform-glsl.ts`.
 *
 * **A port, not a reimplementation** - the rule `volume-shader.ts` keeps. The
 * schedule of depths is the CPU's (`marchSchedule`), handed over as texels, so
 * both walk the very same steps.
 *
 * **Three march passes, because the CPU's march is a column scan.** The
 * painter walks each screen column near to far, keeping the highest scanline
 * painted so far (`lowest`). Re-walking that scan for every pixel - the first
 * version of this - cost 25 ms on the HD 530 the budget is held to: a pixel
 * high in a mountain's column walked three hundred steps to learn it was sky.
 * But which step paints a pixel needs less than the scan:
 *
 * - a step can only lower `lowest` to its own top, `to`, and only when that
 *   top is above its own ground and the horizon line - so `lowest` before step
 *   k is the running minimum of those tops (`t'`), whatever came before;
 * - so the step that paints pixel y is the **first** whose `t'` is at or
 *   above it, and it paints it if y is still above that step's ground.
 *
 * So: **probe** one texel per (column, step) - that step's `t'`, a byte; take
 * **blocks** of sixteen steps' minimum; and the **pixel** pass skips whole
 * blocks to the one holding its painter, finds it, and re-probes just that
 * step (and the one before it, for whether the land rose there as a face) to
 * colour it. Exact to the CPU's own rules, at a few dozen fetches a pixel.
 *
 * What still differs: float32 here against float64 there. A level landing
 * within a hair of a ramp step or a Bayer threshold can resolve the other way,
 * so parity is by eye, single pixels on dither seams - the volume shader's
 * terms. Seeds are 24-bit, so `sin(x + seed)` is handed `seed mod 2π` worked
 * out in float64, or float32 would lose the angle.
 *
 * Then the **outline**, once over the frame, and the **pack**: each group of
 * rows' pixels copied into its own band of an atlas that the slice images
 * crop from.
 */

import { BLOCK_STEPS } from "../landform-gpu-data";
import { LANDFORM_COLOUR_LIBRARY, LANDFORM_COMMON, LANDFORM_MARCH_LIBRARY } from "./landform-glsl";

/** Pass 1: one texel per (column, step) - the step's `t'`, as a byte. */
export const LANDFORM_PROBE_SHADER = `${LANDFORM_MARCH_LIBRARY}
void main() {
  int x = int(gl_FragCoord.x);
  int k = int(gl_FragCoord.y);
  vec4 bounds = texelFetch(u_columns, ivec2(x, 0), 0);
  float top = NO_TOP;
  if (k < u_stepCount && float(k) >= bounds.x && float(k) <= bounds.y) {
    top = topOf(k, probe(k, x, 1e9, int(bounds.w)).x);
  }
  fragColor = vec4(top / 255.0, 0.0, 0.0, 1.0);
}
`;

/** Pass 2: the least `t'` of each block of steps, per column. */
export const LANDFORM_BLOCK_SHADER = `${LANDFORM_COMMON}
uniform highp sampler2D u_tops;
out vec4 fragColor;
void main() {
  int x = int(gl_FragCoord.x);
  int block = int(gl_FragCoord.y);
  float least = 1.0;
  for (int j = 0; j < ${BLOCK_STEPS}; j += 1) {
    least = min(least, texelFetch(u_tops, ivec2(x, block * ${BLOCK_STEPS} + j), 0).r);
  }
  fragColor = vec4(least, 0.0, 0.0, 1.0);
}
`;

/** Pass 3: one texel per screen pixel - colour, and the depth row in alpha. */
export const LANDFORM_MARCH_SHADER = `${LANDFORM_MARCH_LIBRARY}${LANDFORM_COLOUR_LIBRARY}
void main() {
  int x = int(gl_FragCoord.x);
  int y = int(u_size.y) - 1 - int(gl_FragCoord.y);
  float fy = float(y);
  vec4 bounds = texelFetch(u_columns, ivec2(x, 0), 0);
  if (fy < bounds.z || bounds.y < bounds.x) {
    fragColor = vec4(0.0);
    return;
  }
  int first = int(bounds.x);
  int last = min(int(bounds.y), u_stepCount - 1);
  int columnMask = int(bounds.w);

  // The first step whose top reaches this pixel, skipping whole blocks.
  int painter = -1;
  float before = NO_TOP;   // least t' over the blocks already passed
  for (int block = first / ${BLOCK_STEPS}; block <= last / ${BLOCK_STEPS}; block += 1) {
    float least = floor(texelFetch(u_blocks, ivec2(x, block), 0).r * 255.0 + 0.5);
    if (least > fy) {
      before = min(before, least);
      continue;
    }
    for (int j = block * ${BLOCK_STEPS}; j < (block + 1) * ${BLOCK_STEPS}; j += 1) {
      if (topAt(x, j) <= fy) {
        painter = j;
        break;
      }
    }
    break;
  }
  if (painter < 0) {
    fragColor = vec4(0.0);
    return;
  }
  vec4 a = stepTexel(painter * 2);
  vec4 b = stepTexel(painter * 2 + 1);
  float ground = a.y;
  float scale = a.z;
  float clipY = a.w;
  if (fy >= min(floor(ground + 0.5), floor(clipY + 0.5))) {
    fragColor = vec4(0.0);
    return;
  }
  float row = b.y;
  if (cutAway(x, y, row)) {
    fragColor = vec4(0.0);
    return;
  }

  vec4 hit = probe(painter, x, 1e9, columnMask);
  float tallest = hit.x;
  int v = int(hit.y);
  float top = ground - tallest * scale;
  // Whether the land rose here as a face: the CPU's 'last step found land, and
  // this one is not more than three scanlines taller'. The step before is
  // probed with the column as it stood then - the least top before it.
  bool rising = true;
  if (painter - 1 >= first) {
    int blockStart = (painter / ${BLOCK_STEPS}) * ${BLOCK_STEPS};
    float lowestThen = min(min(before, leastTop(x, max(blockStart, first), painter - 2)), u_size.y);
    if (painter - 1 < blockStart) {
      // The step before opens no block of its own: rebuild the least top
      // without it from the block it ends.
      int previous = blockStart - ${BLOCK_STEPS};
      lowestThen = min(u_size.y, leastTop(x, max(previous, first), painter - 2));
      for (int earlier = first / ${BLOCK_STEPS}; earlier < previous / ${BLOCK_STEPS}; earlier += 1) {
        lowestThen = min(lowestThen, floor(texelFetch(u_blocks, ivec2(x, earlier), 0).r * 255.0 + 0.5));
      }
    }
    vec4 prior = probe(painter - 1, x, lowestThen, columnMask);
    if (prior.x >= 0.5) {
      float priorRise = prior.x * stepTexel((painter - 1) * 2).z;
      rising = tallest * scale > priorRise + 3.0;
    }
  }

  float halfSide = u_viewA[v].z;
  float res = u_viewA[v].w;
  int size = int(u_viewB[v].z);
  int si = int(floor((hit.z + halfSide) * res + 0.5));
  int sj = int(floor((hit.w + halfSide) * res + 0.5));
  float nx = 0.0;
  float ny = 0.0;
  float detail = 0.0;
  int material = GRASS;
  if (si >= 0 && sj >= 0 && si < size && sj < size) {
    vec4 texel = fieldTexel(v, si, sj);
    nx = texel.g;
    ny = texel.b;
    material = int(floor(texel.a / 4.0));
    detail = texel.a - float(material) * 4.0 - 2.0;
  }
  float facing = (nx * u_turn.x - ny * u_turn.y) * u_light.x +
    (nx * u_turn.y + ny * u_turn.x) * u_light.y +
    sqrt(max(0.0, 1.0 - nx * nx - ny * ny)) * u_light.z;
  float crag = int(u_viewC[v].x) == 3 ? 0.03 : 0.11;
  float level = wrapLevel(facing) + detail * crag;

  vec3 rgb;
  if (!rising && material != CLIFF) {
    rgb = stepOf(material, tallest < 3.0 ? level * 0.55 : level, x, y);
  } else {
    float around = mod(atan(hit.w, hit.z) / PI2 + 1.0, 1.0);
    float wander = sin(hit.z * 1.7 + u_viewE[v].x) * 2.2 + cos(hit.w * 1.3) * 1.6;
    float z = tallest - max(0.0, fy + 0.5 - top) / scale;
    bool wall = rising && z < tallest - 2.0;
    int face = wall ? wallMaterial(v, z) : material;
    rgb = colourOf(v, face, z, z < 3.0 ? level * 0.55 : level, wall, around, wander, x, y);
  }

  float shade = u_viewD[v].z > 0.5 ? 1.0 : cloudAt(x, int(floor(ground + 0.5)));
  vec3 lit = clamp(roundEven(rgb * shade), 0.0, 255.0);
  float haze = b.x * HAZE_STEPS;
  if (haze >= 1.0 / 16.0) {
    float stepped = floor(haze) + (haze - floor(haze) > bayer(x, y) ? 1.0 : 0.0);
    if (stepped > 0.0) {
      lit = clamp(roundEven(lit + (u_haze - lit) * (stepped / HAZE_STEPS)), 0.0, 255.0);
    }
  }
  float code = clamp(row - u_rowBase + 1.0, 1.0, 255.0);
  fragColor = vec4(lit / 255.0, code / 255.0);
}
`;

/**
 * Pass 4: the silhouette lined, as `outlineLandforms` does - a pixel whose
 * neighbour above or to either side is sky, field, or a surface some rows
 * behind it is darkened. Once over the frame, so a slice need not look at
 * its neighbours.
 */
export const LANDFORM_OUTLINE_SHADER = `${LANDFORM_COMMON}
uniform highp sampler2D u_march;
uniform vec2 u_size;
out vec4 fragColor;

const float OUTLINE = 0.62;
const float EDGE_ROWS = 3.0;
const float NONE = -100000.0;

float codeAt(ivec2 p) {
  float code = floor(texelFetch(u_march, p, 0).a * 255.0 + 0.5);
  return code < 0.5 ? NONE : code;
}

void main() {
  // Framebuffer rows: y up, so the pixel 'above' on screen is +1 here.
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 texel = texelFetch(u_march, p, 0);
  float code = floor(texel.a * 255.0 + 0.5);
  if (code < 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  float behind = code - EDGE_ROWS;
  float up = p.y < int(u_size.y) - 1 ? codeAt(p + ivec2(0, 1)) : NONE;
  float left = p.x > 0 ? codeAt(p + ivec2(-1, 0)) : code;
  float right = p.x < int(u_size.x) - 1 ? codeAt(p + ivec2(1, 0)) : code;
  vec3 rgb = texel.rgb;
  if (up < behind || left < behind || right < behind) {
    rgb = roundEven(rgb * 255.0 * OUTLINE) / 255.0;
  }
  fragColor = vec4(rgb, texel.a);
}
`;

/**
 * Pass 5: the slices, packed. Each group of rows gets a band of the atlas as
 * tall as its rectangle and as wide as the screen, holding only its own rows'
 * pixels - so the display list draws each slice as a plain image cropped from
 * here, batched with the sprites, rather than as a shader of its own. (A
 * shader per slice was the first version: each one broke the sprite batch and
 * cost 2.3 ms of CPU between them.)
 *
 * `u_bands` says, for each band row, which screen row it copies and which
 * row codes it keeps: `(screen y, lowest code, highest code, 1)`, or zeros for
 * a row no band uses - which returns at once, so the atlas's unused rows cost
 * little. The image a slice shows has the framebuffer's bottom row last, so
 * band row 0 is framebuffer row `u_atlasRows - 1`.
 */
export const LANDFORM_PACK_SHADER = `${LANDFORM_COMMON}
uniform highp sampler2D u_lined;
uniform highp sampler2D u_bands;
uniform vec2 u_size;    // the picture's size
uniform float u_atlasRows;
out vec4 fragColor;

void main() {
  int x = int(gl_FragCoord.x);
  int row = int(u_atlasRows) - 1 - int(gl_FragCoord.y);
  vec4 band = texelFetch(u_bands, ivec2(row % 256, row / 256), 0);
  if (band.w < 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  vec4 texel = texelFetch(u_lined, ivec2(x, int(u_size.y) - 1 - int(band.x)), 0);
  float code = floor(texel.a * 255.0 + 0.5);
  fragColor = code < band.y || code > band.z ? vec4(0.0) : vec4(texel.rgb, 1.0);
}
`;
