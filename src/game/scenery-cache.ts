/**
 * The baked scenery, as textures: one per body, per lean, per light.
 *
 * `scenery-bake.ts` turns a posed body into pixels; this owns what those pixels
 * become on the GPU and when they are made. Three rules keep it cheap:
 *
 * - **Nothing is baked twice.** A body is keyed by species and seed — its
 *   identity on the planet — so walking away from a tree and back finds it
 *   already baked.
 * - **Nothing big is baked in one frame.** A body arrives with only the lean it
 *   needs *now* baked on the spot; its other leans join a queue that `pump`
 *   drains one bake at a time within a per-frame budget. A newly seen tree
 *   stands still for a moment and then starts to sway, which reads as a lull in
 *   the wind rather than as loading.
 * - **The old picture holds until the new one is whole.** When the sun crosses
 *   a step every body is re-baked through the same queue, and each keeps
 *   drawing its previous light until all of its new leans are ready, so dusk
 *   creeps across a wood rather than flickering through it.
 */

import type Phaser from "phaser";

import type { BakedCloud } from "./pixel-buffer";
import { installBuffer } from "./pixel-surface";
import type { SceneryInstance, ScenerySpecies } from "./scenery";
import {
  bakePose,
  bakeScaled,
  lightKey,
  settleAt,
  WIND_LEVELS,
  type BakeLight,
} from "./scenery-bake";
import type { SceneryFeature } from "./scenery-features";
import { findSpecies } from "./trees";

/** A baked picture on the GPU: its texture key and where its foot is inside it. */
export interface BakedTexture {
  readonly key: string;
  readonly originX: number;
  readonly originY: number;
}

export interface BakedLean {
  readonly body: BakedTexture;
  readonly shadow: BakedTexture | null;
}

interface LightSet {
  readonly light: string;
  readonly bake: BakeLight;
  readonly leans: (BakedLean | undefined)[];
}

interface BodyRecord {
  readonly id: string;
  readonly species: ScenerySpecies;
  readonly instance: SceneryInstance;
  /** False for a body with no integrator — it is baked at one lean only. */
  readonly sways: boolean;
  current: LightSet;
  next: LightSet | undefined;
  /** Whether `current`'s leans have been queued yet. */
  queued: boolean;
  readonly scaled: Map<string, BakedTexture>;
  used: number;
}

interface Job {
  readonly record: BodyRecord;
  readonly set: LightSet;
  readonly lean: number;
}

/** How many bodies' textures are kept before the least recently seen go. */
const MAX_RECORDS = 110;

/** Horizon bakes are made at this spacing of scale, so a walk re-bakes rarely. */
const SCALE_STEP = 0.05;

/**
 * A body this large on the roll is a few steps from the field: warm its
 * full-size leans in the background so they are ready when it arrives.
 */
const PREWARM_SCALE = 0.55;

let serial = 0;

