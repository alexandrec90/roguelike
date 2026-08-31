/**
 * Turning authored pixel sources into canvas textures.
 *
 * The host is described structurally rather than as `Phaser.Textures.TextureManager`
 * so this can be exercised without booting a WebGL context: a scene's
 * `this.textures` satisfies `TextureHost` as it stands, and a test can satisfy it
 * with a dozen lines.
 */

import { ASSET_REGISTRY, assetFrame, textureKey, type AssetEntry } from "./asset-registry";
import { rasterizeSprite, type PixelSpriteSource } from "./pixel-art";
import { repeatSprite } from "./sprite-ops";

export interface PixelContext {
  imageSmoothingEnabled: boolean;
  createImageData(width: number, height: number): ImageData;
  putImageData(image: ImageData, dx: number, dy: number): void;
}

export interface CanvasTextureLike {
  getContext(): PixelContext;
  refresh(): unknown;
}

export interface TextureHost {
  exists(key: string): boolean;
  createCanvas(key: string, width: number, height: number): CanvasTextureLike | null;
}

/** How many copies of a tile the lab composes for its seam check. */
export const TILE_PREVIEW_COLUMNS = 3;
export const TILE_PREVIEW_ROWS = 3;
export const TILE_PREVIEW_SUFFIX = `${TILE_PREVIEW_COLUMNS}x${TILE_PREVIEW_ROWS}`;

/**
 * Write one sprite into a canvas texture, creating it if needed.
 *
 * Re-installing an existing key is a no-op: the lab rebuilds its texture list
 * whenever the registry changes under hot reload, and Phaser throws on a
 * duplicate key rather than replacing it.
 */
export function installPixelTexture(
  host: TextureHost,
  key: string,
  source: PixelSpriteSource,
): boolean {
  if (host.exists(key)) {
    return false;
  }

  const sprite = rasterizeSprite(source);
  const texture = host.createCanvas(key, sprite.width, sprite.height);
  if (texture === null) {
    throw new Error(`Could not create texture '${key}'`);
  }

  const context = texture.getContext();
  context.imageSmoothingEnabled = false;
  const image = context.createImageData(sprite.width, sprite.height);
  image.data.set(sprite.rgba);
  context.putImageData(image, 0, 0);
  texture.refresh();
  return true;
}

/**
 * Install every frame of every palette variant in the catalogue, plus a tiled
 * sheet for each terrain tile.
 *
 * Doing this up front costs a few dozen small canvases once and buys a lab that
 * can switch variant or frame with `setTexture`, inside the render loop, with
 * no allocation and no first-use hitch.
 */
export function installAssetTextures(
  host: TextureHost,
  registry: readonly AssetEntry[] = ASSET_REGISTRY,
): string[] {
  const keys: string[] = [];

  for (const entry of registry) {
    for (const variant of entry.variants) {
      entry.frames.forEach((_frame, index) => {
        const source = assetFrame(entry, index, variant.id);
        const key = textureKey(entry.id, variant.id, index);
        installPixelTexture(host, key, source);
        keys.push(key);

        if (entry.category !== "tile") {
          return;
        }
        const tiledKey = textureKey(entry.id, variant.id, index, TILE_PREVIEW_SUFFIX);
        const tiled = repeatSprite(source, TILE_PREVIEW_COLUMNS, TILE_PREVIEW_ROWS);
        installPixelTexture(host, tiledKey, tiled);
        keys.push(tiledKey);
      });
    }
  }

  return keys;
}
