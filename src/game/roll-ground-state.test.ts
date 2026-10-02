import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import type { FrameContext } from "./frame-context";
import { groundKey } from "./ground/ground-plan";
import { sampleGround } from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { TUFT_SHAPES, tuftCloud } from "./ground/tufts";
import type { PlanetPose } from "./planet";
import { TILE_DEPTH } from "./projection";
import { gridTexels, lipBounds, rollGroundPixels, type WaterLook } from "./roll-ground";
import { packCloud, tuftBounds } from "./roll-grass";
import { LipState, type LipArt } from "./roll-ground-state";

const WIDTH = 96;
const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 48, footY: 113, phaseX: 0, phaseY: 0 };
const POSE: PlanetPose = { x: 70.5, y: 140.25, turn: 0.2 };
const FIELD = { minX: -4, maxX: 4, minY: -6, maxY: 7 };
const HAZE = { r: 180, g: 200, b: 220 };
const DRY: WaterLook = { wetCell: () => false, blendInto: () => false };
const LIVE_MAX_Y = Math.floor((FRAME.footY - FRAME.groundTop) / TILE_DEPTH) + 3;

const ART: LipArt = {
  tile: (sample, cellX, cellY) => gridTexels(groundTile(unpackGroundKey(groundKey(sample, cellX, cellY)))),
  tuft: (shape, bend) => {
    const tuft = TUFT_SHAPES[shape];
    return packCloud(tuft === undefined ? [] : tuftCloud(tuft, bend));
  },
  far: (code) => (code === 0 ? 0x2f6b2a : 0x7a5a3a),
};

/** Just what the swaying rows read of a frame: its clock and its wind. */
const CTX = { elapsedMs: 1234, wind: { strength: 0.6, gustiness: 0.6 } } as unknown as FrameContext;

function state(): LipState {
  return new LipState(POSE, lipBounds(FRAME, WIDTH), sampleGround(POSE, FIELD), tuftBounds(FRAME, WIDTH), ART);
}

/** A frame of the lip as the layer draws it: the swaying rows forgotten and re-stamped. */
function draw(lip: LipState): Uint8ClampedArray {
  lip.grass.forget(lip.grass.bounds.minY, LIVE_MAX_Y);
  return rollGroundPixels(FRAME, WIDTH, lip.look(DRY, LIVE_MAX_Y, CTX), HAZE);
}

describe("LipState", () => {
  it("draws the same lip for the same anchor, whichever state draws it", () => {
    expect([...draw(state())]).toEqual([...draw(state())]);
  });

  it("draws, once warmed ahead a band at a time, exactly what a fresh state draws", () => {
    const warmed = state();
    for (let from = 0; from < FRAME.rollHeight; from += 5) {
      rollGroundPixels(FRAME, WIDTH, warmed.look(DRY, LIVE_MAX_Y), HAZE, { from, to: from + 5 });
    }
    expect([...draw(warmed)]).toEqual([...draw(state())]);
  });

  it("keeps drawing the same lip frame after frame, its upright tufts stamped once", () => {
    const lip = state();
    const first = draw(lip);
    expect([...draw(lip)]).toEqual([...first]);
  });

  it("holds the far rows upright whatever the wind: only the near rows are given the frame", () => {
    const calm = state();
    const blown = state();
    const still = rollGroundPixels(FRAME, WIDTH, calm.look(DRY, LIVE_MAX_Y), HAZE);
    const swaying = draw(blown);
    const rowBytes = WIDTH * 4;
    const farRows = 6;
    expect([...swaying.subarray(0, farRows * rowBytes)]).toEqual([...still.subarray(0, farRows * rowBytes)]);
  });
});
