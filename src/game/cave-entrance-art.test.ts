import { describe, expect, it } from "vitest";

import { caveEntranceCloud, ENTRANCE_HALF_WIDTH, ENTRANCE_HEIGHT, type EntranceLight } from "./cave-entrance-art";
import { cloudBounds } from "./ink";

const NOON: EntranceLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.8 };
const DUSK: EntranceLight = { light: { x: 0.9, y: -0.2 }, elevation: 0.2 };

function inkAt(cloud: ReturnType<typeof caveEntranceCloud>, x: number, y: number): string | undefined {
  return [...cloud].reverse().find((pixel) => pixel.x === x && pixel.y === y)?.ink;
}

describe("caveEntranceCloud", () => {
  it("draws the same mouth every time for a scale and a light", () => {
    expect(caveEntranceCloud(1, NOON)).toEqual(caveEntranceCloud(1, NOON));
  });

  it("stands on its foot and fits the size it says it is", () => {
    const bounds = cloudBounds(caveEntranceCloud(1, NOON))!;
    expect(bounds.top).toBeGreaterThanOrEqual(-ENTRANCE_HEIGHT);
    expect(bounds.bottom).toBeLessThanOrEqual(3);
    expect(bounds.left).toBeGreaterThanOrEqual(-ENTRANCE_HALF_WIDTH);
    expect(bounds.right).toBeLessThanOrEqual(ENTRANCE_HALF_WIDTH);
    expect(bounds.top).toBeLessThan(-ENTRANCE_HEIGHT / 2);
  });

  it("opens dark at its foot and is stone above the arch", () => {
    const cloud = caveEntranceCloud(1, NOON);
    expect(inkAt(cloud, 0, -3)).toBe("void");
    expect(inkAt(cloud, 0, -20)).toMatch(/^(stone|moss)-/);
  });

  it("throws a contact shadow beside its foot", () => {
    const cloud = caveEntranceCloud(1, NOON);
    expect(cloud.some((pixel) => pixel.ink === "shadow" && pixel.y >= 0)).toBe(true);
  });

  it("is lit by the light it is handed", () => {
    const noon = caveEntranceCloud(1, NOON).map((pixel) => pixel.ink);
    const dusk = caveEntranceCloud(1, DUSK).map((pixel) => pixel.ink);
    expect(noon).not.toEqual(dusk);
  });

  it("is the same shape smaller on the horizon, never nothing", () => {
    const full = caveEntranceCloud(1, NOON);
    const far = caveEntranceCloud(0.3, NOON);
    const speck = caveEntranceCloud(0.1, NOON);
    expect(far.length).toBeLessThan(full.length / 4);
    expect(speck.length).toBeGreaterThan(0);
    const farBounds = cloudBounds(far)!;
    expect(farBounds.top).toBeGreaterThanOrEqual(-Math.ceil(ENTRANCE_HEIGHT * 0.3));
  });
});
