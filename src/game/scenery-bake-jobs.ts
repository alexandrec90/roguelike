/**
 * A scenery bake as a message: what to bake, and the bench that bakes it.
 *
 * Split from `scenery-cache.ts` so the work can leave the main thread. A job is
 * plain data (species id, seed, light, and either a lean or a horizon scale),
 * and its result is plain pixel buffers, so the same `BakeBench` runs inside a
 * Web Worker (`scenery-bake-worker.ts`) or inline (`scenery-baker.ts`'s
 * fallback, and the tests) and makes the same picture either way.
 *
 * Pure and Phaser-free.
 */

import type { BakedCloud } from "./pixel-buffer";
import type { SceneryInstance } from "./scenery";
import { bakePose, bakeScaled, settleAt, WIND_LEVELS, type BakeLight } from "./scenery-bake";
import { findSpecies } from "./trees";

/** One body at one lean, or re-sampled at one horizon scale, in one light. */
export type BakeJob =
  | {
      readonly kind: "lean";
      readonly species: string;
      readonly seed: number;
      readonly light: BakeLight;
      readonly lean: number;
    }
  | {
      readonly kind: "scale";
      readonly species: string;
      readonly seed: number;
      readonly light: BakeLight;
      readonly scale: number;
    };

/** The pixels a job made: a body, and the shadow it casts (none on the roll). */
export interface BakeResult {
  readonly body: BakedCloud;
  readonly shadow: BakedCloud | null;
}

/** Whether a species sways at all, and so is baked at every lean or at one. */
export function speciesSways(species: string, seed: number): boolean {
  return findSpecies(species)?.create(seed).step !== undefined;
}

/**
 * Bakes jobs, keeping one live instance per body.
 *
 * The instance is kept so a body's leans are settled one from the next, as
 * `settleAt` expects: a species with state (ropes, a leaf swarm) carries it
 * across, so every job for one body must reach the same bench, in order.
 */
export class BakeBench {
  private readonly instances = new Map<string, SceneryInstance>();

  /** The job's pixels, or null for a species the catalogue does not know. */
  run(job: BakeJob): BakeResult | null {
    const instance = this.instance(job.species, job.seed);
    if (instance === undefined) {
      return null;
    }
    if (job.kind === "scale") {
      return { body: bakeScaled(instance, job.light, job.scale), shadow: null };
    }
    const wind = instance.step === undefined ? 0 : (WIND_LEVELS[job.lean] ?? 0);
    settleAt(instance, wind, job.light);
    return bakePose(instance, job.light, wind);
  }

  private instance(species: string, seed: number): SceneryInstance | undefined {
    const id = `${species}:${seed}`;
    let instance = this.instances.get(id);
    if (instance === undefined) {
      instance = findSpecies(species)?.create(seed);
      if (instance === undefined) {
        return undefined;
      }
      this.instances.set(id, instance);
    }
    return instance;
  }
}

/** The buffers a result owns, so a worker can hand them over rather than copy them. */
export function transferables(result: BakeResult | null): ArrayBuffer[] {
  if (result === null) {
    return [];
  }
  const owned = [result.body.buffer.data.buffer];
  if (result.shadow !== null) {
    owned.push(result.shadow.buffer.data.buffer);
  }
  return owned;
}
