import { describe, expect, it } from "vitest";

import { FLAT_LOOK, PAINTED_LOOK, parseLook } from "./look";
import { BLOB_FACES, blob } from "./primitives";
import { MeshBuilder, VERTEX_BYTES } from "./mesh";
import { faceTint, PAINT } from "./palette";
import { WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID } from "./shaders";
import { worldWgsl } from "./webgpu/wgsl-world";

describe("?look=", () => {
  it("is painted only when asked for by name, and flat otherwise", () => {
    expect(parseLook("painted")).toBe(PAINTED_LOOK);
    expect(parseLook(" Painted ")).toBe(PAINTED_LOOK);
    expect(parseLook(null)).toBe(FLAT_LOOK);
    expect(parseLook("")).toBe(FLAT_LOOK);
    expect(parseLook("watercolour")).toBe(FLAT_LOOK);
  });

  it("steps the light only in the painted look, and only it grows hills", () => {
    expect(FLAT_LOOK.stepped).toBe(0);
    expect(PAINTED_LOOK.stepped).toBe(1);
    expect(FLAT_LOOK.hills).toBe(0);
    expect(PAINTED_LOOK.hills).toBeGreaterThan(0);
    // Under a tile, or `groundInView`'s margin behind the near edge no longer covers it.
    expect(PAINTED_LOOK.hills).toBeLessThan(1);
  });
});

describe("a face's tint", () => {
  it("is the flat look's brightness nudge by default, and never strays in hue", () => {
    const colour = [0.5, 0.6, 0.4] as const;
    for (let seed = 0; seed < 50; seed += 1) {
      const [r, g, b] = faceTint(colour, seed);
      expect(r / colour[0]).toBeCloseTo(g / colour[1], 9);
      expect(g / colour[1]).toBeCloseTo(b / colour[2], 9);
      expect(Math.abs(r / colour[0] - 1)).toBeLessThanOrEqual(FLAT_LOOK.faceSpread + 1e-9);
    }
  });

  it("drifts in hue under the painted look, and takes the accent only where a face may", () => {
    const colour = [0.5, 0.6, 0.4] as const;
    let drifted = 0;
    let accents = 0;
    for (let seed = 0; seed < 2000; seed += 1) {
      const [r, g] = faceTint(colour, seed, PAINTED_LOOK);
      if (Math.abs(r / colour[0] - g / colour[1]) > 0.02) {
        drifted += 1;
      }
      expect(faceTint(colour, seed, PAINTED_LOOK)).not.toBe(PAINT.accent);
      if (faceTint(colour, seed, PAINTED_LOOK, true) === PAINT.accent) {
        accents += 1;
      }
    }
    // The lean is anywhere from none to `hueDrift`, so a good share - not all - visibly leave the material's hue.
    expect(drifted).toBeGreaterThan(2000 * 0.3);
    // Rare: about `accent` of the faces that are allowed one.
    expect(accents).toBeGreaterThan(2000 * PAINTED_LOOK.accent * 0.5);
    expect(accents).toBeLessThan(2000 * PAINTED_LOOK.accent * 1.5);
  });
});

/** Every vertex's position in a mesh. */
function positions(b: MeshBuilder): [number, number, number][] {
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: b.vertexCount }, (_, i) => [0, 4, 8].map((o) => view.getFloat32(i * VERTEX_BYTES + o, true)) as [number, number, number]);
}

describe("a painted blob", () => {
  it("is the flat look's blob, byte for byte, when no look is given", () => {
    const plain = new MeshBuilder();
    const flat = new MeshBuilder();
    blob(plain, [1, 1, 1], [1, 1, 0.5], { colour: [0.5, 0.5, 0.5] }, 42);
    blob(flat, [1, 1, 1], [1, 1, 0.5], { colour: [0.5, 0.5, 0.5] }, 42, { jitter: 0.15, look: FLAT_LOOK, crown: true });
    expect(flat.bytesView()).toEqual(plain.bytesView());
  });

  it("is a crown drawn up into a point, still twenty faces, and seeded", () => {
    const flat = new MeshBuilder();
    const one = new MeshBuilder();
    const two = new MeshBuilder();
    blob(flat, [0, 0, 0], [1, 1, 1], { colour: [0.5, 0.5, 0.5] }, 7, { jitter: 0 });
    blob(one, [0, 0, 0], [1, 1, 1], { colour: [0.5, 0.5, 0.5] }, 7, { jitter: 0, look: PAINTED_LOOK, crown: true });
    blob(two, [0, 0, 0], [1, 1, 1], { colour: [0.5, 0.5, 0.5] }, 7, { jitter: 0, look: PAINTED_LOOK, crown: true });
    expect(one.vertexCount).toBe(BLOB_FACES * 3);
    expect(one.bytesView()).toEqual(two.bytesView());
    const top = (b: MeshBuilder): number => Math.max(...positions(b).map((p) => p[2]));
    const bottom = (b: MeshBuilder): number => Math.min(...positions(b).map((p) => p[2]));
    // Both ends move by the seeded stretch; only the top by the peak as well.
    const stretched = bottom(one) / bottom(flat);
    expect(Math.abs(stretched - 1)).toBeLessThanOrEqual(PAINTED_LOOK.stretch + 1e-6);
    expect(top(one) / top(flat) / stretched).toBeGreaterThan(1 + PAINTED_LOOK.peak * 0.5);
  });
});

describe("the shaders' painted light", () => {
  it("is in both backends, behind the shading uniform's fourth channel", () => {
    for (const source of [WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID]) {
      expect(source).toContain("uniform vec4 u_shading;");
      expect(source).toContain("if (u_shading.w > 0.5)");
      expect(source).toContain("vec3 painted(");
    }
    for (const clips of [true, false]) {
      const source = worldWgsl(clips);
      expect(source).toContain("if (frame.shading.w > 0.5)");
      expect(source).toContain("fn painted(");
    }
  });
});
