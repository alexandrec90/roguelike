import { describe, expect, it } from "vitest";

import { DEFAULT_SKY_FRACTION } from "../../game/horizon";
import { landformField, landformsNear, planetLandforms } from "../../game/landforms";
import { wrapTile, type PlanetPose } from "../../game/planet";
import { TILE_DEPTH } from "../../game/projection";
import { heroCutaway, heroHidden, TALLEST } from "./cutaway";
import { heroHeightPx } from "./hero-mesh";
import { lowpolyView } from "./placement";

const height = heroHeightPx();
const view = lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, height);
const mountain = planetLandforms().find((landform) => landform.kind === "mountain")!;

/** A pose `dx`, `dy` planet tiles from the mountain's centre, turned by `turn`. */
function nearMountain(dx: number, dy: number, turn: number): PlanetPose {
  return { x: wrapTile(mountain.x + dx), y: wrapTile(mountain.y + dy), turn };
}

describe("the window round the hero", () => {
  it("opens when a mountain stands between him and the camera", () => {
    // Turn 0 looks along +y, so a pose past the mountain's far side has it nearer the camera.
    const pose = nearMountain(0, mountain.radius + 1, 0);
    expect(heroHidden(pose, height)).toBe(true);
    expect(heroCutaway(view, pose, height)).toEqual({
      x: view.footX,
      y: view.footY - height / 2,
      radiusX: height * 0.75,
      radiusY: height * 0.9,
    });
  });

  it("stays shut when the mountain is ahead of him, where he is drawn over its foot", () => {
    expect(heroCutaway(view, nearMountain(0, mountain.radius + 1, Math.PI), height)).toBeUndefined();
  });

  it("stays shut beside a flank that comes nearer but hides none of him", () => {
    expect(heroHidden(nearMountain(mountain.radius + 3, 0, 0), height)).toBe(false);
  });

  it("stays shut when nearer land is too far off for its peak to reach his feet", () => {
    const peak = landformField(mountain).peak;
    const far = nearMountain(0, mountain.radius + peak / TILE_DEPTH + 2, 0);
    expect(heroHidden(far, height, [mountain])).toBe(false);
    // The same mountain, close behind him, does hide him.
    expect(heroHidden(nearMountain(0, mountain.radius + 1, 0), height, [mountain])).toBe(true);
  });

  it("stays shut with no land in reach", () => {
    expect(heroHidden(nearMountain(0, mountain.radius + 1, 0), height, [])).toBe(false);
  });

  it("asks only the landforms within the probe's reach by default", () => {
    const pose = nearMountain(0, mountain.radius + 1, 0);
    expect(landformsNear(pose, TALLEST / TILE_DEPTH + 1)).toContain(mountain);
  });

  it("searches far enough to find the tallest landform the planet makes", () => {
    const tallest = Math.max(...planetLandforms().map((landform) => landformField(landform).peak));
    expect(tallest).toBeLessThanOrEqual(TALLEST);
  });
});
