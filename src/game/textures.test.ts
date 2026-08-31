import { describe, expect, it } from "vitest";

import { ASSET_REGISTRY, textureKey, type AssetEntry } from "./asset-registry";
import type { PixelSpriteSource } from "./pixel-art";
import {
  installAssetTextures,
  installPixelTexture,
  TILE_PREVIEW_COLUMNS,
  TILE_PREVIEW_ROWS,
  TILE_PREVIEW_SUFFIX,
  type CanvasTextureLike,
  type TextureHost,
} from "./textures";

interface FakeTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  refreshes: number;
  smoothing: boolean;
}

function fakeHost(): { host: TextureHost; textures: Map<string, FakeTexture> } {
  const textures = new Map<string, FakeTexture>();

  const host: TextureHost = {
    exists: (key) => textures.has(key),
    createCanvas: (key, width, height): CanvasTextureLike => {
      const record: FakeTexture = {
        key,
        width,
        height,
        pixels: new Uint8ClampedArray(width * height * 4),
        refreshes: 0,
        smoothing: true,
      };
      textures.set(key, record);

      return {
        getContext: () => ({
          set imageSmoothingEnabled(value: boolean) {
            record.smoothing = value;
          },
          get imageSmoothingEnabled(): boolean {
            return record.smoothing;
          },
          createImageData: (w: number, h: number) =>
            ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
          putImageData: (image: ImageData) => record.pixels.set(image.data),
        }),
        refresh: () => (record.refreshes += 1),
      };
    },
  };

  return { host, textures };
}

const RED_DOT: PixelSpriteSource = { palette: { ".": null, r: "#ff0000" }, rows: ["r.", ".r"] };

describe("installPixelTexture", () => {
  it("writes the rasterized pixels and refreshes the texture", () => {
    const { host, textures } = fakeHost();

    expect(installPixelTexture(host, "dot", RED_DOT)).toBe(true);

    const texture = textures.get("dot");
    expect([texture?.width, texture?.height]).toEqual([2, 2]);
    expect([...(texture?.pixels.slice(0, 4) ?? [])]).toEqual([255, 0, 0, 255]);
    expect(texture?.refreshes).toBe(1);
  });

  it("turns smoothing off, so nothing resamples the art", () => {
    const { host, textures } = fakeHost();

    installPixelTexture(host, "dot", RED_DOT);

    expect(textures.get("dot")?.smoothing).toBe(false);
  });

  it("leaves an existing key alone instead of failing on a duplicate", () => {
    const { host, textures } = fakeHost();

    installPixelTexture(host, "dot", RED_DOT);
    expect(installPixelTexture(host, "dot", RED_DOT)).toBe(false);
    expect(textures.get("dot")?.refreshes).toBe(1);
  });

  it("reports a host that refused to allocate", () => {
    const host: TextureHost = { exists: () => false, createCanvas: () => null };

    expect(() => installPixelTexture(host, "dot", RED_DOT)).toThrow(/Could not create texture/);
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
    expect(textures.has(textureKey("slime", "void", 3))).toBe(true);
    expect(textures.has(textureKey("hero", "frost", 0))).toBe(true);
  });

  it("composes a tiled sheet for terrain, so seams are visible", () => {
    const { host, textures } = fakeHost();

    installAssetTextures(host);

    const tiled = textures.get(textureKey("floor-stone", "authored", 0, TILE_PREVIEW_SUFFIX));
    expect(tiled?.width).toBe(16 * TILE_PREVIEW_COLUMNS);
    expect(tiled?.height).toBe(16 * TILE_PREVIEW_ROWS);
  });

  it("does not compose tiled sheets for actors", () => {
    const { host, textures } = fakeHost();

    installAssetTextures(host);

    expect(textures.has(textureKey("hero", "authored", 0, TILE_PREVIEW_SUFFIX))).toBe(false);
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
