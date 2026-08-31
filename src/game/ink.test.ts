import { describe, expect, it } from "vitest";

import {
  cloudBounds,
  cloudToSprite,
  INK_COLORS,
  INK_TOKENS,
  maskFromRows,
  mirrorCloud,
  mirrorMask,
  stampMask,
  strokeLine,
  translateCloud,
  type PixelCloud,
} from "./ink";
import { rasterizeSprite } from "./pixel-art";

describe("the ink set", () => {
  it("gives every ink a colour and a distinct palette token", () => {
    const inks = Object.keys(INK_COLORS);
    const tokens = Object.values(INK_TOKENS);
    expect(new Set(tokens).size).toBe(inks.length);
    expect(tokens.every((token) => token.length === 1 && token !== ".")).toBe(true);
  });
});

describe("maskFromRows", () => {
  it("reads # as lit and . as empty", () => {
    const mask = maskFromRows(["#.", ".#"]);
    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(mask.pixels).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("rejects ragged rows, stray glyphs, and empty masks", () => {
    expect(() => maskFromRows(["##", "#"])).toThrow(/width/);
    expect(() => maskFromRows(["#x"])).toThrow(/glyph/);
    expect(() => maskFromRows([])).toThrow(/at least one pixel/);
    expect(() => maskFromRows([""])).toThrow(/at least one pixel/);
  });
});

describe("mirrorMask", () => {
  it("flips lit pixels across the mask's own width", () => {
    const mask = mirrorMask(maskFromRows(["#..", "..#"]));
    expect(mask.pixels).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
  });
});

describe("stampMask", () => {
  it("offsets the mask's pixels and inks them", () => {
    const cloud: PixelCloud = [];
    stampMask(cloud, maskFromRows(["##"]), 3, -5, "magenta");
    expect(cloud).toEqual([
      { x: 3, y: -5, ink: "magenta" },
      { x: 4, y: -5, ink: "magenta" },
    ]);
  });
});

describe("strokeLine", () => {
  it("connects both endpoints inclusively", () => {
    const cloud: PixelCloud = [];
    strokeLine(cloud, { x: 0, y: 0 }, { x: 3, y: 2 }, "bone");
    const keys = new Set(cloud.map((pixel) => `${pixel.x},${pixel.y}`));
    expect(keys.has("0,0")).toBe(true);
    expect(keys.has("3,2")).toBe(true);
    // A Bresenham line never leaves a diagonal gap.
    expect(cloud.length).toBeGreaterThanOrEqual(4);
  });

  it("handles a single point and any octant", () => {
    const point: PixelCloud = [];
    strokeLine(point, { x: 2, y: 2 }, { x: 2, y: 2 }, "cyan");
    expect(point).toEqual([{ x: 2, y: 2, ink: "cyan" }]);

    const up: PixelCloud = [];
    strokeLine(up, { x: 0, y: 0 }, { x: -2, y: -4 }, "cyan");
    const keys = new Set(up.map((pixel) => `${pixel.x},${pixel.y}`));
    expect(keys.has("-2,-4")).toBe(true);
  });

  it("widens with a square brush and rejects a zero thickness", () => {
    const thin: PixelCloud = [];
    const thick: PixelCloud = [];
    strokeLine(thin, { x: 0, y: 0 }, { x: 0, y: 4 }, "bone", 1);
    strokeLine(thick, { x: 0, y: 0 }, { x: 0, y: 4 }, "bone", 2);
    expect(thick.length).toBeGreaterThan(thin.length);
    expect(() => strokeLine([], { x: 0, y: 0 }, { x: 1, y: 1 }, "bone", 0)).toThrow(
      /thickness/,
    );
  });
});

describe("cloud helpers", () => {
  const cloud: PixelCloud = [
    { x: -1, y: -3, ink: "bone" },
    { x: 2, y: 0, ink: "cyan" },
  ];

  it("mirrors across x = 0 and translates without mutating", () => {
    expect(mirrorCloud(cloud)[0]).toEqual({ x: 1, y: -3, ink: "bone" });
    expect(translateCloud(cloud, 10, 1)[1]).toEqual({ x: 12, y: 1, ink: "cyan" });
    expect(cloud[0]).toEqual({ x: -1, y: -3, ink: "bone" });
  });

  it("bounds the lit pixels inclusively, and null for empty", () => {
    expect(cloudBounds(cloud)).toEqual({ left: -1, top: -3, right: 2, bottom: 0 });
    expect(cloudBounds([])).toBeNull();
  });
});

describe("cloudToSprite", () => {
  it("flattens with later pixels winning, into a rasterizable source", () => {
    const cloud: PixelCloud = [
      { x: 0, y: 0, ink: "bone" },
      { x: 0, y: 0, ink: "ember" },
    ];
    const sprite = cloudToSprite(cloud, { width: 3, height: 3, originX: 1, originY: 1 });
    expect(sprite.rows).toEqual(["...", ".e.", "..."]);
    expect(sprite.palette["e"]).toBe(INK_COLORS.ember);
    expect(() => rasterizeSprite(sprite)).not.toThrow();
  });

  it("clips pixels outside the frame instead of throwing", () => {
    const cloud: PixelCloud = [
      { x: 50, y: 0, ink: "bone" },
      { x: 0, y: 0, ink: "bone" },
    ];
    const sprite = cloudToSprite(cloud, { width: 2, height: 1, originX: 0, originY: 0 });
    expect(sprite.rows).toEqual(["w."]);
  });

  it("rejects a degenerate frame", () => {
    expect(() => cloudToSprite([], { width: 0, height: 1, originX: 0, originY: 0 })).toThrow(
      /1x1/,
    );
  });
});
