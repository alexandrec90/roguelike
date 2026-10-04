import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { heroCutaway } from "./landform-cutaway";
import { createLandformPixels, NO_ROW, type LandformLight, type LandformView } from "./landform-frame";
import { marchSchedule } from "./landform-march";
import { renderLandforms } from "./landform-render";
import { landformField, type Landform } from "./landforms";
import { rowAtFoot } from "./projection";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const HERO = 32;
const LIGHT: LandformLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.7, turn: 0, haze: { r: 180, g: 200, b: 220 } };

let serial = 0;

function view(kind: Landform["kind"], radius: number, height: number, x: number, y: number): LandformView {
  serial += 1;
  const landform: Landform = { id: `cut-${kind}-${serial}`, kind, x: 0, y: 0, radius, height, seed: 77 + serial };
  return { field: landformField(landform), centreX: x, centreY: y };
}

function cutawayFor(views: readonly LandformView[], frame = FRAME): ReturnType<typeof heroCutaway> {
  return heroCutaway(frame, views, marchSchedule(frame, views), 0, HERO);
}

describe("heroCutaway", () => {
  it("opens the window round him when a tower nearer than him stands over him", () => {
    const cutaway = cutawayFor([view("tower", 1.6, 220, 0, -3)]);
    expect(cutaway).toEqual({
      x: FRAME.footX,
      y: FRAME.footY - HERO / 2,
      radiusX: HERO * 0.75,
      radiusY: HERO * 0.9,
      row: Math.round(rowAtFoot(FRAME.footY, FRAME.groundTop)),
    });
  });

  it("keeps it shut with the land behind him, however tall", () => {
    expect(cutawayFor([view("mountain", 10, 360, 0, 11)])).toBeUndefined();
    expect(cutawayFor([view("tower", 1.6, 220, 0, 2)])).toBeUndefined();
  });

  it("keeps it shut for nearer land beside him that covers none of him", () => {
    // A flank come forward at his shoulder: nearer, inside the oval, clear of his body.
    const beside = [view("tower", 1.6, 220, 2.4, -2)];
    expect(cutawayFor(beside)).toBeUndefined();
    // The oval on its own would have punched a hole in it - the stray window.
    const ungated = { x: FRAME.footX, y: FRAME.footY - HERO / 2, radiusX: HERO * 0.75, radiusY: HERO * 0.9, row: 5 };
    const plain = createLandformPixels(320, 180);
    const cut = createLandformPixels(320, 180);
    renderLandforms(FRAME, beside, LIGHT, plain);
    renderLandforms(FRAME, beside, { ...LIGHT, cutaway: ungated }, cut);
    const shown = (pixels: typeof plain): number => pixels.rows.filter((row) => row !== NO_ROW).length;
    expect(shown(cut)).toBeLessThan(shown(plain));
  });

  it("keeps it shut for a low rise in front that hides no more than his feet", () => {
    expect(cutawayFor([view("mesa", 3, 5, 0, -3.5)])).toBeUndefined();
  });

  it("keeps it shut with nothing in view", () => {
    expect(cutawayFor([])).toBeUndefined();
  });
});
