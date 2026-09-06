import { describe, expect, it } from "vitest";

import { cloudBounds, type PixelCloud } from "../ink";
import { rasterizeSprite } from "../pixel-art";
import { INK_RAMPS } from "../shading";
import { castShadow, leafCluster, litter } from "./foliage";
import {
  findSpecies,
  sampleSpeciesFrames,
  SCENERY_SPECIES,
  stageTree,
  TREE_SPECIES,
  type SceneryEnv,
  type SceneryInstance,
} from "./index";
import { DEFAULT_SCENERY_ENV } from "../scenery";

function envAt(elapsedMs: number, overrides: Partial<SceneryEnv> = {}): SceneryEnv {
  return { ...DEFAULT_SCENERY_ENV, elapsedMs, ...overrides };
}

/** Drive an instance in fixed slices, as the gallery and the baker both do. */
function play(instance: SceneryInstance, untilMs: number, overrides: Partial<SceneryEnv> = {}): PixelCloud {
  let elapsed = 0;
  while (elapsed < untilMs) {
    elapsed = Math.min(elapsed + 16, untilMs);
    instance.step?.(16, envAt(elapsed, overrides));
  }
  return instance.cloud(envAt(elapsed, overrides));
}

describe("the species catalogue", () => {
  it("has a unique id, a technique and a footprint for every species", () => {
    const ids = new Set(SCENERY_SPECIES.map((species) => species.id));
    expect(ids.size).toBe(SCENERY_SPECIES.length);
    expect(TREE_SPECIES.length).toBeGreaterThanOrEqual(8);
    expect(SCENERY_SPECIES.length).toBeGreaterThan(TREE_SPECIES.length);
    for (const species of SCENERY_SPECIES) {
      expect(species.technique.length).toBeGreaterThan(10);
      expect(species.footprint.width).toBeGreaterThan(0);
      expect(species.footprint.height).toBeGreaterThan(0);
    }
  });

  it("finds a species by id and reports a miss", () => {
    expect(findSpecies("sdf-crown")?.label).toContain("Chestnut");
    expect(findSpecies("no-such-tree")).toBeUndefined();
  });
});

describe.each(SCENERY_SPECIES.map((species) => [species.id, species] as const))(
  "species %s",
  (_id, species) => {
    it("draws lit pixels rooted at the ground", () => {
      const cloud = play(species.create(0x51), 900);
      expect(cloud.length).toBeGreaterThan(20);
      const bounds = cloudBounds(cloud);
      expect(bounds?.bottom).toBeLessThanOrEqual(1);
      expect(bounds?.top).toBeLessThan(-4);
    });

    it("fits inside the footprint it claims", () => {
      const cloud = play(species.create(0x77), 2400);
      const bounds = cloudBounds(cloud);
      const { width, height, originX, originY } = species.footprint;
      expect(bounds?.left ?? 0).toBeGreaterThanOrEqual(-originX);
      expect(bounds?.right ?? 0).toBeLessThan(width - originX);
      expect(bounds?.top ?? 0).toBeGreaterThanOrEqual(-originY);
      expect(bounds?.bottom ?? 0).toBeLessThan(height - originY);
    });

    it.runIf(species.kind === "tree")("moves in the wind and stays still without it", () => {
      const blown = JSON.stringify(play(species.create(5), 2600, { wind: { strength: 2 } }));
      const calm = JSON.stringify(play(species.create(5), 2600, { wind: { strength: 0 } }));
      expect(blown).not.toBe(calm);
    });

    it("is a different body at a different seed", () => {
      expect(JSON.stringify(play(species.create(1), 600))).not.toBe(
        JSON.stringify(play(species.create(2), 600)),
      );
    });

    it("is reproducible: the same seed and the same slices give the same pixels", () => {
      expect(JSON.stringify(play(species.create(9), 1600))).toBe(
        JSON.stringify(play(species.create(9), 1600)),
      );
    });

    it("bakes a consistent filmstrip for the asset lab", () => {
      const frames = sampleSpeciesFrames(species, 4, 0x31, 2000);
      expect(frames).toHaveLength(4);
      const sizes = new Set(frames.map((frame) => `${rasterizeSprite(frame).width}`));
      expect(sizes.size).toBe(1);
    });
  },
);

describe("baking", () => {
  it("rejects a frame count that is not a positive integer", () => {
    const species = TREE_SPECIES[0];
    expect(species).toBeDefined();
    expect(() => sampleSpeciesFrames(species!, 0, 1)).toThrow(/positive integer/);
  });
});

