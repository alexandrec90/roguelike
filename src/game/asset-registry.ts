/**
 * The catalogue the asset lab renders.
 *
 * Sprites live in `sprites.ts` and `tiles.ts` as authored pixels; this module
 * says what each one *is* — how its frames are timed, which palette swaps it
 * supports, whether it is an actor, a tile or an effect. The lab reads only
 * this, so adding art to the lab is adding an entry here rather than editing a
 * scene, and `validateRegistry` turns "the variant silently did nothing" into a
 * failing test instead of a puzzling screenshot.
 */

import {
  AUTHORED,
  AUTHORED_VARIANT_ID,
  type AssetEntry,
  type PaletteVariant,
} from "./asset-types";
import { INK_COLORS } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { samplePuddleFrames } from "./puddles";
import { HERO_EQUIPPED, SWING, WALK } from "./models";
import { validateRegistry as checkRegistry } from "./registry-validation";
import { sampleClipFrames } from "./rig-frames";
import { AREA_ASSETS } from "./registry";
import { sampleRippleFrames } from "./ripples";
import { swapPalette } from "./sprite-ops";
import { SPARK } from "./sprites";
import { TREE_ASSETS } from "./tree-assets";

export type { AssetCategory, AssetEntry, EffectId, PaletteVariant } from "./asset-types";
export { AUTHORED, AUTHORED_VARIANT_ID } from "./asset-types";

export const ASSET_REGISTRY: readonly AssetEntry[] = [
  ...AREA_ASSETS,
  {
    id: "hero-skeleton",
    label: "Hero — bare skeleton, swing over walk",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, SWING, 10, { under: WALK }),
    frameDurationMs: 60,
    notes:
      "The bones the volumetric hero is dressed on, stroked as lines: the view for checking a " +
      "clip's motion without the body in the way. The dressed hero is the hero-body entries.",
    variants: [AUTHORED, { id: "ember", label: "Ember", overrides: { w: "#ff7a1f" } }],
  },
  {
    id: "puddle",
    label: "Puddle — standing water",
    category: "prop",
    frames: samplePuddleFrames(8),
    frameDurationMs: 600,
    notes:
      "Not drawn: a seeded lobed ellipse from puddles.ts, foreshortened by the camera pitch. " +
      "The body ink is translucent, so judge it on the checker ground as well as the duo one — " +
      "what makes it read as water is the lit rim and the drifting glints, not a dark fill.",
    variants: [
      AUTHORED,
      { id: "tar", label: "Tar", overrides: { b: "#1a0f18c0" } },
      { id: "shallow", label: "Shallow", overrides: { b: "#0b2b3e66" } },
    ],
  },
  {
    id: "ripple",
    label: "Ripple — rain impact",
    category: "effect",
    frames: sampleRippleFrames(8),
    frameDurationMs: 80,
    notes:
      "One ring's whole life, from the splash pixel to the faded rim. The scene fades it out " +
      "as it spreads; here every frame draws at full strength so the shape is legible.",
    variants: [
      AUTHORED,
      { id: "ember", label: "Ember", overrides: { i: "#ff7a1f" } },
    ],
  },
  {
    id: "sparks",
    label: "Sparks",
    category: "effect",
    frames: [SPARK],
    frameDurationMs: 100,
    effect: "sparks",
    notes: "A pooled, seeded emitter of 1px embers. Capped count, additive blend.",
    variants: [
      AUTHORED,
      { id: "ash", label: "Ash", overrides: { x: "#8a8f99" } },
      { id: "arcane", label: "Arcane", overrides: { x: "#8fe0ff" } },
    ],
  },
  ...TREE_ASSETS,
];

export function findAsset(
  id: string,
  registry: readonly AssetEntry[] = ASSET_REGISTRY,
): AssetEntry | undefined {
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
 * Check the catalogue against the structural rules in `registry-validation.ts`.
 *
 * Defaulted to this registry so a test can simply ask "is the catalogue sound".
 */
export function validateRegistry(registry: readonly AssetEntry[] = ASSET_REGISTRY): string[] {
  return checkRegistry(registry);
}
