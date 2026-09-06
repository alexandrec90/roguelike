/**
 * What a piece of scenery *is*: a seeded generator plus a per-frame pose.
 *
 * This started as the tree contract and moved up a level the moment a rock
 * wanted the same volumetric body the chestnut crown uses. Trees and props are
 * not different kinds of thing here — both are "a seed makes a shape, a clock
 * poses it, and the result is a pixel cloud" — so both implement this, and
 * everything downstream (the labs, the shadow, the reflection, the burn, the
 * detail budget) is written once against it.
 *
 * The split inside it is the important part:
 *
 * - `create(seed)` builds whatever static structure the species needs — lobes,
 *   a fractal skeleton, a colonized branch graph, Verlet chains, a particle
 *   pool. Once, and allowed to be expensive.
 * - `step` advances any integrator it owns, and `cloud` returns the lit pixels
 *   for right now. `cloud` never mutates; two calls at one moment agree.
 *
 * Because the output is a plain `PixelCloud`, everything the game already owns
 * applies for free: `shadeCloud` lights it, `reflectCloud` puts it in a puddle,
 * `burnable.ts` sets it on fire, a palette variant turns it to autumn, and the
 * asset lab bakes it to a filmstrip without knowing which mechanism drew it.
 */

import type { PixelCloud } from "./ink";
import { DETAIL_TIERS, type Detail } from "./lod";
import type { WindOptions } from "./wind";

export type SceneryKind = "tree" | "prop";

export interface SceneryEnv {
  readonly elapsedMs: number;
  readonly wind: WindOptions;
  /** Screen-space light; +y is down, matching cloud coordinates. */
  readonly light: { readonly x: number; readonly y: number };
  /** Where it stands, so the wind wave reaches it at the right moment. */
  readonly fieldX: number;
  readonly fieldY: number;
  /**
   * What the sky is doing, 0..1 each.
   *
   * Weather is an *input to the model*, not a layer drawn over it: snow
   * accumulates on the upward-facing surfaces a species can compute, rain
   * darkens and weighs down what it lands on. A species free to ignore both
   * does, and the field costs it nothing.
   */
  readonly weather?: { readonly rain?: number; readonly snow?: number };
  /**
   * How much work this body is worth right now (`lod.ts`).
   *
   * A species that honours it evaluates the *same* field more cheaply — never a
   * different, simpler model — so a body gains detail continuously as the
   * player walks toward it instead of popping between versions of itself.
   */
  readonly detail?: Detail;
}

export interface SceneryInstance {
  /** Advance any integrator the species owns. Species with none may omit it. */
  step?(dtMs: number, env: SceneryEnv): void;
  /** The lit pixels now, foot-anchored: (0, 0) is the base on the ground. */
  cloud(env: SceneryEnv): PixelCloud;
}

export interface SceneryFootprint {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

export interface ScenerySpecies {
  readonly id: string;
  readonly label: string;
  readonly kind: SceneryKind;
  /** The procedural mechanism this species exists to demonstrate. */
  readonly technique: string;
  readonly notes: string;
  readonly footprint: SceneryFootprint;
  create(seed: number): SceneryInstance;
}

export const DEFAULT_SCENERY_ENV: SceneryEnv = {
  elapsedMs: 0,
  wind: { strength: 1, gustiness: 0.6 },
  light: { x: -0.6, y: -0.8 },
  fieldX: 0,
  fieldY: 0,
  detail: DETAIL_TIERS.near,
};

/** The budget a species should use when the caller did not name one. */
export function detailOf(env: SceneryEnv): Detail {
  return env.detail ?? DETAIL_TIERS.near;
}
