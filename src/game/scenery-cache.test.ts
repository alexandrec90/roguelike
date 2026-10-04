import { describe, expect, it } from "vitest";

import type { TextureStore } from "../engine";
import { quantizeLight, WIND_LEVELS } from "./scenery-bake";
import { InlineBaker, type Baker } from "./scenery-baker";
import { SceneryCache } from "./scenery-cache";
import type { SceneryFeature } from "./scenery-features";

/** Just enough of a texture store for the cache to install into. */
function fakeTextures(): { manager: TextureStore; keys: Set<string> } {
  const keys = new Set<string>();
  const manager = {
    exists: (key: string) => keys.has(key),
    remove: (key: string) => keys.delete(key),
    addBytes: (key: string) => {
      keys.add(key);
      return { add: () => undefined };
    },
  };
  return { manager: manager as unknown as TextureStore, keys };
}

const OAK: SceneryFeature = { x: 10, y: 10, seed: 11, size: 0, species: "oak-recursive" };
const STONE: SceneryFeature = { x: 12, y: 10, seed: 12, size: 0, species: "boulder" };
const REST = Math.floor(WIND_LEVELS.length / 2);

function drain(cache: SceneryCache): void {
  for (let guard = 0; guard < 400 && cache.pending() > 0; guard += 1) {
    cache.pump(50);
  }
}

function cacheWith(baker: Baker = new InlineBaker()): { cache: SceneryCache; keys: Set<string> } {
  const { manager, keys } = fakeTextures();
  return { cache: new SceneryCache(manager, baker), keys };
}

describe("the scenery cache", () => {
  it("never bakes on the frame it is asked: the lean arrives on a later pump", () => {
    const { cache, keys } = cacheWith();
    expect(cache.lean(OAK, REST)).toBeUndefined();
    expect(cache.pending()).toBe(WIND_LEVELS.length);
    cache.pump(0);
    const lean = cache.lean(OAK, REST);
    expect(lean).toBeDefined();
    expect(keys.has(lean!.body.key)).toBe(true);
  });

  it("serves every lean once the queue drains, each its own picture", () => {
    const { cache } = cacheWith();
    cache.lean(OAK, REST);
    drain(cache);
    const bodies = WIND_LEVELS.map((_level, index) => cache.lean(OAK, index)!.body.key);
    expect(new Set(bodies).size).toBe(WIND_LEVELS.length);
    expect(cache.pending()).toBe(0);
  });

  it("asks for the rest lean first, so the likeliest picture lands first", () => {
    const { cache } = cacheWith();
    cache.lean(OAK, 0);
    cache.pump(0);
    // One bake in: whatever lean was asked for, the one shown is the rest lean.
    expect(cache.lean(OAK, 0)!.body.key).toBe(cache.lean(OAK, REST)!.body.key);
  });

  it("bakes a body with no integrator once, whatever the wind", () => {
    const { cache } = cacheWith();
    cache.lean(STONE, 0);
    drain(cache);
    expect(cache.lean(STONE, WIND_LEVELS.length - 1)!.body.key).toBe(cache.lean(STONE, 0)!.body.key);
  });

  it("keeps the old light until a re-bake is whole, then retires it", () => {
    const { cache, keys } = cacheWith();
    cache.lean(OAK, REST);
    drain(cache);
    const before = cache.lean(OAK, REST)!.body.key;
    cache.setLight(quantizeLight({ x: 0.9, y: -0.4 }, 0.3));
    expect(cache.lean(OAK, REST)!.body.key).toBe(before);
    cache.pump(0);
    expect(cache.lean(OAK, REST)!.body.key).toBe(before);
    drain(cache);
    const after = cache.lean(OAK, REST)!.body.key;
    expect(after).not.toBe(before);
    cache.pump(1);
    expect(keys.has(before)).toBe(false);
  });

  it("warms every body it is given, and says when each has a picture at full size and far", () => {
    const { cache } = cacheWith();
    cache.warm([OAK, STONE]);
    expect(cache.warmed()).toBe(false);
    drain(cache);
    expect(cache.warmed()).toBe(true);
    expect(cache.lean(OAK, 0)).toBeDefined();
    expect(cache.scaled(STONE, 0.3)).toBeDefined();
  });

  it("bakes every horizon scale of a body as one ladder: one job, one texture, a frame per rung", () => {
    const { cache, keys } = cacheWith();
    expect(cache.scaled(OAK, 0.3)).toBeUndefined();
    expect(cache.pending()).toBe(1);
    const before = keys.size;
    drain(cache);
    expect(keys.size).toBe(before + 1);
    const near = cache.scaled(OAK, 0.3)!;
    const nearer = cache.scaled(OAK, 0.325)!;
    expect(nearer.key).toBe(near.key);
    expect(nearer.frame).not.toBe(near.frame);
    // Every scale from a speck to full size is a rung; none asks for another bake.
    expect(cache.scaled(OAK, 0.001)!.frame).toBe("0");
    expect(cache.scaled(OAK, 0.999)!.key).toBe(near.key);
    expect(cache.pending()).toBe(0);
  });

  it("keeps a horizon body on screen across a change of light", () => {
    const { cache, keys } = cacheWith();
    cache.warm([OAK]);
    drain(cache);
    const before = cache.scaled(OAK, 0.3)!;
    cache.setLight(quantizeLight({ x: 0.9, y: -0.4 }, 0.3));
    expect(cache.scaled(OAK, 0.3)).toEqual(before);
    drain(cache);
    const after = cache.scaled(OAK, 0.3)!;
    expect(after.key).not.toBe(before.key);
    cache.pump(1);
    expect(keys.has(before.key)).toBe(false);
  });

  it("re-bakes a prewarmed body in a new light before it is ever drawn full size", () => {
    const { cache } = cacheWith();
    cache.warm([OAK]);
    drain(cache);
    const before = cache.lean(OAK, REST)!.body.key;
    cache.setLight(quantizeLight({ x: 0.9, y: -0.4 }, 0.3));
    cache.prewarm(OAK);
    expect(cache.pending()).toBe(WIND_LEVELS.length);
    drain(cache);
    expect(cache.lean(OAK, REST)!.body.key).not.toBe(before);
    expect(cache.pending()).toBe(0);
  });

  it("drops a bake for a light that was superseded before it landed", () => {
    const { cache } = cacheWith();
    cache.lean(OAK, REST);
    drain(cache);
    cache.setLight(quantizeLight({ x: 0.9, y: -0.4 }, 0.3));
    cache.lean(OAK, REST);
    cache.setLight(quantizeLight({ x: -0.9, y: -0.4 }, 0.5));
    drain(cache);
    // Only the newest light's set is asked for again; nothing is left waiting.
    expect(cache.pending()).toBe(0);
    cache.lean(OAK, REST);
    drain(cache);
    expect(cache.pending()).toBe(0);
  });

  it("returns nothing for a species it does not know, and asks for nothing", () => {
    const { cache } = cacheWith();
    expect(cache.lean({ ...OAK, species: "nope" }, 0)).toBeUndefined();
    expect(cache.scaled({ ...OAK, species: "nope" }, 0.5)).toBeUndefined();
    expect(cache.pending()).toBe(0);
  });
});
