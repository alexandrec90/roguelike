import { describe, expect, it } from "vitest";

import { broadleafMesh, type Canopy } from "./broadleaf-mesh";
import { BALL_VERTICES, IMPOSTOR_BYTES, ImpostorBuilder } from "./impostor";
import { FLAT_LOOK } from "./look";
import { Kind, MeshBuilder, VERTEX_BYTES } from "./mesh";
import { LOWPOLY } from "./palette";
import { sceneryMesh } from "./scenery-mesh";

const CANOPY: Canopy = { leaf: LOWPOLY.leaf, trunk: 0.4, limbs: 3, limb: 0.28, spread: 0.75, twigs: 2, twig: 0.17, clump: 0.18, tiers: 3, heart: true };
const FOOT = [10, 20, 0.5] as const;
const HEIGHT = 3.6;

interface Vertex {
  readonly pos: readonly [number, number, number];
  readonly anchor: readonly [number, number];
  readonly normalZ: number;
  readonly bark: boolean;
}

function vertices(b: MeshBuilder): Vertex[] {
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const bark = LOWPOLY.bark.map((c) => Math.round(c * 255));
  return Array.from({ length: b.vertexCount }, (_, i) => {
    const at = i * VERTEX_BYTES;
    return {
      pos: [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)],
      anchor: [view.getFloat32(at + 12, true), view.getFloat32(at + 16, true)],
      normalZ: view.getInt8(at + 22) / 127,
      bark: [0, 1, 2].every((k) => view.getUint8(at + 24 + k) === bark[k]),
    };
  });
}

function grow(seed: number, canopy: Canopy = CANOPY): { mesh: MeshBuilder; shadow: number } {
  const mesh = new MeshBuilder();
  const shadow = broadleafMesh(canopy)(mesh, FOOT, HEIGHT, seed);
  return { mesh, shadow };
}

const across = (v: Vertex): number => Math.hypot(v.pos[0] - FOOT[0], v.pos[1] - FOOT[1]);

describe("a broadleaf", () => {
  it("is the same tree for the same seed, and another for another", () => {
    expect(grow(7).mesh.bytesView()).toEqual(grow(7).mesh.bytesView());
    expect(grow(8).mesh.bytesView()).not.toEqual(grow(7).mesh.bytesView());
  });

  it("is one body: every vertex is anchored at its foot, so it rides the lip whole", () => {
    for (const v of vertices(grow(3).mesh)) {
      expect(v.anchor[0]).toBeCloseTo(FOOT[0], 4);
      expect(v.anchor[1]).toBeCloseTo(FOOT[1], 4);
    }
  });

  it("stands about its height, from its foot", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const heights = vertices(grow(seed).mesh).map((v) => v.pos[2] - FOOT[2]);
      // The trunk's foot ring tilts with its lean, so one edge dips a sliver into the ground.
      expect(Math.abs(Math.min(...heights))).toBeLessThan(0.03);
      expect(Math.max(...heights)).toBeGreaterThan(HEIGHT * 0.75);
      expect(Math.max(...heights)).toBeLessThan(HEIGHT * 1.2);
    }
  });

  it("branches: wood reaches out from the trunk, not just up it", () => {
    const wood = vertices(grow(4).mesh).filter((v) => v.bark);
    expect(wood.length).toBeGreaterThan(0);
    expect(Math.max(...wood.map(across))).toBeGreaterThan(HEIGHT * 0.25);
  });

  it("lays its leaves in plates facing the sky", () => {
    const leaves = vertices(grow(5).mesh).filter((v) => !v.bark);
    expect(leaves.length).toBeGreaterThan(0);
    for (const v of leaves) {
      expect(v.normalZ).toBeGreaterThan(0);
    }
  });

  it("casts a shadow no wider than its crown", () => {
    const { mesh, shadow } = grow(6);
    expect(shadow).toBeGreaterThan(0);
    expect(shadow).toBeLessThan(Math.max(...vertices(mesh).map(across)));
  });

  it("given impostor leaves, wears a ball where each clump was, and keeps only its wood as mesh", () => {
    const mesh = new MeshBuilder();
    const leaves = new ImpostorBuilder();
    const shadow = broadleafMesh(CANOPY)(mesh, FOOT, HEIGHT, 5, FLAT_LOOK, leaves);
    // Three limbs of two twigs, and the heart: a clump each.
    expect(leaves.balls).toBe(CANOPY.limbs * CANOPY.twigs + 1);
    expect(vertices(mesh).every((v) => v.bark)).toBe(true);
    const bytes = leaves.bytesView();
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < leaves.balls; i += 1) {
      const at = i * BALL_VERTICES * IMPOSTOR_BYTES;
      // Anchored at the tree's foot, so the crown sways and rides the lip with its trunk.
      expect(data.getFloat32(at + 12, true)).toBeCloseTo(FOOT[0], 4);
      expect(data.getFloat32(at + 16, true)).toBeCloseTo(FOOT[1], 4);
      expect(data.getFloat32(at + 8, true)).toBeGreaterThan(FOOT[2] + HEIGHT * 0.3);
      expect(data.getUint8(at + 28)).toBe(Kind.foliage);
    }
    // The same crown, so the same shadow.
    expect(shadow).toBeCloseTo(grow(5).shadow, 9);
  });

  it("gives a bush impostor leaves too: a mound of balls and no faceted blob", () => {
    const solid = new MeshBuilder();
    const leaves = new ImpostorBuilder();
    sceneryMesh(solid, new MeshBuilder(), "bush", [0, 0, 0], 9, { leaves });
    expect(solid.vertexCount).toBe(0);
    expect(leaves.balls).toBe(3);
  });

  it("keeps every species within a triangle budget: the whole wood is drawn every frame", () => {
    for (const species of ["sdf-crown", "oak-recursive", "noise-canopy", "colonized-ash"]) {
      for (const seed of [11, 12, 13]) {
        const solid = new MeshBuilder();
        sceneryMesh(solid, new MeshBuilder(), species, [0, 0, 0], seed);
        expect(solid.vertexCount / 3).toBeLessThanOrEqual(300);
      }
    }
  });
});
