/**
 * What an entry in the asset catalogue *is*.
 *
 * These shapes were `asset-registry.ts`'s to begin with, and moved here when
 * that file reached its size limit and turned out to be holding three jobs: the
 * vocabulary (this file), the catalogue itself, and the structural rules the
 * catalogue is checked against (`registry-validation.ts`). Splitting on that
 * seam is also what lets a second catalogue — `tree-assets.ts` — describe its
 * entries without importing the array it is about to be spread into.
 *
 * `asset-registry.ts` re-exports everything here, so nothing downstream had to
 * learn a new import path.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";

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

/** The palette every entry must lead with: the art exactly as it was authored. */
export const AUTHORED: PaletteVariant = {
  id: AUTHORED_VARIANT_ID,
  label: "Authored",
  overrides: {},
};
