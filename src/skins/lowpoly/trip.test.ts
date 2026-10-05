import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../../game/atmosphere";
import { PLANET_TILES } from "../../game/planet";
import { DEFAULT_SKY_FRACTION } from "../../game/horizon";
import type { Rgb } from "./mesh";
import { lowpolyView } from "./placement";
import {
  hasFx,
  hexOf,
  hueTurn,
  parseFx,
  parseTrip,
  trailFrame,
  TRIP,
  TRIP_FX,
  tripBreath,
  tripCurl,
  tripDepth,
  tripHazeTurn,
  tripHue,
  tripMirrorSky,
  tripNeon,
  trippedAtmosphere,
  tripSwell,
  tripTint,
} from "./trip";
import { CLOCK_WRAP_S } from "./wet-world";

const close = (actual: Rgb, expected: Rgb, digits = 9): void => {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, digits));
};

describe("parseTrip", () => {
  it("is sober when absent or unreadable, so a typo never changes the picture", () => {
    expect(parseTrip(null)).toBe(0);
    expect(parseTrip("lots")).toBe(0);
    expect(parseTrip("NaN")).toBe(0);
  });

  it("is all the way when bare, and clamps a number into 0..1", () => {
    expect(parseTrip("")).toBe(1);
    expect(parseTrip(" 0.4 ")).toBe(0.4);
    expect(parseTrip("3")).toBe(1);
    expect(parseTrip("-1")).toBe(0);
  });
});

describe("hueTurn", () => {
  it("is the identity at no angle and at a whole turn", () => {
    expect(hueTurn([0.2, 0.5, 0.9], 0)).toEqual([0.2, 0.5, 0.9]);
    close(hueTurn([0.2, 0.5, 0.9], Math.PI * 2), [0.2, 0.5, 0.9]);
  });

  it("takes red to green to blue in thirds of a turn", () => {
    close(hueTurn([1, 0, 0], (Math.PI * 2) / 3), [0, 1, 0]);
    close(hueTurn([0, 1, 0], (Math.PI * 2) / 3), [0, 0, 1]);
  });

  it("leaves a grey grey and keeps the channel sum, so a turn never brightens", () => {
    close(hueTurn([0.4, 0.4, 0.4], 1.3), [0.4, 0.4, 0.4]);
    const turned = hueTurn([0.1, 0.6, 0.3], 2.2);
    expect(turned[0] + turned[1] + turned[2]).toBeCloseTo(1, 9);
  });
});

