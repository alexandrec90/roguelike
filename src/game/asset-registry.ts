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

import { CAST, HERO_EQUIPPED, IDLE, SWING, WALK } from "./models";
import type { Palette, PixelSpriteSource } from "./pixel-art";
import { rasterizeSprite } from "./pixel-art";
import { sampleClipFrames, sampleMeltFrames } from "./rig-frames";
import { swapPalette } from "./sprite-ops";
import { FAR_PINE, FAR_TOWER, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { DIRT_PATH, GRASS, WALL_FACE, WALL_TOP } from "./tiles";

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

/** One swap shared by every rig entry: the bone ink re-inked to ice. */
const FROST: PaletteVariant = { id: "frost", label: "Frozen", overrides: { w: "#a8ecff" } };

export const ASSET_REGISTRY: readonly AssetEntry[] = [
  {
    id: "hero",
    label: "Hero — idle (rig)",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, IDLE, 8),
    frameDurationMs: 175,
    notes:
      "Not drawn: rendered from the humanoid rig in models.ts with sword and hat equipped. " +
      "Edit the clip or the gear, and these frames follow.",
    variants: [AUTHORED, FROST],
  },
  {
    id: "hero-walk",
    label: "Hero — walk (rig)",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, WALK, 8),
    frameDurationMs: 80,
    notes: "The stride swings through the depth axis; back facing and x-flip come free.",
    variants: [AUTHORED, FROST],
  },
  {
    id: "hero-walk-back",
    label: "Hero — walk, back view (rig)",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, WALK, 8, { facing: "back" }),
    frameDurationMs: 80,
    notes: "Same clip, back facing: depth negated, front-only stamps (the eyes) dropped.",
    variants: [AUTHORED, FROST],
  },
  {
    id: "hero-swing",
    label: "Hero — sword swing (rig)",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, SWING, 8),
    frameDurationMs: 65,
    notes: "Anticipation behind the head, contact across the front, overshoot, settle — all keyed in 3D.",
    variants: [AUTHORED, FROST],
  },
  {
    id: "hero-cast",
    label: "Hero — cast (rig)",
    category: "actor",
    frames: sampleClipFrames(HERO_EQUIPPED, CAST, 8),
    frameDurationMs: 88,
    notes: "Gather and release toward the camera. The projectile is the scene's business.",
    variants: [AUTHORED, FROST],
  },
  {
    id: "hero-melt",
    label: "Hero — melt (transform)",
    category: "actor",
    frames: sampleMeltFrames(HERO_EQUIPPED, 8, 0xa11ce),
    frameDurationMs: 110,
    notes:
      "No melting frames were drawn: this is meltCloud() applied to the rendered rig. " +
      "The same transform melts anything that renders to a pixel cloud.",
    variants: [AUTHORED, FROST],
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
          g: "#ff5a2b",
          G: "#170502",
          l: "#3a0f05",
          w: "#ffe0a8",
          d: "#000000",
          s: "#1f0d08",
        },
      },
      {
        id: "void",
        label: "Void",
        overrides: {
          g: "#a06bff",
          G: "#0e0618",
          l: "#241040",
          w: "#e0d8ff",
          d: "#000000",
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
    id: "grass",
    label: "Ground — grass",
    category: "tile",
    frames: [GRASS],
    frameDurationMs: 200,
    notes:
      "16x12: authored already foreshortened by the camera pitch, so it draws 1:1. " +
      "Check it tiled — noise this low-contrast is the difference between a field and wallpaper.",
    variants: [
      AUTHORED,
      {
        id: "autumn",
        label: "Autumn",
        overrides: { g: "#3a2410", G: "#000000", h: "#e8a33d", s: "#000000" },
      },
      {
        id: "night",
        label: "Night",
        overrides: { g: "#0d2430", G: "#000000", h: "#35e8ff", s: "#000000" },
      },
    ],
  },
  {
    id: "dirt-path",
    label: "Ground — dirt path",
    category: "tile",
    frames: [DIRT_PATH],
    frameDurationMs: 200,
    notes: "The trodden route through the field. Same 16x12 footprint as grass.",
    variants: [
      AUTHORED,
      {
        id: "ashen",
        label: "Ashen",
        overrides: { d: "#000000", D: "#141a22", e: "#000000", p: "#9db4d8" },
      },
    ],
  },
  {
    id: "wall-top",
    label: "Rock — top cap",
    category: "tile",
    frames: [WALL_TOP],
    frameDurationMs: 200,
    notes: "What the pitched-back camera sees of the top of a rock block. 16x12, like the ground.",
    variants: [
      AUTHORED,
      {
        id: "sandstone",
        label: "Sandstone",
        overrides: { r: "#000000", R: "#1c1710", k: "#e8c25a" },
      },
    ],
  },
  {
    id: "wall-face",
    label: "Rock — face",
    category: "tile",
    frames: [WALL_FACE],
    frameDurationMs: 200,
    notes:
      "The side that rises up the screen, 16x16 and never foreshortened. Stacks upward, " +
      "so it carries no band of its own — the shadow at its foot is drawn by what it stands on.",
    variants: [
      AUTHORED,
      {
        id: "sandstone",
        label: "Sandstone",
        overrides: { f: "#000000", F: "#1c1710", m: "#e8c25a" },
      },
    ],
  },
  {
    id: "far-pine",
    label: "Distant — pine",
    category: "prop",
    frames: [FAR_PINE],
    frameDurationMs: 200,
    notes: "Stands on the horizon line inside the rolled-over band. Silhouette only, six pixels tall.",
    variants: [
      AUTHORED,
      { id: "night", label: "Night", overrides: { P: "#1c2531" } },
    ],
  },
  {
    id: "far-tower",
    label: "Distant — tower",
    category: "prop",
    frames: [FAR_TOWER],
    frameDurationMs: 200,
    notes: "The one landmark past the horizon. Its lit window is the only warm pixel up there.",
    variants: [
      AUTHORED,
      { id: "dark", label: "Unlit", overrides: { q: "#2a3542" } },
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
