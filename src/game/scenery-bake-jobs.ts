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
import { bakeLadder, bakePose, settleAt, WIND_LEVELS, type BakeLight } from "./scenery-bake";
import { findSpecies } from "./trees";

/**
 * One body at one lean, or re-sampled at every horizon scale it is drawn at,
 * in one light. The scales go as one job because posing the body is most of
 * the cost and each scale after it is only a re-sample.
 */
export type BakeJob =
  | {
      readonly kind: "lean";
      readonly species: string;
      readonly seed: number;
      readonly light: BakeLight;
      readonly lean: number;
    }
  | {
      readonly kind: "ladder";
      readonly species: string;
      readonly seed: number;
      readonly light: BakeLight;
      readonly scales: readonly number[];
    };

/**
 * The pixels a job made: a body and the shadow it casts, or a ladder of the
 * body at each scale asked for, in order (none casts a shadow on the roll).
 */
export type BakeResult =
  | { readonly kind: "lean"; readonly body: BakedCloud; readonly shadow: BakedCloud | null }
  | { readonly kind: "ladder"; readonly frames: readonly BakedCloud[] };

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
    if (job.kind === "ladder") {
      return { kind: "ladder", frames: bakeLadder(instance, job.light, job.scales) };
    }
    const wind = instance.step === undefined ? 0 : (WIND_LEVELS[job.lean] ?? 0);
    settleAt(instance, wind, job.light);
    return { kind: "lean", ...bakePose(instance, job.light, wind) };
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
  if (result.kind === "ladder") {
    return result.frames.map((frame) => frame.buffer.data.buffer);
  }
  const owned = [result.body.buffer.data.buffer];
  if (result.shadow !== null) {
    owned.push(result.shadow.buffer.data.buffer);
  }
  return owned;
}
