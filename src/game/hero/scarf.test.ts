import { describe, expect, it } from "vitest";

import { createScarf, SCARF_LINK, SCARF_SEGMENTS, scarfPrims, settleScarf, stepScarf } from "./scarf";

const NECK = { x: 0, y: -13 };

describe("the scarf's tail", () => {
  it("hangs straight down from the neck when settled", () => {
    const scarf = createScarf(1);
    settleScarf(scarf, NECK);
    const tip = scarf.chain.points[SCARF_SEGMENTS];
    expect(tip?.x).toBe(0);
    expect(tip?.y).toBeCloseTo(NECK.y + SCARF_SEGMENTS * SCARF_LINK);
  });

  it("keeps its root pinned to the neck wherever the neck goes", () => {
    const scarf = createScarf(1);
    settleScarf(scarf, NECK);
    stepScarf(scarf, { x: 2, y: -12 }, 16, { x: 0, y: 0 });
    expect(scarf.chain.points[0]).toMatchObject({ x: 2, y: -12 });
  });

  it("streams away from a drive", () => {
    const scarf = createScarf(1);
    settleScarf(scarf, NECK);
    for (let frame = 0; frame < 40; frame += 1) {
      stepScarf(scarf, NECK, 16, { x: -0.0006, y: 0 });
    }
    expect(scarf.chain.points[SCARF_SEGMENTS]!.x).toBeLessThan(-2);
  });

  it("becomes tapered crimson capsules at the depth it is given", () => {
    const scarf = createScarf(1);
    settleScarf(scarf, NECK);
    const prims = scarfPrims(scarf, -3, 9);
    expect(prims).toHaveLength(SCARF_SEGMENTS);
    expect(prims.every((prim) => prim.material === "crimson" && prim.da === -3 && prim.group === 9)).toBe(true);
    expect(prims[prims.length - 1]!.rb).toBeLessThan(prims[0]!.ra);
  });

  it("is deterministic", () => {
    const run = () => {
      const scarf = createScarf(4);
      settleScarf(scarf, NECK);
      for (let frame = 0; frame < 20; frame += 1) {
        stepScarf(scarf, NECK, 17, { x: 0.0003, y: 0.0001 });
      }
      return scarf.chain.points.map((p) => [p.x, p.y]);
    };
    expect(run()).toEqual(run());
  });
});
