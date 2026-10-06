/**
 * The window through the land round the hero: the pixel skin's cutaway
 * (`landform-cutaway.ts`, `landform-frame.ts`), for geometry.
 *
 * The camera looks down from behind him, so a mountain's flank between him and
 * the camera is, correctly, in front of him - and he vanishes. The pixel skin
 * leaves out landform pixels nearer than his row inside an oval round him; this
 * skin does the same per fragment: a face of a landform (`Kind.land`) nearer
 * than his foot and inside the oval is discarded, its rim dithered so it reads
 * as a window rather than a hole.
 *
 * Only when nearer land actually rises over his body. Pressed against a face,
 * a mountain's low foot curls round him on the near side - nearer than him,
 * inside the oval, hiding nothing - and a window there is a hole onto nothing.
 * So the probe asks the shared height field whether any land nearer than him,
 * in the columns his body stands in, reaches more than a quarter of his height
 * above his feet. Cutting needs a shader that can discard, which costs the
 * early depth test, so a frame with no window draws the land without one.
 */

import { fieldHeight, landformField, landformsNear, type Landform } from "../../game/landforms";
import { fromLocal, wrapDelta, type PlanetPose } from "../../game/planet";
import { TILE_DEPTH, TILE_WIDTH } from "../../game/projection";
import type { LowpolyView } from "./placement";

/** The oval, in logical pixels, that land nearer than the hero is cut from. */
export interface LowpolyCutaway {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
}

/** The share of his height nearer land must rise over his feet before he counts as hidden. */
const HIDDEN_SHARE = 0.25;

/** The share of his height either side of his centre column that is his body, for the probe. */
const BODY_HALF_WIDTH = 0.25;

/** Rows between probes, nearer than him. */
const PROBE_STEP = 0.25;

/** Columns probed across his body. */
const PROBE_COLUMNS = 5;

/** The tallest a landform stands, logical pixels: nothing further than this many rows nearer can reach him. */
export const TALLEST = 400;

/** The window round the hero at `pose`, or undefined when no land nearer than him stands over him. */
export function heroCutaway(view: LowpolyView, pose: PlanetPose, heroHeight: number): LowpolyCutaway | undefined {
  if (!heroHidden(pose, heroHeight)) {
    return undefined;
  }
  return {
    x: view.footX,
    y: view.footY - heroHeight / 2,
    radiusX: heroHeight * 0.75,
    radiusY: heroHeight * 0.9,
  };
}

/**
 * Whether land nearer than the hero rises over his body in any column he
 * stands in. `near` is the landforms to ask: by default, every one in reach.
 */
export function heroHidden(
  pose: PlanetPose,
  heroHeight: number,
  near: readonly Landform[] = landformsNear(pose, TALLEST / TILE_DEPTH + 1),
): boolean {
  if (near.length === 0) {
    return false;
  }
  const fields = near.map((landform) => ({ x: landform.x, y: landform.y, field: landformField(landform) }));
  const over = heroHeight * HIDDEN_SHARE;
  const half = (heroHeight * BODY_HALF_WIDTH) / TILE_WIDTH;
  // Past this many rows nearer, the tallest of them could not rise to his feet.
  const reachRows = Math.max(...fields.map(({ field }) => field.peak)) / TILE_DEPTH;
  for (let rows = PROBE_STEP; rows <= reachRows; rows += PROBE_STEP) {
    // A point `rows` nearer stands `rows * TILE_DEPTH` below his foot on screen before it rises.
    const needed = over + rows * TILE_DEPTH;
    for (let column = 0; column < PROBE_COLUMNS; column += 1) {
      const across = -half + (2 * half * column) / (PROBE_COLUMNS - 1);
      const point = fromLocal(pose, { x: across, y: -rows });
      for (const { x, y, field } of fields) {
        if (field.peak <= needed) {
          continue;
        }
        const h = fieldHeight(field, wrapDelta(point.x, x), wrapDelta(point.y, y));
        if (h >= 0.5 && h > needed) {
          return true;
        }
      }
    }
  }
  return false;
}
