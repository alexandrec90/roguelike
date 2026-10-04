/**
 * When the hero gets a window through the land, and where it is.
 *
 * The window (`Cutaway`, `landform-frame.ts`) cuts every landform pixel nearer
 * than his row inside an oval round him. That is right when something nearer
 * stands over him, and wrong when nothing does: pressed against a mountain's
 * face, its low foot curls round him on the near side and its flanks come
 * forward beside him - nearer than his row, inside the oval, covering none of
 * him - and the oval was punched out of them, a window onto nothing hidden.
 *
 * So the window opens only when land nearer than him rises over his body: a
 * probe of the same steps the march paints, over the columns he stands in,
 * asking whether any of them reaches more than a quarter of his height above
 * his feet. A bump that hides his ankles hides his ankles; it is not a wall.
 * Both landform layers ask this, so the CPU and GPU pictures agree on it.
 */

import type { CameraFrame } from "./camera";
import type { Cutaway, LandformView } from "./landform-frame";
import type { Step } from "./landform-march";
import { fieldBound, fieldHeight } from "./landforms";
import { rowAtFoot, TILE_WIDTH } from "./projection";

/** The share of his height nearer land must rise over his feet before he counts as hidden. */
const HIDDEN_SHARE = 0.25;

/** The share of his height either side of his centre column that is his body, for the probe. */
const BODY_HALF_WIDTH = 0.25;

/** The window round the hero, or undefined when no land nearer than him stands over him. */
export function heroCutaway(
  frame: CameraFrame,
  views: readonly LandformView[],
  steps: readonly Step[],
  turn: number,
  heroHeight: number,
): Cutaway | undefined {
  const cutaway: Cutaway = {
    x: frame.footX,
    y: frame.footY - heroHeight / 2,
    radiusX: heroHeight * 0.75,
    radiusY: heroHeight * 0.9,
    row: Math.round(rowAtFoot(frame.footY, frame.groundTop)),
  };
  return heroHidden(frame, views, steps, turn, heroHeight, cutaway.row) ? cutaway : undefined;
}

/** Whether land on a row nearer than `row` rises over the hero's body in any column he stands in. */
export function heroHidden(
  frame: CameraFrame,
  views: readonly LandformView[],
  steps: readonly Step[],
  turn: number,
  heroHeight: number,
  row: number,
): boolean {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const over = frame.footY - heroHeight * HIDDEN_SHARE;
  const half = Math.round(heroHeight * BODY_HALF_WIDTH);
  for (const step of steps) {
    // Only what the window would cut: a row nearer than his.
    if (step.row <= row) {
      continue;
    }
    const across = TILE_WIDTH * step.scale;
    for (const viewIndex of step.views) {
      const view = views[viewIndex];
      if (view === undefined || step.ground - view.field.peak * step.scale >= over) {
        continue;
      }
      const dy = step.y - view.centreY;
      for (let x = frame.footX - half; x <= frame.footX + half; x += 1) {
        // The painter's own sample point for this column and depth (`LandformPainter.probe`).
        const dx = (x + 0.5 - frame.footX) / across + frame.phaseX - view.centreX;
        const px = dx * cos + dy * sin;
        const py = -dx * sin + dy * cos;
        if (step.ground - fieldBound(view.field, px, py) * step.scale >= over) {
          continue;
        }
        const h = fieldHeight(view.field, px, py);
        if (h >= 0.5 && step.ground - h * step.scale < over) {
          return true;
        }
      }
    }
  }
  return false;
}