describe("tripTint", () => {
  it("is exactly the colour when sober", () => {
    expect(tripTint([0.3, 0.6, 0.2], 0, 0)).toEqual([0.3, 0.6, 0.2]);
  });

  it("casts a grey with the turning hue, so rock and snow trip too, without brightening it", () => {
    const rock = tripTint([0.6, 0.6, 0.6], 1, 2);
    expect(Math.max(...rock) - Math.min(...rock)).toBeGreaterThan(0.2);
    expect(rock[0] + rock[1] + rock[2]).toBeCloseTo(1.8, 9);
    expect(tripTint([0.6, 0.6, 0.6], 1, 2)).not.toEqual(tripTint([0.6, 0.6, 0.6], 1, 4));
  });

  it("saturates, and never leaves a channel below zero", () => {
    const tinted = tripTint([0.1, 0.8, 0.1], 1, 0);
    expect(tinted[1] - tinted[0]).toBeGreaterThan(0.7);
    for (const angle of [0.5, 2, 4]) {
      expect(Math.min(...tripTint([0.05, 0.9, 0.05], 1, angle))).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("tripHue", () => {
  it("is no turn at all when sober, wherever and whenever", () => {
    expect(tripHue(0, 123, [5, -7], [0.3, 0.4, 0.86], true)).toBe(0);
  });

  it("turns the mirror a further half-circle at a full trip", () => {
    const on = tripHue(1, 2, [3, 4], [0, 0, 1], false);
    expect(tripHue(1, 2, [3, 4], [0, 0, 1], true) - on).toBeCloseTo(Math.PI, 9);
  });

  it("differs facet to facet, so flat triangles flip colour as the planet turns", () => {
    expect(tripHue(1, 0, [0, 0], [0.7, 0, 0.7], false)).not.toBeCloseTo(tripHue(1, 0, [0, 0], [-0.7, 0, 0.7], false), 3);
  });

  it("comes back to itself when the shader clock wraps, so the colour never jumps", () => {
    const wrapped = tripHue(1, CLOCK_WRAP_S, [2, 5], [0.2, 0.1, 0.97], false);
    const start = tripHue(1, 0, [2, 5], [0.2, 0.1, 0.97], false);
    expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(start), 6);
    expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(start), 6);
  });
});

describe("tripSwell", () => {
  it("is flat when sober", () => {
    expect(tripSwell(0, 40, [10, 20])).toBe(0);
  });

  it("stays within its height, a little under half a tile", () => {
    let highest = 0;
    for (let x = 0; x < 64; x += 1.7) {
      for (let y = 0; y < 64; y += 2.3) {
        highest = Math.max(highest, Math.abs(tripSwell(1, x * 0.1, [x, y])));
      }
    }
    expect(highest).toBeGreaterThan(0.2);
    expect(highest).toBeLessThanOrEqual(0.45 + 1e-9);
  });

  it("is seamless round the planet and across the clock's wrap", () => {
    expect(tripSwell(1, 3, [PLANET_TILES + 12.5, 40])).toBeCloseTo(tripSwell(1, 3, [12.5, 40]), 6);
    expect(tripSwell(1, 3, [12.5, 40 - PLANET_TILES])).toBeCloseTo(tripSwell(1, 3, [12.5, 40]), 6);
    expect(tripSwell(1, 3 + CLOCK_WRAP_S, [12.5, 40])).toBeCloseTo(tripSwell(1, 3, [12.5, 40]), 6);
  });
});

describe("tripBreath", () => {
  it("is exactly unit scale when sober", () => {
    expect(tripBreath(0, 17, [4, 4])).toBe(1);
  });

  it("swells and shrinks a body by under a tenth, later the further it stands from the hero", () => {
    const near = tripBreath(1, 0.75, [0, 0]);
    const far = tripBreath(1, 0.75, [6, 0]);
    expect(Math.abs(near - 1)).toBeLessThanOrEqual(0.08 + 1e-9);
    expect(near).not.toBeCloseTo(far, 3);
  });
});

describe("the tripped sky", () => {
  const noon = atmosphereAt(13);

  it("is the same atmosphere when sober", () => {
    expect(trippedAtmosphere(noon, 0, 99)).toBe(noon);
  });

  it("drifts only the sky's two colours, leaving the light and the haze", () => {
    const tripped = trippedAtmosphere(noon, 1, 20);
    expect(tripped.skyTop).not.toBe(noon.skyTop);
    expect(tripped.skyHorizon).not.toBe(noon.skyHorizon);
    expect(tripped.haze).toBe(noon.haze);
    expect(tripped.ambient).toBe(noon.ambient);
    expect(tripped.light).toEqual(noon.light);
  });

  it("clears the mirror to the sky's complement at a full trip, and to the sky itself when sober", () => {
    expect(tripMirrorSky([0.3, 0.5, 0.9], 0)).toEqual([0.3, 0.5, 0.9]);
    const flipped = tripMirrorSky([0.3, 0.5, 0.9], 1);
    expect(flipped[0]).toBeGreaterThan(flipped[2]);
  });

  it("writes hex a colour can be read back from", () => {
    expect(hexOf([1, 0, 0.5])).toBe("#ff0080");
    expect(hexOf([-1, 2, 0])).toBe("#00ff00");
  });
});

describe("parseFx", () => {
  const all = TRIP_FX.haze | TRIP_FX.neon | TRIP_FX.curl | TRIP_FX.sky | TRIP_FX.trails;

  it("runs every extra when absent, empty or `all`", () => {
    expect(parseFx(null)).toBe(all);
    expect(parseFx("")).toBe(all);
    expect(parseFx("sky,all")).toBe(all);
  });

  it("runs only the named ones, any case, skipping a name it does not know", () => {
    const fx = parseFx(" Sky , trails,glitter");
    expect(fx).toBe(TRIP_FX.sky | TRIP_FX.trails);
    expect(hasFx(fx, "sky")).toBe(true);
    expect(hasFx(fx, "neon")).toBe(false);
  });

  it("runs none for `none`, so the three core terms can be seen alone", () => {
    expect(parseFx("none")).toBe(0);
  });

  it("gives each switch its own bit", () => {
    const bits = Object.values(TRIP_FX);
    expect(bits.reduce((sum, bit) => sum + bit, 0)).toBe(all);
    for (const bit of bits) {
      expect(Math.log2(bit) % 1).toBe(0);
    }
  });
});

describe("tripHazeTurn", () => {
  it("turns opposite bearings opposite ways, so turning round sweeps the hue", () => {
    expect(tripHazeTurn(1, [40, 0])).toBeCloseTo(TRIP.hazeX, 9);
    expect(tripHazeTurn(1, [-40, 0])).toBeCloseTo(-TRIP.hazeX, 9);
    expect(tripHazeTurn(1, [0, 10])).toBeCloseTo(TRIP.hazeY, 9);
  });

  it("depends on the bearing alone, is nothing at the hero, and nothing when sober", () => {
    expect(tripHazeTurn(1, [3, 4])).toBeCloseTo(tripHazeTurn(1, [30, 40]), 9);
    expect(tripHazeTurn(1, [0, 0])).toBe(0);
    expect(tripHazeTurn(0, [3, 4])).toBe(0);
  });
});

describe("tripNeon", () => {
  const brightness = (c: Rgb): number => c[0] + c[1] + c[2];

  it("glows on a face turned edge-on to the viewer, and not on one facing them", () => {
    const facing = tripNeon(1, 0, [2, 2], TRIP.view, 1);
    const edgeOn = tripNeon(1, 0, [2, 2], [1, 0, 0], 1);
    expect(brightness(facing)).toBeCloseTo(0, 9);
    expect(brightness(edgeOn)).toBeGreaterThan(0.5);
  });

  it("glows brighter at night, and not at all when sober", () => {
    expect(brightness(tripNeon(1, 0, [2, 2], [1, 0, 0], 0))).toBeGreaterThan(brightness(tripNeon(1, 0, [2, 2], [1, 0, 0], 1)));
    expect(tripNeon(0, 5, [2, 2], [1, 0, 0], 0)).toEqual([0, 0, 0]);
  });

  it("looks the way the projection does not move a point: back toward the near rows, and up", () => {
    const [x, y, z] = TRIP.view;
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });
});

describe("tripCurl", () => {
  it("only ever lifts the lip, by up to its whole height again, and not when sober", () => {
    for (let x = -20; x <= 20; x += 0.7) {
      const curl = tripCurl(1, x * 0.3, x);
      expect(curl).toBeGreaterThanOrEqual(0.1 * TRIP.curl - 1e-9);
      expect(curl).toBeLessThanOrEqual(TRIP.curl + 1e-9);
    }
    expect(tripCurl(0, 4, 3)).toBe(0);
  });

  it("rolls across the screen, so the horizon is a wave rather than a step", () => {
    expect(tripCurl(1, 0, 0)).not.toBeCloseTo(tripCurl(1, 0, 10), 3);
  });
});

describe("tripDepth", () => {
  it("keeps the overhead world behind everything the world itself draws", () => {
    expect(tripDepth(1, false)).toBeLessThanOrEqual(tripDepth(0, true));
    expect(tripDepth(0, false)).toBe(0);
    expect(tripDepth(1, true)).toBeCloseTo(1, 9);
  });

  it("keeps each range in order, so both still depth-test among themselves", () => {
    expect(tripDepth(0.3, false)).toBeLessThan(tripDepth(0.6, false));
    expect(tripDepth(0.3, true)).toBeLessThan(tripDepth(0.6, true));
  });
});

describe("trailFrame", () => {
  const view = lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, 20);
  const frame = { trip: 1, fx: TRIP_FX.trails, view, width: 1280, height: 720 };

  it("is nothing when sober or switched off, so the pass is never drawn for nothing", () => {
    expect(trailFrame({ ...frame, trip: 0 })).toBeUndefined();
    expect(trailFrame({ ...frame, fx: TRIP_FX.sky })).toBeUndefined();
  });

  it("keeps a share of the last frame, warped about the hero's foot", () => {
    const trail = trailFrame(frame)!;
    expect(trail.keep).toBe(TRIP.trailKeep);
    expect(trail.keep).toBeLessThan(1);
    expect(trail.centre[0]).toBeCloseTo(view.footX / view.width, 9);
    expect(trail.centre[1]).toBeCloseTo(view.footY / view.height, 9);
    expect(trailFrame({ ...frame, trip: 0.5 })!.zoom).toBeCloseTo(trail.zoom / 2, 9);
  });
});
