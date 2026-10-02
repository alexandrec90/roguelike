import { describe, expect, it } from "vitest";

import { fromLocal, stepForward, type PlanetPose } from "../planet";
import { terrainAt } from "../terrain";
import {
  cellTerrain,
  DIRT,
  GRASS,
  lazyGroundSample,
  planetHash,
  prefetchGroundSample,
  sampleGround,
  sharedGroundSample,
} from "./ground-sample";

const BOUNDS = { minX: -4, maxX: 4, minY: -3, maxY: 5 };
const POSE: PlanetPose = { x: 91.3, y: 17.8, turn: 0.4 };
const CODES = { grass: GRASS, dirt: DIRT } as const;

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

  it("hands over a sample taken ahead as the very one, identical to taking it on arrival", () => {
    const here = sharedGroundSample(POSE, BOUNDS);
    const next = stepForward(POSE, 1);
    const ahead = prefetchGroundSample(next, BOUNDS);
    // Taking it ahead does not make it the one the next inherits from...
    expect(sharedGroundSample(POSE, BOUNDS)).toBe(here);
    // ...and arriving hands over exactly what was taken ahead.
    expect(sharedGroundSample(next, BOUNDS)).toBe(ahead);
    const fresh = sampleGround(next, BOUNDS, here);
    expect([...ahead.hashes]).toEqual([...fresh.hashes]);
    expect([...ahead.terrain]).toEqual([...fresh.terrain]);
  });

  it("drops a sample taken ahead for a pose that never came", () => {
    const here = sharedGroundSample(POSE, BOUNDS);
    const guessed = prefetchGroundSample(stepForward(POSE, 1), BOUNDS);
    const other = stepForward(POSE, -1);
    const arrived = sharedGroundSample(other, BOUNDS);
    expect(arrived).not.toBe(guessed);
    expect([...arrived.hashes]).toEqual([...sampleGround(other, BOUNDS, here).hashes]);
  });

  it("hashes a planet point stably, and neighbouring nodes differently", () => {
    expect(planetHash(10.1, 20.2)).toBe(planetHash(10.1, 20.2));
    expect(planetHash(10, 20)).not.toBe(planetHash(10.5, 20));
    expect(planetHash(10, 20)).not.toBe(planetHash(10, 20.5));
  });
});

describe("the lattice read on demand", () => {
  const WIDE = { minX: -30, maxX: 30, minY: 4, maxY: 40 };
  const previous = sampleGround(POSE, BOUNDS);
  const full = sampleGround(POSE, WIDE, previous);

  function node(sample: typeof full, a: number, b: number): readonly number[] {
    const index = b * sample.latticeWidth + a;
    return [
      sample.terrain[index] ?? -1,
      sample.hashes[index] ?? -1,
      sample.planetX[index] ?? -1,
      sample.planetY[index] ?? -1,
    ];
  }

  it("reads exactly the nodes the whole sample reads, around each cell it is asked about", () => {
    const lazy = lazyGroundSample(POSE, WIDE, previous);
    const cells = [
      [0, 5],
      [-30, 4],
      [30, 40],
      [12, 22],
    ] as const;
    for (const [x, y] of cells) {
      lazy.readAround(x, y);
      const a = (x - WIDE.minX) * 2;
      const b = (y - WIDE.minY) * 2;
      for (let nb = Math.max(b - 2, 0); nb <= Math.min(b + 4, full.latticeHeight - 1); nb += 1) {
        for (let na = Math.max(a - 2, 0); na <= Math.min(a + 4, full.latticeWidth - 1); na += 1) {
          expect(node(lazy.sample, na, nb)).toEqual(node(full, na, nb));
        }
      }
      expect(cellTerrain(lazy.sample, x, y)).toBe(cellTerrain(full, x, y));
    }
  });

  it("inherits the field's hashes where the two overlap, so the seam is one tile", () => {
    const lazy = lazyGroundSample(POSE, WIDE, previous);
    lazy.readAround(0, 5);
    // Local (0, 5) is inside BOUNDS: its centre node is a node of `previous` too.
    const here = lazy.sample.hashes[(5 - WIDE.minY) * 2 * lazy.sample.latticeWidth + (0 - WIDE.minX) * 2 + 1];
    const there = previous.hashes[(5 - BOUNDS.minY) * 2 * previous.latticeWidth + (0 - BOUNDS.minX) * 2 + 1];
    expect(here).toBe(there);
  });

  it("leaves a node nobody asked about unread", () => {
    const lazy = lazyGroundSample(POSE, WIDE, previous);
    lazy.readAround(0, 5);
    const far = (lazy.sample.latticeHeight - 1) * lazy.sample.latticeWidth;
    expect(lazy.sample.planetX[far]).toBe(0);
    expect(lazy.sample.hashes[far]).toBe(0);
  });
});
