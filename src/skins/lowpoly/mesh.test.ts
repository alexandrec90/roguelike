import { describe, expect, it } from "vitest";

import { faceNormal, Kind, MeshBuilder, mixRgb, rgb, shadeRgb, VERTEX_BYTES } from "./mesh";
import { BLOB_FACES, blob, cone, disc, frond, frondFaces, frustum, SMOOTH_FACES, smoothBlob } from "./primitives";

/** Read back vertex `i`: position, anchor, normal, kind and colour. */
function vertex(b: MeshBuilder, i: number) {
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const at = i * VERTEX_BYTES;
  return {
    pos: [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)],
    anchor: [view.getFloat32(at + 12, true), view.getFloat32(at + 16, true)],
    normal: [view.getInt8(at + 20) / 127, view.getInt8(at + 21) / 127, view.getInt8(at + 22) / 127],
    kind: view.getUint8(at + 23),
    colour: [view.getUint8(at + 24), view.getUint8(at + 25), view.getUint8(at + 26), view.getUint8(at + 27)],
  };
}

describe("the mesh builder", () => {
  it("packs a flat triangle: three vertices sharing the face's normal and colour", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], { colour: [1, 0, 0], anchor: [5, 6] });
    expect(b.vertexCount).toBe(3);
    const first = vertex(b, 0);
    expect(first.normal[2]).toBeCloseTo(1, 2);
    expect(first.anchor).toEqual([5, 6]);
    expect(first.colour).toEqual([255, 0, 0, 255]);
    expect(first.kind).toBe(Kind.body);
  });

  it("anchors a vertex at itself when no foot is given - the ground bends point by point", () => {
    const b = new MeshBuilder();
    b.tri([2, 3, 0], [3, 3, 0], [2, 4, 0], { colour: [0, 1, 0], kind: Kind.ground });
    expect(vertex(b, 1).anchor).toEqual([3, 3]);
  });

  it("turns anything lying on the ground to face the sky, however it was wound", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [0, 1, 0], [1, 0, 0], { colour: [0, 1, 0], kind: Kind.ground });
    expect(vertex(b, 0).normal[2]).toBeCloseTo(1, 2);
  });

  it("turns a body's face away from its inside", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 1], [0, 1, 1], [1, 0, 1], { colour: [1, 1, 1], inside: [0, 0, 0] });
    expect(vertex(b, 0).normal[2]).toBeCloseTo(1, 2);
  });

  it("keeps the normal it is handed at each corner of a smooth triangle", () => {
    const b = new MeshBuilder();
    b.smoothTri([0, 0, 0], [1, 0, 0], [0, 1, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], { colour: [1, 1, 1] });
    expect(vertex(b, 0).normal).toEqual([1, 0, 0]);
    expect(vertex(b, 1).normal).toEqual([0, 1, 0]);
    expect(vertex(b, 2).normal).toEqual([0, 0, 1]);
    b.smoothTri([0, 0, 0], [1, 1, 1], [2, 2, 2], [[1, 0, 0], [1, 0, 0], [1, 0, 0]], { colour: [1, 1, 1] });
    expect(b.vertexCount).toBe(3);
  });

  it("drops a sliver with no area, and grows past its first allocation", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [1, 1, 1], [2, 2, 2], { colour: [1, 1, 1] });
    expect(b.vertexCount).toBe(0);
    for (let i = 0; i < 500; i += 1) {
      b.tri([i, 0, 0], [i + 1, 0, 0], [i, 1, 0], { colour: [1, 1, 1] });
    }
    expect(b.vertexCount).toBe(1500);
    expect(vertex(b, 1497).pos).toEqual([499, 0, 0]);
    b.reset();
    expect(b.bytesView().byteLength).toBe(0);
  });

  it("has a unit normal or none", () => {
    expect(faceNormal([0, 0, 0], [2, 0, 0], [0, 3, 0])).toEqual([0, 0, 1]);
    expect(faceNormal([0, 0, 0], [0, 0, 0], [0, 3, 0])).toBeNull();
  });

  it("reads and mixes colours", () => {
    expect(rgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
    expect(shadeRgb([0.5, 0.5, 0.5], 0.2)).toEqual([0.6, 0.6, 0.6]);
  });
});

