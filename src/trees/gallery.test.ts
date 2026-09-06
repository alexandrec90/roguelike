import { describe, expect, it } from "vitest";

import { createRaster } from "../game/cloud-raster";
import {
  createGalleryBuffer,
  DEFAULT_GALLERY,
  galleryLayout,
  lightVector,
  paintGround,
  parseGalleryState,
  serializeGalleryState,
  type GalleryState,
} from "./gallery";

const CELL = galleryLayout(1, 40, 30, 1).cells[0]!;

function litPixels(width: number, height: number, ground: GalleryState["ground"]): number {
  const buffer = createRaster(width, height);
  paintGround(buffer, { ...CELL, width, height }, ground, 7);
  let lit = 0;
  for (let index = 0; index < buffer.data.length; index += 4) {
    if ((buffer.data[index] ?? 0) + (buffer.data[index + 1] ?? 0) + (buffer.data[index + 2] ?? 0) > 0) {
      lit += 1;
    }
  }
  return lit;
}

describe("gallery state", () => {
  it("falls back to the defaults on an empty query", () => {
    expect(parseGalleryState("")).toEqual(DEFAULT_GALLERY);
  });

  it("round-trips through the URL", () => {
    const state: GalleryState = {
      ...DEFAULT_GALLERY,
      wind: 1.75,
      gust: 0.25,
      ground: "grass",
      distance: 12,
      renderer: "diff",
      zoom: 4,
      play: false,
      solo: "sdf-crown",
    };
    expect(parseGalleryState(serializeGalleryState(state))).toEqual(state);
  });

  it("clamps values a hand-edited URL got wrong", () => {
    const state = parseGalleryState("?wind=99&gust=-3&sun=0&speed=100&rain=4&far=99");
    expect(state.wind).toBe(2.5);
    expect(state.gust).toBe(0);
    expect(state.elevation).toBe(0.15);
    expect(state.speed).toBe(3);
    expect(state.rain).toBe(1);
    expect(state.distance).toBe(30);
  });

  it("ignores unparseable numbers, an unknown ground and an off-grid zoom", () => {
    const state = parseGalleryState("?wind=lots&ground=lava&zoom=5&renderer=vulkan");
    expect(state.wind).toBe(DEFAULT_GALLERY.wind);
    expect(state.ground).toBe(DEFAULT_GALLERY.ground);
    // A tie between two steps goes down, so a hand-typed zoom never
    // overflows the pane it has to fit in.
    expect(state.zoom).toBe(4);
    expect(state.renderer).toBe("cpu");
  });

  it("leaves solo out of the URL when nothing is soloed", () => {
    expect(serializeGalleryState(DEFAULT_GALLERY)).not.toContain("solo");
  });
});

describe("the light vector", () => {
  it("points right at 0 degrees and down at 90, matching cloud coordinates", () => {
    expect(lightVector(0).x).toBeCloseTo(1, 6);
    expect(lightVector(90).y).toBeCloseTo(1, 6);
  });
});

describe("the grid", () => {
  it("wraps at the column count and sizes the buffer to fit", () => {
    const grid = galleryLayout(8, 80, 60, 3);
    expect(grid.width).toBe(240);
    expect(grid.height).toBe(180);
    expect(grid.cells[3]).toMatchObject({ left: 0, top: 60 });
  });

  it("never makes more columns than there are cells", () => {
    expect(galleryLayout(2, 50, 50, 8).width).toBe(100);
  });

  it("puts the foot above the bottom, leaving room for shadow and reflection", () => {
    const cell = galleryLayout(1, 60, 50, 1).cells[0];
    expect(cell?.footY).toBeLessThan(49);
    expect(cell?.footX).toBe(30);
  });

  it("rejects an empty gallery", () => {
    expect(() => galleryLayout(0, 10, 10, 1)).toThrow(/at least one cell/);
  });

  it("allocates a buffer the size of the grid", () => {
    const grid = galleryLayout(4, 20, 10, 2);
    expect(createGalleryBuffer(grid)).toMatchObject({ width: 40, height: 20 });
  });
});

describe("the grounds", () => {
  it("leaves black black, so nothing competes with the art", () => {
    expect(litPixels(20, 16, "black")).toBe(0);
  });

  it("lights half the cell in duo, so one tree straddles both grounds", () => {
    expect(litPixels(20, 16, "duo")).toBe(10 * 16);
  });

  it("lights only a band at the foot for grass and water", () => {
    const grass = litPixels(40, 30, "grass");
    expect(grass).toBeGreaterThan(0);
    expect(grass).toBeLessThan(40 * 30);
    expect(litPixels(40, 30, "water")).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    expect(litPixels(40, 30, "grass")).toBe(litPixels(40, 30, "grass"));
  });
});
