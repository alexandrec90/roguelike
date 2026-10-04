import { describe, expect, it } from "vitest";

import {
  CAVE_CELL,
  CAVE_MOUTH,
  caveDistance,
  caveIn,
  caveMouthAt,
  cavesNear,
  CHAMBER_RADIUS,
  chamberBlocked,
  inMouth,
  MOUTH_CLEARING,
  nearCaveMouth,
  openForMouth,
  planetCaves,
} from "./caves";
import { blockedGround } from "./lakes";
import { PLANET_TILES, wrapTile } from "./planet";
import { sceneryNear } from "./scenery-features";
import { puddlesNear, treesNear } from "./terrain";

const CAVES = planetCaves();

describe("planetCaves", () => {
  it("places the same caves every time it is asked", () => {
    expect(planetCaves()).toBe(CAVES);
    const cells = PLANET_TILES / CAVE_CELL;
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        expect(caveIn(x, y)).toEqual(caveIn(x, y));
      }
    }
  });

  it("puts one within a few tiles of where a session opens", () => {
    const start = { x: 128, y: 128 };
    expect(CAVES.some((cave) => caveDistance(cave, start) < 10)).toBe(true);
  });

  it("opens every mouth on dry, walkable ground", () => {
    expect(CAVES.length).toBeGreaterThan(2);
    for (const cave of CAVES) {
      expect(blockedGround(cave)).toBe(false);
      expect(openForMouth(cave)).toBe(true);
    }
  });

  it("keeps chambers from overlapping, and ids unique", () => {
    for (const a of CAVES) {
      for (const b of CAVES) {
        if (a !== b) {
          expect(caveDistance(a, b)).toBeGreaterThan(CHAMBER_RADIUS * 2);
          expect(a.id).not.toBe(b.id);
        }
      }
    }
  });
});

describe("caveDistance", () => {
  it("measures across the planet's seam", () => {
    expect(caveDistance({ x: 0.5, y: 10 }, { x: PLANET_TILES - 0.5, y: 10 })).toBeCloseTo(1);
  });
});

describe("cavesNear", () => {
  it("finds a cave from beside it and not from the far side of the planet", () => {
    const cave = CAVES[0]!;
    expect(cavesNear(cave, 2)).toContain(cave);
    const far = { x: wrapTile(cave.x + PLANET_TILES / 2), y: wrapTile(cave.y + PLANET_TILES / 2) };
    expect(cavesNear(far, 4)).not.toContain(cave);
  });
});

describe("mouths", () => {
  it("takes a walker in only on the mouth itself", () => {
    const cave = CAVES[0]!;
    expect(caveMouthAt(cave)).toBe(cave);
    expect(caveMouthAt({ x: cave.x + CAVE_MOUTH * 0.9, y: cave.y })).toBe(cave);
    expect(caveMouthAt({ x: wrapTile(cave.x + CAVE_MOUTH * 1.5), y: cave.y })).toBeUndefined();
    expect(inMouth(cave, { x: cave.x, y: wrapTile(cave.y + 2) })).toBe(false);
  });
});

describe("the clearing before a mouth", () => {
  it("grows no tree and holds no puddle, so nothing stands in front of the way in", () => {
    for (const cave of CAVES) {
      expect(nearCaveMouth(cave)).toBe(true);
      for (const feature of [...treesNear(cave, 4), ...puddlesNear(cave, 4), ...sceneryNear(cave, 4)]) {
        expect(caveDistance(cave, feature)).toBeGreaterThanOrEqual(MOUTH_CLEARING);
      }
    }
  });
});

describe("chamberBlocked", () => {
  it("walls the chamber at its radius, round the mouth", () => {
    const cave = CAVES[0]!;
    expect(chamberBlocked(cave, cave)).toBe(false);
    expect(chamberBlocked(cave, { x: wrapTile(cave.x + CHAMBER_RADIUS - 0.5), y: cave.y })).toBe(false);
    expect(chamberBlocked(cave, { x: cave.x, y: wrapTile(cave.y - CHAMBER_RADIUS - 0.5) })).toBe(true);
  });
});