describe("the solids", () => {
  /** Every face's normal points away from `centre`. */
  function outward(b: MeshBuilder, centre: readonly number[]): boolean {
    for (let i = 0; i < b.vertexCount; i += 3) {
      const [p, q, r] = [vertex(b, i), vertex(b, i + 1), vertex(b, i + 2)];
      const mid = [0, 1, 2].map((k) => (p.pos[k]! + q.pos[k]! + r.pos[k]!) / 3 - centre[k]!);
      if (p.normal[0]! * mid[0]! + p.normal[1]! * mid[1]! + p.normal[2]! * mid[2]! < -1e-6) {
        return false;
      }
    }
    return true;
  }

  it("a prism has sides and two caps, every face outward", () => {
    const b = new MeshBuilder();
    frustum(b, { from: [0, 0, 0], to: [0, 0, 2], r0: 0.5, r1: 0.3, sides: 6 }, { colour: [1, 1, 1] });
    expect(b.vertexCount).toBe((6 * 2 + 4 * 2) * 3);
    expect(outward(b, [0, 0, 1])).toBe(true);
  });

  it("an uncapped prism is its sides alone", () => {
    const b = new MeshBuilder();
    frustum(b, { from: [0, 0, 0], to: [1, 0, 1], r0: 0.2, r1: 0.1, sides: 4, capped: false }, { colour: [1, 1, 1] });
    expect(b.vertexCount).toBe(4 * 2 * 3);
    expect(outward(b, [0.5, 0, 0.5])).toBe(true);
  });

  it("a frond is two faces a point, every one turned to the sky, seeded", () => {
    const shape = { centre: [0, 0, 1] as const, radius: 1, teeth: 5, lift: 0.3, droop: 0.2 };
    const one = new MeshBuilder();
    const two = new MeshBuilder();
    frond(one, shape, { colour: [0.5, 0.5, 0.5] }, 9);
    frond(two, shape, { colour: [0.5, 0.5, 0.5] }, 9);
    expect(one.vertexCount).toBe(frondFaces(5) * 3);
    expect(one.bytesView()).toEqual(two.bytesView());
    for (let i = 0; i < one.vertexCount; i += 1) {
      expect(vertex(one, i).normal[2]).toBeGreaterThan(0);
    }
    // The middle stands above the notches, and the points hang below them.
    const heights = Array.from({ length: one.vertexCount }, (_, i) => vertex(one, i).pos[2]!);
    expect(Math.max(...heights)).toBeCloseTo(1.3, 5);
    expect(Math.min(...heights)).toBeLessThan(1);
  });

  it("a cone is a fan to its apex over a capped base", () => {
    const b = new MeshBuilder();
    cone(b, { base: [0, 0, 0], height: 2, radius: 1, sides: 6 }, { colour: [1, 1, 1] });
    expect(b.vertexCount).toBe((6 + 4) * 3);
    expect(outward(b, [0, 0, 0.6])).toBe(true);
  });

  it("a blob is the twenty faces of an icosahedron, seeded, every face outward", () => {
    const one = new MeshBuilder();
    const two = new MeshBuilder();
    blob(one, [1, 1, 1], [1, 1, 0.5], { colour: [0.5, 0.5, 0.5] }, 42);
    blob(two, [1, 1, 1], [1, 1, 0.5], { colour: [0.5, 0.5, 0.5] }, 42);
    expect(one.vertexCount).toBe(BLOB_FACES * 3);
    expect(one.bytesView()).toEqual(two.bytesView());
    expect(outward(one, [1, 1, 1])).toBe(true);
  });

  it("a smooth blob is the icosahedron split in four, a normal per corner pointing out", () => {
    const b = new MeshBuilder();
    smoothBlob(b, (d) => [1 + d[0], 2 + d[1] * 0.5, 3 + d[2] * 2], { colour: [1, 1, 1], kind: Kind.liquid });
    expect(b.vertexCount).toBe(SMOOTH_FACES * 3);
    expect(SMOOTH_FACES).toBe(80);
    for (let i = 0; i < b.vertexCount; i += 1) {
      const v = vertex(b, i);
      const out = [v.pos[0]! - 1, v.pos[1]! - 2, v.pos[2]! - 3];
      expect(v.normal[0]! * out[0]! + v.normal[1]! * out[1]! + v.normal[2]! * out[2]!).toBeGreaterThan(0);
      expect(v.kind).toBe(Kind.liquid);
    }
    // Corners of one face carry different normals: that is what makes it read as curved.
    expect(vertex(b, 0).normal).not.toEqual(vertex(b, 1).normal);
  });

  it("a smooth blob made for one eye keeps only the faces turned toward it", () => {
    const all = new MeshBuilder();
    const front = new MeshBuilder();
    const sphere = (d: readonly number[]) => [d[0]!, d[1]!, d[2]!] as const;
    smoothBlob(all, sphere, { colour: [1, 1, 1] });
    smoothBlob(front, sphere, { colour: [1, 1, 1] }, [0, -1, 0]);
    expect(front.vertexCount).toBeGreaterThan(all.vertexCount * 0.35);
    expect(front.vertexCount).toBeLessThan(all.vertexCount * 0.65);
    for (let i = 0; i < front.vertexCount; i += 3) {
      const centroidY = (vertex(front, i).pos[1]! + vertex(front, i + 1).pos[1]! + vertex(front, i + 2).pos[1]!) / 3;
      expect(centroidY).toBeLessThan(0);
    }
  });

  it("does not turn jelly to face the sky the way it does what lies on the ground", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [0, 1, 0], [1, 0, 0], { colour: [1, 1, 1], kind: Kind.liquid });
    expect(vertex(b, 0).normal[2]).toBeCloseTo(-1, 2);
  });

  it("a disc lies flat at its height, with a radius per corner if asked", () => {
    const b = new MeshBuilder();
    disc(b, [0, 0, 0.1], (corner) => 1 + corner * 0.1, 8, { colour: [1, 1, 1], kind: Kind.water });
    expect(b.vertexCount).toBe(24);
    expect(vertex(b, 0).pos[2]).toBeCloseTo(0.1, 6);
    expect(vertex(b, 0).normal[2]).toBeCloseTo(1, 2);
  });
});
