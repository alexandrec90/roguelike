import { describe, expect, it } from "vitest";

import type { AssetEntry } from "../game/asset-registry";
import { normalizeLabState, parseLabState, serializeLabState, snapZoom } from "./lab-state";

const REGISTRY: readonly AssetEntry[] = [
  {
    id: "walker",
    label: "Walker",
    category: "actor",
    frames: [
      { palette: { a: "#ffffff" }, rows: ["a"] },
      { palette: { a: "#ffffff" }, rows: ["a"] },
      { palette: { a: "#ffffff" }, rows: ["a"] },
    ],
    frameDurationMs: 100,
    variants: [
      { id: "authored", label: "Authored", overrides: {} },
      { id: "frost", label: "Frost", overrides: { a: "#88ccff" } },
    ],
  },
  {
    id: "slab",
    label: "Slab",
    category: "tile",
    frames: [{ palette: { a: "#ffffff" }, rows: ["a"] }],
    frameDurationMs: 100,
    variants: [{ id: "authored", label: "Authored", overrides: {} }],
  },
];

describe("normalizeLabState", () => {
  it("opens on the first asset, playing, at the authored palette", () => {
    const state = normalizeLabState({}, REGISTRY);

    expect(state.assetId).toBe("walker");
    expect(state.variantId).toBe("authored");
    expect(state.playing).toBe(true);
    expect(state.zoom).toBe(4);
    expect(state.background).toBe("duo");
  });

  it("falls back to the first asset when the id is unknown", () => {
    expect(normalizeLabState({ assetId: "ghost" }, REGISTRY).assetId).toBe("walker");
  });

  it("falls back to the authored palette when the variant is unknown", () => {
    const state = normalizeLabState({ assetId: "walker", variantId: "plaid" }, REGISTRY);

    expect(state.variantId).toBe("authored");
  });

  it("wraps a frame index into the clip", () => {
    expect(normalizeLabState({ frame: 4 }, REGISTRY).frame).toBe(1);
    expect(normalizeLabState({ frame: -1 }, REGISTRY).frame).toBe(2);
  });

  it("snaps zoom to a whole step and rejects negative time", () => {
    expect(normalizeLabState({ zoom: 5 }, REGISTRY).zoom).toBe(4);
    expect(normalizeLabState({ zoom: 99 }, REGISTRY).zoom).toBe(8);
    expect(normalizeLabState({ timeMs: -20 }, REGISTRY).timeMs).toBe(0);
  });

  it("opens terrain tiled and everything else single", () => {
    expect(normalizeLabState({ assetId: "slab" }, REGISTRY).tiled).toBe(true);
    expect(normalizeLabState({ assetId: "walker" }, REGISTRY).tiled).toBe(false);
  });

  it("lets an explicit choice override the per-category default", () => {
    expect(normalizeLabState({ assetId: "slab", tiled: false }, REGISTRY).tiled).toBe(false);
  });

  it("refuses to tile anything that is not terrain", () => {
    // Reachable by switching assets while tiled, and by any stale URL.
    expect(normalizeLabState({ assetId: "walker", tiled: true }, REGISTRY).tiled).toBe(false);
  });

  it("ignores an unknown background mode", () => {
    const state = normalizeLabState(
      { background: "rainbow" as unknown as "duo" },
      REGISTRY,
    );

    expect(state.background).toBe("duo");
  });

  it("refuses to invent a view when there is nothing to show", () => {
    expect(() => normalizeLabState({}, [])).toThrow(/registry is empty/);
  });
});

describe("parseLabState / serializeLabState", () => {
  it("round-trips a full view", () => {
    const state = normalizeLabState(
      {
        assetId: "walker",
        variantId: "frost",
        frame: 2,
        playing: false,
        timeMs: 640,
        zoom: 6,
        background: "checker",
        grid: true,
        bounds: true,
        tiled: true,
      },
      REGISTRY,
    );

    expect(parseLabState(serializeLabState(state), REGISTRY)).toEqual(state);
  });

  it("reads a hand-written query string", () => {
    const state = parseLabState("?asset=slab&zoom=2&play=0&grid=1", REGISTRY);

    expect(state).toMatchObject({ assetId: "slab", zoom: 2, playing: false, grid: true });
  });

  it("tolerates a leading question mark or not", () => {
    expect(parseLabState("asset=slab", REGISTRY).assetId).toBe("slab");
  });

  it("ignores junk values rather than failing to open", () => {
    const state = parseLabState("?asset=slab&zoom=wide&frame=x&play=maybe", REGISTRY);

    expect(state).toMatchObject({ assetId: "slab", zoom: 4, frame: 0, playing: true });
  });

  it("writes every field, so a pasted link reproduces the view exactly", () => {
    const query = serializeLabState(normalizeLabState({ assetId: "walker" }, REGISTRY));

    for (const key of ["asset", "variant", "frame", "zoom", "bg", "play", "t", "grid", "bounds"]) {
      expect(query).toContain(`${key}=`);
    }
  });
});

describe("snapZoom", () => {
  it("picks the nearest whole step", () => {
    expect(snapZoom(3.4)).toBe(3);
    expect(snapZoom(0)).toBe(1);
    expect(snapZoom(7)).toBe(6);
  });
});
