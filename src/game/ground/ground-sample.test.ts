import { describe, expect, it } from "vitest";

import { fromLocal, stepForward, type PlanetPose } from "../planet";
import { terrainAt } from "../terrain";
import {
  cellTerrain,
  DIRT,
  GRASS,
  planetHash,
  ROCK,
  sampleGround,
  sharedGroundSample,
} from "./ground-sample";

const BOUNDS = { minX: -4, maxX: 4, minY: -3, maxY: 5 };
const POSE: PlanetPose = { x: 91.3, y: 17.8, turn: 0.4 };
const CODES = { grass: GRASS, dirt: DIRT, rock: ROCK } as const;

describe("the ground lattice", () => {
  const sample = sampleGround(POSE, BOUNDS);

  it("has three nodes per cell edge, shared between neighbours", () => {
    expect(sample.columns).toBe(9);
    expect(sample.rows).toBe(9);
    expect(sample.latticeWidth).toBe(19);
    expect(sample.latticeHeight).toBe(19);
    expect(sample.terrain).toHaveLength(19 * 19);
  });

  it("gives every cell exactly the terrain `terrainAt` gives its sample point", () => {
    // Collision reads terrainAt at the cell's own point; the art must agree.
    for (let y = BOUNDS.minY; y <= BOUNDS.maxY; y += 1) {
      for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 1) {
        expect(cellTerrain(sample, x, y)).toBe(CODES[terrainAt(fromLocal(POSE, { x, y }))]);
      }
    }
  });

  it("is deterministic", () => {
    const again = sampleGround(POSE, BOUNDS);
    expect([...again.terrain]).toEqual([...sample.terrain]);
    expect([...again.hashes]).toEqual([...sample.hashes]);
  });

  it("keeps a node's hash when a step brings it back to a lattice point", () => {
    const next = stepForward(POSE, 1);
    const moved = sampleGround(next, BOUNDS, sample);
    // One tile forward is two lattice rows: row b of the new sample reads what
    // row b + 2 of the old one read.
    let kept = 0;
    let total = 0;
    for (let b = 0; b < moved.latticeHeight - 2; b += 1) {
      for (let a = 0; a < moved.latticeWidth; a += 1) {
        total += 1;
        if (moved.hashes[b * moved.latticeWidth + a] === sample.hashes[(b + 2) * sample.latticeWidth + a]) {
          kept += 1;
        }
      }
    }
    expect(kept).toBe(total);
  });

  it("remembers the last sample for the same pose and bounds", () => {
    const first = sharedGroundSample(POSE, BOUNDS);
    expect(sharedGroundSample(POSE, { ...BOUNDS })).toBe(first);
    expect(sharedGroundSample({ ...POSE }, BOUNDS)).not.toBe(first);
  });

  it("hashes a planet point stably, and neighbouring nodes differently", () => {
    expect(planetHash(10.1, 20.2)).toBe(planetHash(10.1, 20.2));
    expect(planetHash(10, 20)).not.toBe(planetHash(10.5, 20));
    expect(planetHash(10, 20)).not.toBe(planetHash(10, 20.5));
  });
});
