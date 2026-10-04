import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../atmosphere";
import { createPuddle } from "../puddles";
import { bodyPlan, deepShare, relativeBody } from "./body";
import { reflectionKey, skyReflection } from "./sky-inks";

describe("relativeBody", () => {
  it("paints a body once per shape and dither phase, and keeps it past a few hundred others", () => {
    const sky = skyReflection(atmosphereAt(11));
    const puddle = (seed: number, x = 40) => createPuddle({ id: `${seed}`, centerX: x, centerY: 60, radius: 4, seed });
    const first = relativeBody(puddle(1), sky);
    // Moved by a whole dither cell, it is the same body.
    expect(relativeBody(puddle(1, 44), sky)).toBe(first);
    for (let seed = 2; seed < 400; seed += 1) {
      relativeBody(puddle(seed), sky);
    }
    expect(relativeBody(puddle(1), sky)).toBe(first);
  });

  it("paints the deep core in the sky's deep inks, and the shallows in its muddy ones", () => {
    const sky = skyReflection(atmosphereAt(11));
    const lake = createPuddle({ id: "lake", centerX: 0, centerY: 0, radius: 64, seed: 0x1a4e, spread: 1, deep: 32 });
    const deepInks = new Set(sky.deep.flatMap((pair) => [pair.a, pair.b]));
    const shallowInks = new Set(sky.rows.flatMap((pair) => [pair.a, pair.b]));
    const body = relativeBody(lake, sky);
    const ink = (x: number, y: number) => body.find((pixel) => pixel.x === x && pixel.y === y)?.ink;
    expect(deepInks.has(ink(0, 0) ?? "void")).toBe(true);
    expect(deepInks.has(ink(8, 4) ?? "void")).toBe(true);
    expect(shallowInks.has(ink(38, 0) ?? "void")).toBe(true);
    expect(deepShare(lake, 0, 0)).toBe(0);
    expect(deepShare(lake, 32, 0)).toBe(1);
    // Shallow water has no core at all.
    expect(deepShare(createPuddle({ id: "p", centerX: 0, centerY: 0, radius: 8, seed: 1 }), 0, 0)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("darkens deep water against the shallows, and keys a body by both", () => {
    const sky = skyReflection(atmosphereAt(11));
    expect(sky.deep).toHaveLength(sky.rows.length);
    expect(sky.deep.map((pair) => pair.a)).not.toEqual(sky.rows.map((pair) => pair.a));
    expect(reflectionKey({ ...sky, deep: sky.rows })).not.toBe(reflectionKey(sky));
  });

  it("plans an outline once, whatever its dither phase or sky, and inks it per both", () => {
    const at = (x: number) => createPuddle({ id: "lake", centerX: x, centerY: 0, radius: 40, seed: 0x77, spread: 1, deep: 16, lake: true });
    expect(bodyPlan(at(1))).toBe(bodyPlan(at(2)));
    const noon = skyReflection(atmosphereAt(12));
    // A new phase is a new body, and a body at a fixed dither is the one any centre gets there.
    expect(relativeBody(at(1), noon)).not.toBe(relativeBody(at(2), noon));
    expect(relativeBody(at(1), noon, { x: 0, y: 0 })).toBe(relativeBody(at(0), noon));
  });

  it("drops a damp pixel the dither says is dry, and keeps every one beside the water", () => {
    const sky = skyReflection(atmosphereAt(11));
    const puddle = createPuddle({ id: "ring", centerX: 0, centerY: 0, radius: 8, seed: 5 });
    const wet = (x: number) =>
      relativeBody(createPuddle({ id: "ring", centerX: x, centerY: 0, radius: 8, seed: 5 }), sky).filter(
        (pixel) => pixel.ink === "shadow-soft",
      );
    const beside = puddle.offsets.filter((offset) => offset.edge && !puddle.inside(offset.dx, offset.dy + 1));
    for (const phase of [0, 1, 2, 3]) {
      const ring = new Set(wet(phase).map((pixel) => `${pixel.x},${pixel.y}`));
      for (const rim of beside) {
        expect(ring.has(`${rim.dx},${rim.dy + 1}`)).toBe(true);
      }
    }
    // The dithered band is the screen's: moved a pixel, a different set of it is damp.
    const key = (x: number) => wet(x).map((pixel) => `${pixel.x},${pixel.y}`).sort().join(" ");
    expect(key(0)).not.toBe(key(1));
  });

  it("keeps a body for a new sky object that paints the same water", () => {
    const puddle = createPuddle({ id: "same", centerX: 40, centerY: 60, radius: 5, seed: 77 });
    const body = relativeBody(puddle, skyReflection(atmosphereAt(11)));
    expect(relativeBody(puddle, skyReflection(atmosphereAt(11)))).toBe(body);
    // Midnight water is other water.
    expect(relativeBody(puddle, skyReflection(atmosphereAt(0)))).not.toBe(body);
  });
});
