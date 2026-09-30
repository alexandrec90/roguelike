import { describe, expect, it } from "vitest";

import type Phaser from "phaser";

import { quantizeLight, WIND_LEVELS } from "./scenery-bake";
import { SceneryCache } from "./scenery-cache";
import type { SceneryFeature } from "./scenery-features";

/** Just enough of a texture manager for the cache to install into. */
function fakeTextures(): { manager: Phaser.Textures.TextureManager; keys: Set<string> } {
  const keys = new Set<string>();
  const manager = {
    exists: (key: string) => keys.has(key),
    remove: (key: string) => keys.delete(key),
    createCanvas: (key: string) => {
      keys.add(key);
      return {
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => undefined,
        }),
        add: () => undefined,
        refresh: () => undefined,
      };
    },
  };
  return { manager: manager as unknown as Phaser.Textures.TextureManager, keys };
}

const OAK: SceneryFeature = { x: 10, y: 10, seed: 11, size: 0, species: "oak-recursive" };
const STONE: SceneryFeature = { x: 12, y: 10, seed: 12, size: 0, species: "boulder" };
const REST = Math.floor(WIND_LEVELS.length / 2);

function drain(cache: SceneryCache): void {
  for (let guard = 0; guard < 200 && cache.pending() > 0; guard += 1) {
    cache.pump(50);
  }
}

describe("the scenery cache", () => {
  it("bakes the lean it is asked for on the spot, and queues the rest", () => {
    const { manager, keys } = fakeTextures();
    const cache = new SceneryCache(manager);
    const lean = cache.lean(OAK, REST);
    expect(lean).toBeDefined();
    expect(keys.has(lean!.body.key)).toBe(true);
    expect(cache.pending()).toBe(WIND_LEVELS.length);
  });

  it("serves every lean once the queue drains, each its own picture", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    cache.lean(OAK, REST);
    drain(cache);
    const bodies = WIND_LEVELS.map((_level, index) => cache.lean(OAK, index)!.body.key);
    expect(new Set(bodies).size).toBe(WIND_LEVELS.length);
    expect(cache.pending()).toBe(0);
  });

  it("bakes a body with no integrator once, whatever the wind", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    const still = cache.lean(STONE, 0)!.body.key;
    drain(cache);
    expect(cache.lean(STONE, WIND_LEVELS.length - 1)!.body.key).toBe(still);
  });

  it("keeps the old light until a re-bake is whole, then retires it", () => {
    const { manager, keys } = fakeTextures();
    const cache = new SceneryCache(manager);
    cache.lean(OAK, REST);
    drain(cache);
    const before = cache.lean(OAK, REST)!.body.key;
    cache.setLight(quantizeLight({ x: 0.9, y: -0.4 }, 0.3));
    expect(cache.lean(OAK, REST)!.body.key).toBe(before);
    drain(cache);
    const after = cache.lean(OAK, REST)!.body.key;
    expect(after).not.toBe(before);
    cache.pump(1);
    expect(keys.has(before)).toBe(false);
  });

  it("bakes horizon specks small, and warms the full size as they near", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    const far = cache.scaled(OAK, 0.2);
    expect(far).toBeDefined();
    expect(cache.pending()).toBe(0);
    cache.scaled(OAK, 0.8);
    expect(cache.pending()).toBe(WIND_LEVELS.length);
  });

  it("bakes at most one body on the spot a frame; the rest wait for the queue", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    expect(cache.lean(OAK, REST)).toBeDefined();
    expect(cache.lean({ ...OAK, seed: 99 }, REST)).toBeUndefined();
    cache.pump(0);
    expect(cache.lean({ ...OAK, seed: 99 }, REST)).toBeDefined();
  });

  it("warms a body before it is seen", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    cache.prewarm(OAK);
    expect(cache.pending()).toBe(WIND_LEVELS.length);
    drain(cache);
    expect(cache.lean(OAK, 0)).toBeDefined();
    expect(cache.pending()).toBe(0);
  });

  it("returns nothing for a species it does not know", () => {
    const { manager } = fakeTextures();
    const cache = new SceneryCache(manager);
    expect(cache.lean({ ...OAK, species: "nope" }, 0)).toBeUndefined();
    expect(cache.scaled({ ...OAK, species: "nope" }, 0.5)).toBeUndefined();
  });
});
