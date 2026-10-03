import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../atmosphere";
import { createPuddle } from "../puddles";
import { relativeBody } from "./body";
import { skyReflection } from "./sky-inks";

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

  it("keeps a body for a new sky object that paints the same water", () => {
    const puddle = createPuddle({ id: "same", centerX: 40, centerY: 60, radius: 5, seed: 77 });
    const body = relativeBody(puddle, skyReflection(atmosphereAt(11)));
    expect(relativeBody(puddle, skyReflection(atmosphereAt(11)))).toBe(body);
    // Midnight water is other water.
    expect(relativeBody(puddle, skyReflection(atmosphereAt(0)))).not.toBe(body);
  });
});
