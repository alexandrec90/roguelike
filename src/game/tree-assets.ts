/**
 * Every procedural species — trees and props alike — as asset-lab entries.
 *
 * The species themselves live in `trees/` and `props/` and are *simulations*:
 * the tree lab (`/trees.html`) drives them live, under one wind, with the light
 * and the weather on sliders, which is where a mechanism is actually judged.
 * This file is the other half of the ritual — a baked filmstrip per species, so
 * the same art can be stepped frame by frame in the asset lab, tiled, put on
 * light ground, and palette-swapped like every other asset in the game.
 *
 * Every entry is generated from `SCENERY_SPECIES`, so a new species appears in
 * both labs and costs nothing here. The palette variants are the one authored
 * part: a swap is a claim about which token carries a species' colour, and
 * `validateRegistry` fails the build if a species stops using it.
 */

import { AUTHORED, type AssetEntry } from "./asset-types";
import { INK_COLORS, INK_TOKENS } from "./ink";
import { sampleSpeciesFrames, SCENERY_SPECIES } from "./trees";

/** How long a baked tree frame holds. The strip spans one full gust cycle. */
const FRAME_MS = 240;
const FRAMES = 12;
const SPAN_MS = FRAMES * FRAME_MS;

/**
 * Swaps keyed on the tokens the ramps actually emit.
 *
 * `verdant` runs deep → steel → neon-green → bone, so re-inking the
 * `neon-green` and `bone` tokens repaints the leaves without touching the
 * trunk, which is drawn from the `bone` ramp's steels. That is why these are
 * two-token swaps rather than one: a one-token autumn leaves half the canopy
 * green and looks like a bug in the swap rather than a choice.
 */
const AUTUMN = {
  id: "autumn",
  label: "Autumn",
  overrides: {
    [INK_TOKENS["neon-green"]]: INK_COLORS.amber,
    [INK_TOKENS.bone]: INK_COLORS.ember,
  },
};

const BLIGHTED = {
  id: "blighted",
  label: "Blighted",
  overrides: {
    [INK_TOKENS["neon-green"]]: INK_COLORS.violet,
    [INK_TOKENS.steel]: INK_COLORS.deep,
  },
};

const MOONLIT = {
  id: "moonlit",
  label: "Moonlit",
  overrides: {
    [INK_TOKENS["neon-green"]]: INK_COLORS.deep,
    [INK_TOKENS.bone]: INK_COLORS.ice,
  },
};

/**
 * The tokens present in **every** frame, not in any of them.
 *
 * A swap is applied per frame, and a species whose canopy reaches the top ramp
 * step only on windy frames has `bone` in some frames and not others. The union
 * would offer a variant that throws on the calm frames; the intersection offers
 * only what the whole strip can actually be re-inked with.
 */
function sharedTokens(frames: readonly { readonly palette: Record<string, unknown> }[]): Set<string> {
  const first = frames[0];
  if (first === undefined) {
    return new Set();
  }
  const shared = new Set(Object.keys(first.palette));
  for (const frame of frames) {
    for (const token of shared) {
      if (!(token in frame.palette)) {
        shared.delete(token);
      }
    }
  }
  return shared;
}

/**
 * Every entry needs a swap beyond the authored one, or the lab's palette
 * control has nothing to say about it. The three named swaps are offered where
 * the species has the inks they target; a species that has drifted too far from
 * green for any of them — the burning birch — gets one derived from a token it
 * does have, so the control is never empty.
 */
function variantsFor(frames: readonly { readonly palette: Record<string, unknown> }[]) {
  const tokens = sharedTokens(frames);
  const offered = [AUTUMN, BLIGHTED, MOONLIT].filter((variant) =>
    Object.keys(variant.overrides).every((token) => tokens.has(token)),
  );
  if (offered.length > 0) {
    return [AUTHORED, ...offered];
  }
  const fallback = [...tokens].sort()[0];
  return fallback === undefined
    ? [AUTHORED]
    : [AUTHORED, { id: "cursed", label: "Cursed", overrides: { [fallback]: INK_COLORS.violet } }];
}

export const TREE_ASSETS: readonly AssetEntry[] = SCENERY_SPECIES.map((species) => {
  const frames = sampleSpeciesFrames(species, FRAMES, 0x7e31, SPAN_MS);
  return {
    id: `${species.kind}-${species.id}`,
    label: species.label,
    category: "prop" as const,
    frames,
    frameDurationMs: FRAME_MS,
    notes: `${species.technique}. ${species.notes} Drive it live, under one shared wind and with the light on a slider, at /trees.html?solo=${species.id}`,
    variants: variantsFor(frames),
  };
});
