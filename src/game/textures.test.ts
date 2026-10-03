import { describe, expect, it } from "vitest";

import { ASSET_REGISTRY, textureKey, type AssetEntry } from "./asset-registry";
import type { PixelSpriteSource } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import {
  installAssetTextures,
  installPixelTexture,
  TILE_PREVIEW_COLUMNS,
  TILE_PREVIEW_ROWS,
  TILE_PREVIEW_SUFFIX,
  type TextureHost,
} from "./textures";

interface FakeTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function fakeHost(): { host: TextureHost; textures: Map<string, FakeTexture>; uploads: string[] } {
  const textures = new Map<string, FakeTexture>();
  const uploads: string[] = [];

  const host: TextureHost = {
    exists: (key) => textures.has(key),
    addBytes: (key, bytes, width, height) => {
      textures.set(key, { key, width, height, pixels: bytes.slice() });
      uploads.push(key);
    },
  };

  return { host, textures, uploads };
}

const RED_DOT: PixelSpriteSource = { palette: { ".": null, r: "#ff0000" }, rows: ["r.", ".r"] };

describe("installPixelTexture", () => {
  it("uploads the rasterized pixels at the sprite's size", () => {
    const { host, textures } = fakeHost();

    expect(installPixelTexture(host, "dot", RED_DOT)).toBe(true);

    const texture = textures.get("dot");
    expect([texture?.width, texture?.height]).toEqual([2, 2]);
    expect([...(texture?.pixels.slice(0, 4) ?? [])]).toEqual([255, 0, 0, 255]);
    // The transparent pixel stays transparent: nothing smooths or fills it.
    expect([...(texture?.pixels.slice(4, 8) ?? [])]).toEqual([0, 0, 0, 0]);
  });

  it("leaves an existing key alone instead of failing on a duplicate", () => {
    const { host, uploads } = fakeHost();

    installPixelTexture(host, "dot", RED_DOT);
    expect(installPixelTexture(host, "dot", RED_DOT)).toBe(false);
    expect(uploads).toEqual(["dot"]);
  });
});

describe("installAssetTextures", () => {
  it("installs every frame of every variant", () => {
    const { host, textures } = fakeHost();
    const expected = ASSET_REGISTRY.reduce(
      (total, entry) => total + entry.frames.length * entry.variants.length,
      0,
    );

    const keys = installAssetTextures(host);

    expect(keys.length).toBeGreaterThanOrEqual(expected);
    for (const entry of ASSET_REGISTRY.slice(0, 12)) {
      const last = entry.variants[entry.variants.length - 1]!;
      expect(textures.has(textureKey(entry.id, last.id, entry.frames.length - 1))).toBe(true);
    }
  });

  it("composes a tiled sheet for terrain, so seams are visible", () => {
    const { host, textures } = fakeHost();

    installAssetTextures(host);

    // Ground tiles are 16 wide by TILE_DEPTH tall, because they are made in
    // the camera's projection rather than squashed into it at draw time.
    const tile = ASSET_REGISTRY.find((entry) => entry.category === "tile")!;
    const tiled = textures.get(textureKey(tile.id, "authored", 0, TILE_PREVIEW_SUFFIX));
    expect(tiled?.width).toBe(TILE_WIDTH * TILE_PREVIEW_COLUMNS);
    expect(tiled?.height).toBe(TILE_DEPTH * TILE_PREVIEW_ROWS);
  });

  it("does not compose tiled sheets for actors", () => {
    const { host, textures } = fakeHost();

    installAssetTextures(host);

    expect(textures.has(textureKey("hero-body-idle", "authored", 0, TILE_PREVIEW_SUFFIX))).toBe(false);
  });

  it("is safe to run twice", () => {
    const { host, textures } = fakeHost();

    installAssetTextures(host);
    const size = textures.size;
    installAssetTextures(host);

    expect(textures.size).toBe(size);
  });

  it("honours a custom registry", () => {
    const { host, textures } = fakeHost();
    const entry: AssetEntry = {
      id: "probe",
      label: "Probe",
      category: "prop",
      frames: [RED_DOT],
      frameDurationMs: 100,
      variants: [{ id: "authored", label: "Authored", overrides: {} }],
    };

    installAssetTextures(host, [entry]);

    expect([...textures.keys()]).toEqual([textureKey("probe", "authored", 0)]);
  });
});
