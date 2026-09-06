import { describe, expect, it } from "vitest";

import {
  burnInk,
  burningPoints,
  igniteAt,
  makeBurnable,
  stepBurn,
  type Burnable,
} from "./burnable";
import type { InkId, PixelCloud } from "./ink";
import { alightNodes, isSpent } from "./procgen/heat";

/** A leafy blob: the shape of anything the player might set fire to. */
function blob(ink: InkId = "neon-green", size = 12): PixelCloud {
  const cloud: PixelCloud = [];
  for (let y = -size; y <= 0; y += 1) {
    for (let x = -size; x <= size; x += 1) {
      if (x * x + y * y <= size * size) {
        cloud.push({ x, y, ink });
      }
    }
  }
  return cloud;
}

function burn(burnable: Burnable, totalMs: number, options = {}): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 16) {
    stepBurn(burnable, 16, options);
  }
}

describe("building a burnable", () => {
  it("lays cells over the pixels and joins them", () => {
    const burnable = makeBurnable(blob(), { cellSize: 3 });
    expect(burnable.field.nodes.length).toBeGreaterThan(10);
    expect(burnable.centres).toHaveLength(burnable.field.nodes.length);
    expect(burnable.field.nodes.some((node) => node.neighbours.length >= 3)).toBe(true);
  });

  it("gives an empty cloud an empty graph rather than throwing", () => {
    const burnable = makeBurnable([]);
    expect(burnable.field.nodes).toEqual([]);
    expect(burningPoints(burnable)).toEqual([]);
  });

  it("reads how readily a cell burns off the ink of the pixels in it", () => {
    const leaves = makeBurnable(blob("neon-green"), { cellSize: 3 });
    const stone = makeBurnable(blob("ice"), { cellSize: 3 });
    expect(leaves.field.nodes[0]?.fuel ?? 0).toBeGreaterThan(0);
    expect(stone.field.nodes.every((node) => node.fuel === 0)).toBe(true);
  });

  it("burns wood longer than leaves, which is what the ink table says", () => {
    const leaf = makeBurnable(blob("neon-green"), { cellSize: 3 }).field.nodes[0]?.fuel ?? 0;
    const wood = makeBurnable(blob("steel"), { cellSize: 3 }).field.nodes[0]?.fuel ?? 0;
    expect(wood).toBeGreaterThan(leaf);
  });

  it("keeps a cell's shape: a gap in the cloud is a gap in the graph", () => {
    const split: PixelCloud = [
      { x: -20, y: 0, ink: "neon-green" },
      { x: 20, y: 0, ink: "neon-green" },
    ];
    const burnable = makeBurnable(split, { cellSize: 2 });
    expect(burnable.field.nodes).toHaveLength(2);
    expect(burnable.field.nodes[0]?.neighbours).toEqual([]);
  });
});

describe("setting something alight", () => {
  it("lights the cell nearest the hit and spreads from there", () => {
    const burnable = makeBurnable(blob(), { cellSize: 3 });
    const hit = igniteAt(burnable, -10, -2);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(alightNodes(burnable.field)).toContain(hit);
    burn(burnable, 3000);
    expect(alightNodes(burnable.field).length).toBeGreaterThan(1);
  });

  it("reports no cell to light on something non-combustible", () => {
    expect(igniteAt(makeBurnable(blob("water"), { cellSize: 3 }), 0, 0)).toBe(-1);
  });

  it("names the points embers should be born at", () => {
    const burnable = makeBurnable(blob(), { cellSize: 3 });
    igniteAt(burnable, 0, -6);
    burn(burnable, 1500);
    const points = burningPoints(burnable);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("is put out by rain, because wetness is a term in the same rule", () => {
    const spread = (wet: number): number => {
      const burnable = makeBurnable(blob(), { cellSize: 3 });
      igniteAt(burnable, 0, -6);
      burn(burnable, 4000, { wet });
      return alightNodes(burnable.field).length;
    };
    expect(spread(1)).toBeLessThan(spread(0));
  });
});

describe("inking the fire onto the cloud", () => {
  it("leaves an unlit object exactly as it was", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3 });
    expect(burnInk(burnable, cloud)).toEqual(cloud);
  });

  it("turns the burning cells to ember inks", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3 });
    igniteAt(burnable, 0, -6);
    burn(burnable, 800);
    const lit = burnInk(burnable, cloud);
    expect(lit.some((pixel) => pixel.ink === "ember" || pixel.ink === "amber")).toBe(true);
  });

  it("chars burnt-out cells to a dark ink, never to the background", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3 });
    igniteAt(burnable, 0, -6);
    burn(burnable, 40_000);
    expect(burnable.field.nodes.some((_node, index) => isSpent(burnable.field, index))).toBe(true);
    // `void` would delete the object rather than blacken it.
    expect(burnInk(burnable, cloud).every((pixel) => pixel.ink !== "void")).toBe(true);
    expect(burnInk(burnable, cloud).some((pixel) => pixel.ink === "deep")).toBe(true);
  });

  it("leaves a pixel outside the graph alone", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3 });
    const stray: PixelCloud = [{ x: 500, y: -500, ink: "cyan" }];
    expect(burnInk(burnable, stray)).toEqual(stray);
  });

  it("is deterministic at a given moment", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3, seed: 5 });
    igniteAt(burnable, 0, -6);
    burn(burnable, 1200);
    expect(JSON.stringify(burnInk(burnable, cloud, 400))).toBe(
      JSON.stringify(burnInk(burnable, cloud, 400)),
    );
  });

  it("flickers over time", () => {
    const cloud = blob();
    const burnable = makeBurnable(cloud, { cellSize: 3, seed: 5 });
    igniteAt(burnable, 0, -6);
    burn(burnable, 1200);
    expect(JSON.stringify(burnInk(burnable, cloud, 0))).not.toBe(
      JSON.stringify(burnInk(burnable, cloud, 900)),
    );
  });
});
