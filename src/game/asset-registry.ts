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

import type { Palette, PixelSpriteSource } from "./pixel-art";
import { rasterizeSprite } from "./pixel-art";
import { swapPalette } from "./sprite-ops";
import { HERO, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { FLOOR_STONE, WALL_FACE, WALL_TOP } from "./tiles";

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

const AUTHORED: PaletteVariant = {
  id: AUTHORED_VARIANT_ID,
  label: "Authored",
  overrides: {},
};

export const ASSET_REGISTRY: readonly AssetEntry[] = [
  {
    id: "hero",
    label: "Hero",
    category: "actor",
    frames: [HERO],
    frameDurationMs: 160,
    notes: "Idle pose. Motion comes from grid-quantized bob and squash, not extra frames.",
    variants: [
      AUTHORED,
      {
        id: "hit",
        label: "Hit flash",
        overrides: {
          h: "#ffffff",
          H: "#ffffff",
          f: "#ffffff",
          n: "#ffffff",
          c: "#ffffff",
          C: "#ffffff",
          w: "#ffffff",
          b: "#ffffff",
          B: "#e8e8f0",
        },
      },
      {
        id: "frost",
        label: "Frozen",
        overrides: {
          h: "#1a2632",
          H: "#3d5a70",
          f: "#cfe6f2",
          n: "#6f9ab0",
          c: "#16222e",
          C: "#3a6f86",
          w: "#dff2ff",
          b: "#22303f",
          B: "#101a24",
        },
      },
    ],
  },
  {
    id: "slime",
    label: "Slime",
    category: "actor",
    frames: SLIME_FRAMES,
    frameDurationMs: 140,
    notes: "Anticipation, contact, overshoot, settle — four silhouettes, no tweening.",
    variants: [
      AUTHORED,
      {
        id: "ember",
        label: "Ember",
        overrides: {
          g: "#3a1410",
          G: "#a3452a",
          l: "#e08b4a",
          w: "#ffe0a8",
          d: "#4a1d16",
          s: "#20120f",
        },
      },
      {
        id: "void",
        label: "Void",
        overrides: {
          g: "#1d1430",
          G: "#4a3a7a",
          l: "#8f7cd8",
          w: "#e0d8ff",
          d: "#2a1f45",
          s: "#150f22",
        },
      },
    ],
  },
  {
    id: "torch",
    label: "Wall torch",
    category: "prop",
    frames: TORCH_FRAMES,
    frameDurationMs: 92,
    notes: "Flame flicker. Fast enough that the eye reads light, not frames.",
    variants: [
      AUTHORED,
      {
        id: "arcane",
        label: "Arcane",
        overrides: { y: "#8fe0ff", Y: "#dff7ff", o: "#4a90d9", r: "#2b4f9a" },
      },
      {
        id: "witchfire",
        label: "Witchfire",
        overrides: { y: "#b8ff8f", Y: "#e6ffd6", o: "#4fb04a", r: "#256b32" },
      },
    ],
  },
  {
    id: "floor-stone",
    label: "Floor — stone",
    category: "tile",
    frames: [FLOOR_STONE],
    frameDurationMs: 200,
    notes: "Seams sit on row 0 and column 0 only, so a tiled field keeps single mortar lines.",
    variants: [
      AUTHORED,
      {
        id: "moss",
        label: "Mossy",
        overrides: { a: "#26302a", b: "#31402f", c: "#1a2119", d: "#20291f" },
      },
    ],
  },
  {
    id: "wall-top",
    label: "Wall — top cap",
    category: "tile",
    frames: [WALL_TOP],
    frameDurationMs: 200,
    notes: "What the overhead camera sees of a wall block.",
    variants: [
      AUTHORED,
      { id: "sandstone", label: "Sandstone", overrides: { t: "#6b5c46", T: "#7d6d53", e: "#463b2d" } },
    ],
  },
  {
    id: "wall-face",
    label: "Wall — face",
    category: "tile",
    frames: [WALL_FACE],
    frameDurationMs: 200,
    notes:
      "The side that rises up the screen. Stacks upward, so it carries no band of " +
      "its own — the shadow at the wall's foot is drawn by whatever it stands on.",
    variants: [
      AUTHORED,
      {
        id: "sandstone",
        label: "Sandstone",
        overrides: { f: "#574a38", F: "#685941", m: "#3a3126" },
      },
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
 * Every structural rule the catalogue holds to, as a list of problems.
 *
 * Returned rather than thrown so one test can report all of them at once; a
 * registry that fails five ways should not need five runs to find out.
 */
export function validateRegistry(registry: readonly AssetEntry[] = ASSET_REGISTRY): string[] {
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
