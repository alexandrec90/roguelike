import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { planetLakes, type Lake } from "./lakes";
import { toLocal, type PlanetPose } from "./planet";
import { puddleHolds, type Puddle } from "./puddles";
import { puddlesNear } from "./terrain";
import { createMask, fillMask, maskRows } from "./water/mask";
import { growPuddles, joinRows, warmNextLake } from "./water-layer";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const POSE: PlanetPose = { x: 124, y: 80, turn: 0.4 };

describe("growPuddles", () => {
  it("grows one puddle per site in reach, centred where the field puts the site", () => {
    const sites = puddlesNear(POSE, 20);
    // Lakes are grown too, ahead of the puddles; this is about the puddles.
    const puddles = growPuddles(FRAME, POSE, 20, 1).filter((puddle) => !puddle.lake);
    expect(puddles).toHaveLength(sites.length);
    expect(puddles.length).toBeGreaterThan(0);
    const first = sites[0];
    const local = first === undefined ? { x: 0, y: 0 } : toLocal(POSE, first);
    expect(puddles[0]?.centerX).toBe(Math.round(FRAME.footX + local.x * 16));
    expect(puddles[0]?.centerY).toBe(Math.round(FRAME.footY - local.y * 12));
  });

  it("ignores the stride in flight: puddles are laid out on the zero-phase grid", () => {
    expect(growPuddles({ ...FRAME, phaseX: 0.4, phaseY: 0.7 }, POSE, 20, 1)).toEqual(growPuddles(FRAME, POSE, 20, 1));
  });

  it("passes over a site its caller cannot see before tracing its outline", () => {
    const ahead = growPuddles(FRAME, POSE, 20, 1, { keep: (local) => local.y > 0 });
    const all = growPuddles(FRAME, POSE, 20, 1);
    expect(ahead.length).toBeLessThan(all.length);
    expect(ahead.every((puddle) => puddle.centerY < FRAME.footY)).toBe(true);
  });

  it("sweeps a disc round a local point when asked, for a reach that is not centred on the hero", () => {
    const far = growPuddles(FRAME, POSE, 10, 1, { around: { x: 0, y: 30 } });
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((puddle) => FRAME.footY - puddle.centerY > 19 * 12)).toBe(true);
  });

  it("fills a mask whose wet rows bound every puddle's water", () => {
    const puddles = growPuddles(FRAME, POSE, 20, 1);
    const mask = createMask(320, 180, 20);
    fillMask(mask, puddles);
    const rows = maskRows(mask)!;
    const ys = puddles
      .flatMap((puddle) => puddle.water.map((pixel) => pixel.y + mask.margin))
      .filter((y) => y >= 0 && y < mask.height);
    expect(rows.from).toBe(Math.min(...ys));
    expect(rows.to).toBe(Math.max(...ys) + 1);
    expect(maskRows(createMask(10, 10, 0))).toBeUndefined();
  });

  it("swells every puddle with the wet weather's scale", () => {
    const dry = growPuddles(FRAME, POSE, 20, 1);
    const wet = growPuddles(FRAME, POSE, 20, 1.5);
    expect(wet.reduce((sum, puddle) => sum + puddle.water.length, 0)).toBeGreaterThan(
      dry.reduce((sum, puddle) => sum + puddle.water.length, 0),
    );
  });
});

describe("growPuddles, by a lake", () => {
  const lake = planetLakes().find((candidate) => candidate.deep > 0) as Lake;
  // Standing a few tiles off its centre, facing it: its shore is in view, its centre too.
  const BY_LAKE: PlanetPose = { x: lake.x, y: lake.y - 4, turn: 0 };

  it("grows the lake first, as its own outline with its deep core, and no puddle in it", () => {
    const grown = growPuddles(FRAME, BY_LAKE, 20, 1);
    const id = `lake:${Math.round(lake.x)}:${Math.round(lake.y)}`;
    const water = grown.find((puddle) => puddle.id === id) as Puddle;
    expect(water.radiusX).toBe(lake.size);
    expect(water.deepX).toBe(lake.deepSize);
    const local = toLocal(BY_LAKE, lake);
    expect(water.centerX).toBe(Math.round(FRAME.footX + local.x * 16));
    expect(water.centerY).toBe(Math.round(FRAME.footY - local.y * 12));
    const lakes = grown.filter((puddle) => puddle.id.startsWith("lake:"));
    expect(grown.slice(0, lakes.length)).toEqual(lakes);
    for (const puddle of grown.slice(lakes.length)) {
      expect(puddleHolds(water, puddle.centerX, puddle.centerY)).toBe(false);
    }
  });

  it("does not swell a lake with the rain, only the puddles", () => {
    const lakeOf = (scale: number): Puddle | undefined =>
      growPuddles(FRAME, BY_LAKE, 20, scale).find((puddle) => puddle.id.startsWith("lake:"));
    expect(lakeOf(1.5)?.water.length).toBe(lakeOf(1)?.water.length);
  });

  it("finds a lake by its shore when its centre is out of reach, and tells keep how far it reaches", () => {
    const reach = 3;
    const away: PlanetPose = { x: lake.x, y: lake.y - lake.shore - reach + 0.5, turn: 0 };
    const extents: number[] = [];
    const grown = growPuddles(FRAME, away, reach, 1, {
      keep: (_local, extent) => {
        extents.push(extent.y);
        return true;
      },
    });
    expect(grown.some((puddle) => puddle.id.startsWith("lake:"))).toBe(true);
    expect(extents).toContain(lake.reach);
  });
});

describe("warmNextLake", () => {
  it("works through every lake on the planet once, then reports none left", () => {
    let calls = 0;
    while (warmNextLake()) {
      calls += 1;
      expect(calls).toBeLessThan(planetLakes().length);
    }
    expect(warmNextLake()).toBe(false);
  });
});

describe("joinRows", () => {
  it("spans both bands, keeps one when the other is missing, and is empty with neither", () => {
    expect(joinRows({ from: 10, to: 20 }, { from: 15, to: 40 })).toEqual({ from: 10, to: 40 });
    expect(joinRows(undefined, { from: 3, to: 4 })).toEqual({ from: 3, to: 4 });
    expect(joinRows({ from: 3, to: 4 }, undefined)).toEqual({ from: 3, to: 4 });
    expect(joinRows(undefined, undefined)).toEqual({ from: 0, to: 0 });
  });
});