describe("staging", () => {
  const species = TREE_SPECIES[0]!;

  it("adds a void shadow under the tree and nothing else new", () => {
    const instance = species.create(3);
    const bare = stageTree(instance, envAt(0), { shadow: false });
    const shadowed = stageTree(instance, envAt(0), { shadow: true });
    expect(shadowed.length).toBeGreaterThan(bare.length);
    expect(shadowed.some((pixel) => pixel.ink === "void" && pixel.y > 0)).toBe(true);
  });

  it("puts the reflection below the foot only when asked", () => {
    const instance = species.create(3);
    const dry = stageTree(instance, envAt(0), { shadow: false });
    const wet = stageTree(instance, envAt(0), { shadow: false, reflection: true });
    expect(dry.every((pixel) => pixel.y <= 0)).toBe(true);
    expect(wet.some((pixel) => pixel.y > 0)).toBe(true);
  });

  it("clips the reflection to the depth of water there is to reflect into", () => {
    const instance = species.create(3);
    const pooled = stageTree(instance, envAt(0), {
      shadow: false,
      reflection: true,
      reflectionDepth: 6,
    });
    expect(pooled.some((pixel) => pixel.y > 0)).toBe(true);
    expect(pooled.every((pixel) => pixel.y <= 6)).toBe(true);
  });
});

describe("shared foliage parts", () => {
  it("casts a shadow that leans away from the light and lands on the ground", () => {
    const canopy: PixelCloud = [{ x: 0, y: -20, ink: "neon-green" }];
    const fromLeft = castShadow(canopy, { light: { x: -1, y: -0.4 }, softness: 0 });
    const fromRight = castShadow(canopy, { light: { x: 1, y: -0.4 }, softness: 0 });
    expect(fromLeft[0]?.x ?? 0).toBeGreaterThan(0);
    expect(fromRight[0]?.x ?? 0).toBeLessThan(0);
    expect(fromLeft.every((pixel) => pixel.y > 0 && pixel.ink === "void")).toBe(true);
  });

  it("rakes the shadow further as the sun drops", () => {
    const canopy: PixelCloud = [{ x: 0, y: -20, ink: "neon-green" }];
    const reach = (elevation: number): number =>
      castShadow(canopy, { light: { x: -1, y: -0.4 }, elevation, softness: 0 })[0]?.x ?? 0;
    expect(reach(0.2)).toBeGreaterThan(reach(0.9));
  });

  it("scales the shadow with height instead of clamping it flat", () => {
    // The regression: capping each pixel's reach individually put every pixel
    // above the cap on one row, so a whole canopy's shadow drew as a single
    // black stripe. Green tests said nothing; the screen said everything.
    const canopy: PixelCloud = [-8, -20, -34].map((y) => ({ x: 0, y, ink: "neon-green" as const }));
    const rows = new Set(
      castShadow(canopy, { light: { x: -1, y: -0.5 }, elevation: 0.4, softness: 0 }).map(
        (pixel) => pixel.y,
      ),
    );
    expect(rows.size).toBeGreaterThan(1);
  });

  it("keeps the whole shadow within reach of the trunk", () => {
    const tall: PixelCloud = [{ x: 0, y: -120, ink: "neon-green" }];
    const cast = castShadow(tall, { light: { x: -1, y: 0 }, elevation: 0.15, softness: 0 });
    expect(cast.every((pixel) => Math.abs(pixel.x) <= 30 && pixel.y <= 30)).toBe(true);
  });

  it("ignores pixels already on the ground, which cast nothing", () => {
    expect(castShadow([{ x: 2, y: 0, ink: "deep" }], { light: { x: -1, y: -1 } })).toEqual([]);
  });

  it("grows a leaf clump inside its radii, inked from the ramp it was given", () => {
    const cloud: PixelCloud = [];
    leafCluster(cloud, {
      x: 0,
      y: -10,
      radiusX: 5,
      radiusY: 3,
      seed: 4,
      elapsedMs: 0,
      ramp: INK_RAMPS.verdant,
    });
    expect(cloud.length).toBeGreaterThan(10);
    expect(cloud.every((pixel) => Math.abs(pixel.x) <= 6 && Math.abs(pixel.y + 10) <= 4)).toBe(true);
    expect(cloud.every((pixel) => INK_RAMPS.verdant.includes(pixel.ink))).toBe(true);
  });

  it("changes the clump's silhouette over time without moving it", () => {
    const at = (elapsedMs: number): string => {
      const cloud: PixelCloud = [];
      leafCluster(cloud, { x: 0, y: 0, radiusX: 6, radiusY: 4, seed: 8, elapsedMs, ramp: INK_RAMPS.verdant });
      return JSON.stringify(cloud);
    };
    expect(at(0)).not.toBe(at(1800));
  });

  it("scatters litter at the foot", () => {
    const cloud: PixelCloud = [];
    litter(cloud, 6, 2, "deep");
    expect(cloud.every((pixel) => pixel.y <= 0 && pixel.y > -3)).toBe(true);
  });
});
