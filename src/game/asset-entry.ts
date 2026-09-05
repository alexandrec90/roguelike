/**
 * What an asset entry *is*, and everything that can be asked of one.
 *
 * The catalogue itself is `asset-registry.ts` — this is the half with no art in
 * it. The split is the one the imports already showed: the data side pulls in
 * every model, tile and effect module in the game, while the shape and the
 * lookups over it need nothing but a sprite source, which is why they are
 * testable and re-usable without dragging the whole art tree along.
 *
 * `validateRegistry` takes the registry as an argument rather than reaching for
 * it: a validator that names its input can be pointed at a fixture, and the one
 * caller that wants the real catalogue passes it.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";
import { rasterizeSprite } from "./pixel-art";
import { swapPalette } from "./sprite-ops";

export type AssetCategory = "actor" | "prop" | "tile" | "effect";

/** Effects are simulated rather than played frame by frame. */
export type EffectId = "sparks";

export interface PaletteVariant {
  readonly id: string;
  readonly label: string;
  /** Empty for the authored colours; otherwise token -> colour. */
  readonly overrides: Palette;
}

export interface AssetEntry {
  readonly id: string;
  readonly label: string;
  readonly category: AssetCategory;
  readonly frames: readonly PixelSpriteSource[];
  /** How long one frame holds when the clip plays. */
  readonly frameDurationMs: number;
  /** Always at least one; the first is the authored palette. */
  readonly variants: readonly PaletteVariant[];
  readonly effect?: EffectId;
  readonly notes?: string;
}

export const AUTHORED_VARIANT_ID = "authored";

export function findAsset(id: string, registry: readonly AssetEntry[]): AssetEntry | undefined {
  return registry.find((entry) => entry.id === id);
}

export function findVariant(entry: AssetEntry, variantId: string): PaletteVariant | undefined {
  return entry.variants.find((variant) => variant.id === variantId);
}

/**
 * The source for one frame of one variant.
 *
 * The index wraps rather than throwing: this is called from the render loop,
 * where a stale index should show the wrong frame, not stop the scene.
 */
export function assetFrame(
  entry: AssetEntry,
  frameIndex: number,
  variantId: string = AUTHORED_VARIANT_ID,
): PixelSpriteSource {
  const count = entry.frames.length;
  const wrapped = ((Math.trunc(frameIndex) % count) + count) % count;
  const frame = entry.frames[wrapped];
  if (frame === undefined) {
    throw new Error(`Asset '${entry.id}' has no frames`);
  }

  const variant = findVariant(entry, variantId);
  if (variant === undefined || Object.keys(variant.overrides).length === 0) {
    return frame;
  }
  return swapPalette(frame, variant.overrides);
}

/** Stable texture key. `suffix` distinguishes derived textures such as tiled previews. */
export function textureKey(
  entryId: string,
  variantId: string,
  frameIndex: number,
  suffix = "",
): string {
  const tail = suffix === "" ? "" : `:${suffix}`;
  return `asset:${entryId}:${variantId}:${frameIndex}${tail}`;
}

/**
 * Every structural rule the catalogue holds to, as a list of problems.
 *
 * Returned rather than thrown so one test can report all of them at once; a
 * registry that fails five ways should not need five runs to find out.
 */
export function validateRegistry(registry: readonly AssetEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const entry of registry) {
    if (seen.has(entry.id)) {
      problems.push(`Duplicate asset id '${entry.id}'`);
    }
    seen.add(entry.id);

    if (entry.frameDurationMs <= 0) {
      problems.push(`Asset '${entry.id}' has a non-positive frame duration`);
    }
    problems.push(...frameProblems(entry));
    problems.push(...variantProblems(entry));
  }

  return problems;
}

function frameProblems(entry: AssetEntry): string[] {
  const problems: string[] = [];
  if (entry.frames.length === 0) {
    problems.push(`Asset '${entry.id}' has no frames`);
    return problems;
  }

  const sizes = new Set<string>();
  entry.frames.forEach((frame, index) => {
    try {
      const raster = rasterizeSprite(frame);
      sizes.add(`${raster.width}x${raster.height}`);
    } catch (error) {
      problems.push(`Asset '${entry.id}' frame ${index} does not rasterize: ${String(error)}`);
    }
  });

  if (sizes.size > 1) {
    problems.push(`Asset '${entry.id}' mixes frame sizes: ${[...sizes].join(", ")}`);
  }
  return problems;
}

function variantProblems(entry: AssetEntry): string[] {
  const problems: string[] = [];
  const first = entry.variants[0];
  if (first === undefined) {
    problems.push(`Asset '${entry.id}' has no variants`);
    return problems;
  }
  if (first.id !== AUTHORED_VARIANT_ID) {
    problems.push(`Asset '${entry.id}' does not lead with the authored palette`);
  }

  const seen = new Set<string>();
  for (const variant of entry.variants) {
    if (seen.has(variant.id)) {
      problems.push(`Asset '${entry.id}' has duplicate variant '${variant.id}'`);
    }
    seen.add(variant.id);
    problems.push(...overrideProblems(entry, variant));
  }
  return problems;
}

function overrideProblems(entry: AssetEntry, variant: PaletteVariant): string[] {
  const problems: string[] = [];
  for (const token of Object.keys(variant.overrides)) {
    const missing = entry.frames.some((frame) => !(token in frame.palette));
    if (missing) {
      problems.push(`Asset '${entry.id}' variant '${variant.id}' targets unused token '${token}'`);
    }
  }
  return problems;
}