export class SceneryCache {
  private readonly textures: Phaser.Textures.TextureManager;
  private readonly records = new Map<string, BodyRecord>();
  /** Bodies on the field, drawn this frame from whatever lean was nearest. */
  private readonly urgent: Job[] = [];
  /** Bodies still on the horizon, and re-bakes for a light that moved. */
  private readonly background: Job[] = [];
  /** Texture keys retired this frame, removed next frame once nothing shows them. */
  private graveyard: string[] = [];
  private light: BakeLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.7 };
  private lightId = lightKey(this.light);
  private frame = 0;
  /**
   * Bakes allowed on the spot this frame. A body with nothing baked yet is
   * drawn a frame late rather than stalling the frame it scrolls in on.
   */
  private spotBakes = 1;

  constructor(textures: Phaser.Textures.TextureManager) {
    this.textures = textures;
  }

  /**
   * The light bakes are made in. A change re-bakes each body the next time it
   * is drawn — never the ones out of sight, which would spend the budget on
   * trees nobody is looking at.
   */
  setLight(light: BakeLight): void {
    const id = lightKey(light);
    if (id === this.lightId) {
      return;
    }
    this.light = light;
    this.lightId = id;
    for (const record of this.records.values()) {
      this.retire(record.next);
      record.next = undefined;
    }
  }

  /** The body at the lean nearest `leanIndex`, baking on the spot if it has none. */
  lean(feature: SceneryFeature, leanIndex: number): BakedLean | undefined {
    const record = this.recordFor(feature);
    if (record === undefined) {
      return undefined;
    }
    const index = record.sways ? leanIndex : 0;
    this.schedule(record, this.urgent);
    const ready = nearestReady(record.current.leans, index);
    if (ready !== undefined) {
      return ready;
    }
    if (this.spotBakes <= 0) {
      return undefined;
    }
    this.spotBakes -= 1;
    return this.bakeNow(record, record.current, index);
  }

  /**
   * Start baking a body that is not in view yet but soon will be — just off
   * the edge of the screen, where a strafe or a step will bring it in.
   */
  prewarm(feature: SceneryFeature): void {
    const record = this.recordFor(feature);
    if (record !== undefined) {
      this.schedule(record, this.background);
    }
  }

  /** The body re-sampled for the horizon roll, at a quantised scale. */
  scaled(feature: SceneryFeature, scale: number): BakedTexture | undefined {
    const record = this.recordFor(feature);
    if (record === undefined) {
      return undefined;
    }
    if (scale >= PREWARM_SCALE) {
      this.schedule(record, this.background);
    }
    const step = Math.max(SCALE_STEP, Math.round(scale / SCALE_STEP) * SCALE_STEP);
    const key = `${step.toFixed(2)}|${this.lightId}`;
    let baked = record.scaled.get(key);
    if (baked === undefined) {
      baked = this.install(bakeScaled(record.instance, this.light, step), `${record.id}-s`);
      record.scaled.set(key, baked);
    }
    return baked;
  }

  /**
   * Run queued bakes until `budgetMs` has been spent — always at least one, so
   * the queue drains even on a slow machine.
   */
  pump(budgetMs: number): void {
    this.frame += 1;
    this.spotBakes = 1;
    for (const key of this.graveyard) {
      this.textures.remove(key);
    }
    this.graveyard = [];
    const start = performance.now();
    for (;;) {
      const job = this.urgent.shift() ?? this.background.shift();
      if (job === undefined) {
        break;
      }
      if (job.set.leans[job.lean] === undefined && this.isLive(job)) {
        this.bakeNow(job.record, job.set, job.lean);
      }
      this.promote(job.record);
      if (performance.now() - start >= budgetMs) {
        break;
      }
    }
    this.evict();
  }

  /** Bodies still waiting on a bake — for the debug readout and the tests. */
  pending(): number {
    return this.urgent.length + this.background.length;
  }

  /**
   * Make sure a body's leans are on their way: its first bake if it has never
   * been queued, or a re-bake if the light has moved since it was.
   */
  private schedule(record: BodyRecord, queue: Job[]): void {
    if (!record.queued) {
      record.queued = true;
      this.enqueueAll(record, record.current, queue);
      return;
    }
    if (record.current.light !== this.lightId && record.next === undefined) {
      record.next = this.freshSet(record);
      this.enqueueAll(record, record.next, queue);
    }
  }

  private recordFor(feature: SceneryFeature): BodyRecord | undefined {
    const id = `${feature.species}:${feature.seed}`;
    let record = this.records.get(id);
    if (record === undefined) {
      const species = findSpecies(feature.species);
      if (species === undefined) {
        return undefined;
      }
      const instance = species.create(feature.seed);
      const created: BodyRecord = {
        id,
        species,
        instance,
        sways: instance.step !== undefined,
        current: { light: "", bake: this.light, leans: [] },
        next: undefined,
        queued: false,
        scaled: new Map(),
        used: this.frame,
      };
      created.current = this.freshSet(created);
      this.records.set(id, created);
      record = created;
    }
    record.used = this.frame;
    return record;
  }

  private freshSet(record: BodyRecord): LightSet {
    const count = record.sways ? WIND_LEVELS.length : 1;
    return { light: this.lightId, bake: this.light, leans: Array.from({ length: count }, () => undefined) };
  }

  /** Queue every lean of a set, from rest outward, so the likeliest arrive first. */
  private enqueueAll(record: BodyRecord, set: LightSet, queue: Job[]): void {
    const rest = record.sways ? Math.floor(WIND_LEVELS.length / 2) : 0;
    const order = set.leans
      .map((_unused, index) => index)
      .sort((a, b) => Math.abs(a - rest) - Math.abs(b - rest));
    for (const lean of order) {
      queue.push({ record, set, lean });
    }
  }

  private isLive(job: Job): boolean {
    return job.record.current === job.set || job.record.next === job.set;
  }

  private bakeNow(record: BodyRecord, set: LightSet, index: number): BakedLean {
    const wind = record.sways ? (WIND_LEVELS[index] ?? 0) : 0;
    settleAt(record.instance, wind, set.bake);
    const pose = bakePose(record.instance, set.bake, wind);
    const lean: BakedLean = {
      body: this.install(pose.body, `${record.id}-b`),
      shadow: pose.shadow === null ? null : this.install(pose.shadow, `${record.id}-h`),
    };
    set.leans[index] = lean;
    return lean;
  }

  /** Swap a finished re-bake in, and retire the light it replaces. */
  private promote(record: BodyRecord): void {
    const next = record.next;
    if (next === undefined || next.leans.some((lean) => lean === undefined)) {
      return;
    }
    this.retire(record.current);
    record.current = next;
    record.next = undefined;
    for (const [key, baked] of record.scaled) {
      if (!key.endsWith(`|${next.light}`)) {
        this.graveyard.push(baked.key);
        record.scaled.delete(key);
      }
    }
  }

  private retire(set: LightSet | undefined): void {
    for (const lean of set?.leans ?? []) {
      if (lean !== undefined) {
        this.graveyard.push(lean.body.key);
        if (lean.shadow !== null) {
          this.graveyard.push(lean.shadow.key);
        }
      }
    }
  }

  private install(baked: BakedCloud, prefix: string): BakedTexture {
    serial += 1;
    const key = `scenery-${prefix}-${serial}`;
    installBuffer(this.textures, key, baked.buffer);
    return { key, originX: baked.originX, originY: baked.originY };
  }

  /** Drop the least recently seen bodies once there are too many. */
  private evict(): void {
    if (this.records.size <= MAX_RECORDS) {
      return;
    }
    const stale = [...this.records.values()]
      .filter((record) => record.used < this.frame - 1)
      .sort((a, b) => a.used - b.used)
      .slice(0, this.records.size - MAX_RECORDS);
    for (const record of stale) {
      this.retire(record.current);
      this.retire(record.next);
      for (const baked of record.scaled.values()) {
        this.graveyard.push(baked.key);
      }
      this.records.delete(record.id);
    }
    const gone = new Set(stale);
    for (const queue of [this.urgent, this.background]) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (gone.has((queue[index] as Job).record)) {
          queue.splice(index, 1);
        }
      }
    }
  }
}

/** The ready lean closest to the one asked for, or undefined if none is. */
function nearestReady(leans: readonly (BakedLean | undefined)[], index: number): BakedLean | undefined {
  for (let distance = 0; distance < leans.length; distance += 1) {
    const below = leans[index - distance];
    if (below !== undefined) {
      return below;
    }
    const above = leans[index + distance];
    if (above !== undefined) {
      return above;
    }
  }
  return undefined;
}
