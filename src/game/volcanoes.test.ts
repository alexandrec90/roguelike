import { describe, expect, it } from "vitest";

import { CRATER_RADIUS, CRATER_RIM, isVolcano, landformShape, planetLandforms } from "./landforms";
import { BIRTH_RADIUS, EMIT_MS, LIFE_MS, plumePuffs, PLUME_PUFFS, RISE_TILES, TOP_RADIUS, volcanoVents } from "./volcanoes";

const vent = volcanoVents()[0]!;

describe("volcanoes", () => {
  it("are some of the mountains, and only mountains", () => {
    const volcanoes = planetLandforms().filter(isVolcano);
    const mountains = planetLandforms().filter((landform) => landform.kind === "mountain");
    expect(volcanoes.length).toBeGreaterThan(0);
    expect(volcanoes.length).toBeLessThan(mountains.length);
    expect(volcanoes.every((landform) => landform.kind === "mountain")).toBe(true);
    expect(volcanoVents().map((v) => v.id)).toEqual(volcanoes.map((landform) => landform.id));
  });

  it("have a crater: the summit cut off at the rim, the vent sunk below it", () => {
    const volcano = planetLandforms().find(isVolcano)!;
    const shape = landformShape(volcano);
    const rim = volcano.height * CRATER_RIM;
    let tallest = 0;
    for (let a = 0; a < 32; a += 1) {
      for (const share of [0.3, 0.6, 1, 1.4]) {
        const r = volcano.radius * CRATER_RADIUS * share;
        tallest = Math.max(tallest, shape(Math.cos(a) * r, Math.sin(a) * r));
      }
    }
    expect(tallest).toBeLessThanOrEqual(rim + 1e-6);
    expect(shape(0, 0)).toBeLessThan(tallest - volcano.height * 0.05);
    // Still a mountain: the floor of the crater is high up.
    expect(shape(0, 0)).toBeGreaterThan(volcano.height * 0.7);
  });

  it("leave every other mountain's summit whole", () => {
    const mountain = planetLandforms().find((landform) => landform.kind === "mountain" && !isVolcano(landform))!;
    expect(landformShape(mountain)(0, 0)).toBeGreaterThan(mountain.height * CRATER_RIM);
  });
});

describe("plumePuffs", () => {
  it("is a full plume once it has been running a lifetime", () => {
    const puffs = plumePuffs(vent, LIFE_MS * 3, 1);
    expect(puffs.length).toBeGreaterThanOrEqual(PLUME_PUFFS - 1);
    expect(puffs.length).toBeLessThanOrEqual(PLUME_PUFFS);
  });

  it("has been smoking since before the clock started: full on the first frame", () => {
    const first = plumePuffs(vent, 0, 1);
    expect(first.length).toBeGreaterThanOrEqual(PLUME_PUFFS - 1);
    expect(Math.max(...first.map((puff) => puff.age))).toBeGreaterThan(0.9);
  });

  it("lets a new puff out of the vent every EMIT_MS", () => {
    const before = plumePuffs(vent, EMIT_MS * 50 - 1, 1);
    const after = plumePuffs(vent, EMIT_MS * 50 + 1, 1);
    expect(Math.min(...before.map((puff) => puff.age))).toBeGreaterThan(0.02);
    expect(Math.min(...after.map((puff) => puff.age))).toBeLessThan(0.001);
  });

  it("is a pure function of time: the same smoke on every call", () => {
    expect(plumePuffs(vent, 123_456, 0.7)).toEqual(plumePuffs(vent, 123_456, 0.7));
  });

  it("rises, swells and drifts downwind with age", () => {
    const puffs = plumePuffs(vent, LIFE_MS * 5 + 77, 1.2);
    const young = puffs[puffs.length - 1]!;
    const old = puffs[0]!;
    expect(young.age).toBeLessThan(old.age);
    expect(young.z).toBeGreaterThanOrEqual(vent.z);
    expect(old.z).toBeGreaterThan(young.z + RISE_TILES * 0.5);
    expect(old.radius).toBeGreaterThan(young.radius * 2);
    expect(Math.hypot(old.dx, old.dy)).toBeGreaterThan(Math.hypot(young.dx, young.dy) + 4);
  });

  it("keeps every puff inside its bounds", () => {
    for (const puff of plumePuffs(vent, LIFE_MS * 7 + 3, 2)) {
      expect(puff.age).toBeGreaterThanOrEqual(0);
      expect(puff.age).toBeLessThan(1);
      expect(puff.radius).toBeGreaterThanOrEqual(BIRTH_RADIUS * 0.8 - 1e-9);
      expect(puff.radius).toBeLessThanOrEqual(TOP_RADIUS * 1.2 + 1e-9);
      expect(puff.z).toBeLessThanOrEqual(vent.z + RISE_TILES * 1.15 + 1e-9);
    }
  });

  it("bends further over in a stronger wind", () => {
    const reach = (wind: number): number => {
      const old = plumePuffs(vent, LIFE_MS * 4, wind)[0]!;
      return Math.hypot(old.dx, old.dy);
    };
    expect(reach(2)).toBeGreaterThan(reach(0));
  });

  it("reuses the array it is given", () => {
    const out: ReturnType<typeof plumePuffs> = [];
    expect(plumePuffs(vent, LIFE_MS * 2, 1, out)).toBe(out);
  });
});
