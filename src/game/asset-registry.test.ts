import { describe, expect, it } from "vitest";

import {
  ASSET_REGISTRY,
  AUTHORED_VARIANT_ID,
  assetFrame,
  findAsset,
  findVariant,
  textureKey,
  validateRegistry,
  type AssetEntry,
} from "./asset-registry";

const TWO_FRAMES: AssetEntry = {
  id: "probe",
  label: "Probe",
  category: "prop",
  frames: [
    { palette: { ".": null, a: "#111111" }, rows: ["a."] },
    { palette: { ".": null, a: "#222222" }, rows: [".a"] },
  ],
  frameDurationMs: 100,
  variants: [
    { id: AUTHORED_VARIANT_ID, label: "Authored", overrides: {} },
    { id: "red", label: "Red", overrides: { a: "#ff0000" } },
  ],
};

describe("ASSET_REGISTRY", () => {
  it("holds to every structural rule", () => {
    expect(validateRegistry(ASSET_REGISTRY)).toEqual([]);
  });

  it("covers each category the lab groups by", () => {
    const categories = new Set(ASSET_REGISTRY.map((entry) => entry.category));

    expect([...categories].sort()).toEqual(["actor", "effect", "prop", "tile"]);
  });

  it("gives every entry at least one palette swap to compare against", () => {
    for (const entry of ASSET_REGISTRY) {
      expect(entry.variants.length).toBeGreaterThan(1);
    }
  });
});

describe("findAsset / findVariant", () => {
  it("looks entries up by id", () => {
    expect(findAsset("hero")?.category).toBe("actor");
    expect(findAsset("nope")).toBeUndefined();
  });

  it("looks variants up within an entry", () => {
    expect(findVariant(TWO_FRAMES, "red")?.label).toBe("Red");
    expect(findVariant(TWO_FRAMES, "blue")).toBeUndefined();
  });
});

describe("assetFrame", () => {
  it("returns the authored source untouched", () => {
    expect(assetFrame(TWO_FRAMES, 0)).toBe(TWO_FRAMES.frames[0]);
  });

  it("applies the variant palette", () => {
    expect(assetFrame(TWO_FRAMES, 0, "red").palette["a"]).toBe("#ff0000");
  });

  it("keeps the frame's own silhouette when swapping", () => {
    expect(assetFrame(TWO_FRAMES, 1, "red").rows).toEqual([".a"]);
  });

  it("wraps an out-of-range index instead of throwing mid-frame", () => {
    expect(assetFrame(TWO_FRAMES, 2)).toBe(TWO_FRAMES.frames[0]);
    expect(assetFrame(TWO_FRAMES, -1)).toBe(TWO_FRAMES.frames[1]);
  });

  it("falls back to the authored palette for an unknown variant", () => {
    expect(assetFrame(TWO_FRAMES, 0, "ghost")).toBe(TWO_FRAMES.frames[0]);
  });
});

describe("textureKey", () => {
  it("is stable and collision-free across variants and frames", () => {
    expect(textureKey("hero", "frost", 2)).toBe("asset:hero:frost:2");
    expect(textureKey("hero", "frost", 2)).not.toBe(textureKey("hero", "hit", 2));
  });

  it("namespaces derived textures with a suffix", () => {
    expect(textureKey("grass", "authored", 0, "3x3")).toBe("asset:grass:authored:0:3x3");
  });
});

describe("validateRegistry", () => {
  it("reports a duplicate id", () => {
    expect(validateRegistry([TWO_FRAMES, TWO_FRAMES])).toContain("Duplicate asset id 'probe'");
  });

  it("reports an override that targets a token the art does not use", () => {
    const entry: AssetEntry = {
      ...TWO_FRAMES,
      variants: [
        { id: AUTHORED_VARIANT_ID, label: "Authored", overrides: {} },
        { id: "typo", label: "Typo", overrides: { z: "#ff0000" } },
      ],
    };

    expect(validateRegistry([entry])).toEqual([
      "Asset 'probe' variant 'typo' targets unused token 'z'",
    ]);
  });

  it("reports frames that disagree about the canvas size", () => {
    const entry: AssetEntry = {
      ...TWO_FRAMES,
      frames: [
        { palette: { a: "#111111" }, rows: ["a"] },
        { palette: { a: "#111111" }, rows: ["aa"] },
      ],
    };

    expect(validateRegistry([entry])).toEqual(["Asset 'probe' mixes frame sizes: 1x1, 2x1"]);
  });

  it("reports a frame that cannot be rasterized", () => {
    const entry: AssetEntry = { ...TWO_FRAMES, frames: [{ palette: {}, rows: ["?"] }] };

    expect(validateRegistry([entry])[0]).toMatch(/does not rasterize/);
  });

  it("reports an entry with no frames and no variants", () => {
    const entry: AssetEntry = { ...TWO_FRAMES, frames: [], variants: [] };

    expect(validateRegistry([entry])).toEqual([
      "Asset 'probe' has no frames",
      "Asset 'probe' has no variants",
    ]);
  });

  it("reports a variant list that does not lead with the authored palette", () => {
    const entry: AssetEntry = {
      ...TWO_FRAMES,
      variants: [{ id: "red", label: "Red", overrides: { a: "#ff0000" } }],
    };

    expect(validateRegistry([entry])).toContain("Asset 'probe' does not lead with the authored palette");
  });

  it("reports a clip whose frames would never advance", () => {
    expect(validateRegistry([{ ...TWO_FRAMES, frameDurationMs: 0 }])).toContain(
      "Asset 'probe' has a non-positive frame duration",
    );
  });
});
