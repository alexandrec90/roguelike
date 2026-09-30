/**
 * What each kind of slime is made of: one material family, arranged into the
 * handful of roles a jelly body needs.
 *
 * A slime is not painted per variant. The body is one SDF and one light model
 * (`slime-art.ts`), and a variant is only *which inks play which part*: the
 * ramp the volume is lit from, the outline that keeps it off the grass, the
 * darker nucleus, the specular glint, the pale flash a hit re-inks it to. So a
 * new kind of slime is one entry here and nothing else.
 *
 * Every ink is a named palette ink (`palette.ts`); the green body is the sheer
 * `slime` family, so the ground reads through it, while fire, frost and arcane
 * are opaque ramps that make those slimes look denser and stranger — which is
 * the point of them being rarer.
 */

import type { Element } from "../combat";
import type { InkId } from "../ink";
import { familyHex, rampSlice, type FamilyInk } from "../palette";

export type SlimeVariant = "green" | "fire" | "frost" | "arcane";

export const SLIME_VARIANTS: readonly SlimeVariant[] = ["green", "fire", "frost", "arcane"];

export interface SlimeInks {
  /** Five steps, darkest first — the ramp the body volume is lit from. */
  readonly ramp: readonly InkId[];
  /** The one-pixel silhouette on the side away from the light. */
  readonly outline: InkId;
  /** The silhouette on the lit side: lighter, so the top edge still reads as rounded. */
  readonly rimLit: InkId;
  /** The suspended nucleus, seen through the jelly. */
  readonly core: InkId;
  /** A glowing nucleus is drawn in `core`; a dark one only shades the flesh around it. */
  readonly coreGlows: boolean;
  /** Light that went through the body and gathers inside its far, lower edge. */
  readonly bounce: InkId;
  /** The hot spot of the gloss highlight, and the pixel around it. */
  readonly glint: InkId;
  readonly sheen: InkId;
  /** What a hit re-inks the whole body to for a few frames. */
  readonly flash: readonly InkId[];
  /** The ramp its goo droplets and melt puddle are drawn from. */
  readonly goo: readonly InkId[];
  /** The element it is made of: immune to its own, weak to its opposite. */
  readonly element: Element | null;
  /** A light it gives off, as a palette ink's hex, or null for none. */
  readonly glow: FamilyInk | null;
}

const green: SlimeInks = {
  ramp: rampSlice("slime", 0, 4),
  outline: "slime-0",
  rimLit: "slime-1",
  core: "slime-1",
  coreGlows: false,
  bounce: "slime-3",
  glint: "foam",
  sheen: "slime-4",
  flash: ["slime-4", "foam"],
  goo: rampSlice("slime", 1, 4),
  element: null,
  glow: null,
};

const fire: SlimeInks = {
  ramp: rampSlice("fire", 1, 5),
  outline: "fire-0",
  rimLit: "fire-2",
  core: "fire-6",
  coreGlows: true,
  bounce: "fire-5",
  glint: "fire-6",
  sheen: "fire-5",
  flash: ["fire-6", "foam"],
  goo: rampSlice("fire", 2, 6),
  element: "fire",
  glow: "fire-4",
};

const frost: SlimeInks = {
  ramp: rampSlice("frost", 0, 4),
  outline: "frost-0",
  rimLit: "frost-1",
  core: "frost-1",
  coreGlows: false,
  bounce: "frost-3",
  glint: "foam",
  sheen: "frost-4",
  flash: ["frost-4", "foam"],
  goo: rampSlice("frost", 1, 4),
  element: "frost",
  glow: null,
};

const arcane: SlimeInks = {
  ramp: rampSlice("arcane", 0, 4),
  outline: "arcane-0",
  rimLit: "arcane-1",
  core: "arcane-4",
  coreGlows: true,
  bounce: "arcane-3",
  glint: "foam",
  sheen: "arcane-4",
  flash: ["arcane-4", "foam"],
  goo: rampSlice("arcane", 1, 4),
  element: null,
  glow: "arcane-3",
};

export const SLIME_INKS: Readonly<Record<SlimeVariant, SlimeInks>> = { green, fire, frost, arcane };

/**
 * Damage multiplier for a blow of `element` landing on a slime of `variant`.
 *
 * A fire slime shrugs off fire and melts under frost; a frost slime the
 * reverse. Steel treats everyone alike, and so does anything else not named —
 * a new element is harmless to add, never a crash.
 */
export function elementalFactor(variant: SlimeVariant, element: Element): number {
  const own = SLIME_INKS[variant].element;
  if (own === null || element === "steel") {
    return 1;
  }
  if (element === own) {
    return 0;
  }
  return (own === "fire" && element === "frost") || (own === "frost" && element === "fire") ? 2 : 1;
}

/** A glowing slime's light colour, or null. Hex comes from the palette, never from here. */
export function glowColor(variant: SlimeVariant): string | null {
  const ink = SLIME_INKS[variant].glow;
  return ink === null ? null : familyHex(ink);
}
