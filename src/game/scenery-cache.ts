/**
 * The baked scenery, as textures: one per body, per lean, per light.
 *
 * `scenery-bake.ts` turns a posed body into pixels and `scenery-baker.ts` runs
 * that off the main thread; this owns what the pixels become on the GPU and
 * when they are asked for. Four rules keep it cheap and keep it from popping:
 *
 * - **Nothing is baked twice, and there is little to bake.** A body is keyed by
 *   species and seed, and seeds are drawn from `SCENERY_VARIANTS` per species,
 *   so the planet's whole wood is a few dozen bodies. `warm` asks for every one
 *   of them before the first frame is shown.
 * - **Nothing is baked on the frame.** Jobs go to the baker; `pump` only
 *   uploads what came back, within a budget.
 * - **A body is never hidden for want of a bake it once had.** A horizon body
 *   shows its ladder from the last light until this light's is back; a body
 *   whose lean is not back yet shows its nearest lean.
 * - **The old picture holds until the new one is whole.** When the sun crosses
 *   a step every body is re-baked, and each keeps drawing its previous light
 *   until all of its new leans are back, so dusk creeps across a wood rather
 *   than flickering through it.
 */

import type { TextureStore } from "../engine";
import type { BakedCloud } from "./pixel-buffer";
import { installBuffer, installFrames } from "./pixel-surface";
import { lightKey, WIND_LEVELS, type BakeLight } from "./scenery-bake";
import { speciesSways, type BakeJob, type BakeResult } from "./scenery-bake-jobs";
import { createBaker, type Baker } from "./scenery-baker";
import { findSpecies } from "./trees";

/** A baked picture on the GPU: its texture key, the frame in it if any, and where its foot is inside it. */
export interface BakedTexture {
  readonly key: string;
  readonly frame?: string;
  readonly originX: number;
  readonly originY: number;
}

export interface BakedLean {
  readonly body: BakedTexture;
  readonly shadow: BakedTexture | null;
}

/** A body or a scale, identified by what `recordFor` needs. */
export interface BodyRef {
  readonly species: string;
  readonly seed: number;
}

interface LightSet {
  readonly light: string;
  readonly bake: BakeLight;
  readonly leans: (BakedLean | undefined)[];
  readonly asked: boolean[];
}

/** A body's horizon pictures, every scale step, in one texture of one light. */
interface Ladder {
  readonly light: string;
  readonly key: string;
  /** Rung `step - 1` is the body at `step * SCALE_STEP`. */
  readonly rungs: readonly BakedTexture[];
}

interface BodyRecord {
  readonly id: string;
  readonly species: string;
  readonly seed: number;
  /** False for a body with no integrator — it is baked at one lean only. */
  readonly sways: boolean;
  current: LightSet;
  next: LightSet | undefined;
  /** The horizon ladder, in the light it was made in. */
  ladder: Ladder | undefined;
  /** The light the last ladder was asked for in. */
  ladderAsked: string | undefined;
}

type Ticket =
  | { readonly kind: "lean"; readonly record: BodyRecord; readonly set: LightSet; readonly lean: number }
  | { readonly kind: "ladder"; readonly record: BodyRecord; readonly light: string };

/**
 * Horizon bakes are made at this spacing of scale: fine enough that a body
 * grows a pixel or two at a time as it comes down the roll.
 */
const SCALE_STEP = 0.025;

/**
 * Every rung of the ladder, up to full size. All of them are baked at once, in
 * one job per body and light: a body is posed once and re-sampled per rung,
 * where asking rung by rung posed it again for each - two thousand jobs across
 * a wood, four workers flat out for the first minute of every walk.
 */
const LADDER_STEPS = Math.round(1 / SCALE_STEP);
const LADDER_SCALES: readonly number[] = Array.from({ length: LADDER_STEPS }, (_unused, index) => (index + 1) * SCALE_STEP);

/** Milliseconds of uploads allowed a frame, beyond the first. */
const UPLOAD_BUDGET_MS = 2;

let serial = 0;

export class SceneryCache {
  private readonly textures: TextureStore;
  private readonly baker: Baker;
  private readonly records = new Map<string, BodyRecord>();
  private readonly tickets = new Map<number, Ticket>();
  /** Finished bakes not yet uploaded, oldest first. */
  private landed: { ticket: number; result: BakeResult | null }[] = [];
  /** Texture keys retired this frame, removed next frame once nothing shows them. */
  private graveyard: string[] = [];
  private light: BakeLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.7 };
  private lightId = lightKey(this.light);

  constructor(textures: TextureStore, baker: Baker = createBaker()) {
    this.textures = textures;
    this.baker = baker;
  }

  /**
   * The light bakes are made in. A change re-bakes each body the next time it
   * is drawn — never the ones out of sight.
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

  /**
   * Ask for every body there is: each one's rest lean and its horizon ladder
   * first, then its other leans. `warmed` says when the first half is in.
   */
  warm(bodies: readonly BodyRef[]): void {
    const records = bodies.flatMap((body) => this.recordFor(body) ?? []);
    for (const record of records) {
      this.askLean(record, record.current, restLean(record));
    }
    for (const record of records) {
      this.askLadder(record);
    }
    for (const record of records) {
      this.schedule(record);
    }
  }

  /** Whether every known body has a picture to show, at full size and on the horizon. */
  warmed(): boolean {
    for (const record of this.records.values()) {
      if (record.current.leans.every((lean) => lean === undefined) || record.ladder === undefined) {
        return false;
      }
    }
    return true;
  }

  /** The body at the lean nearest `leanIndex`, or undefined until its first bake is back. */
  lean(feature: BodyRef, leanIndex: number): BakedLean | undefined {
    const record = this.recordFor(feature);
    if (record === undefined) {
      return undefined;
    }
    this.schedule(record);
    return nearestReady(record.current.leans, record.sways ? leanIndex : 0);
  }

  /** Start baking a body that is not in view yet but soon will be. */
  prewarm(feature: BodyRef): void {
    const record = this.recordFor(feature);
    if (record !== undefined) {
      this.schedule(record);
    }
  }

  /**
   * The body re-sampled for the horizon roll, at the nearest rung. A ladder
   * from a light already passed is shown until this light's is back.
   */
  scaled(feature: BodyRef, scale: number): BakedTexture | undefined {
    const record = this.recordFor(feature);
    if (record === undefined) {
      return undefined;
    }
    if (record.ladder?.light !== this.lightId) {
      this.askLadder(record);
    }
    return record.ladder?.rungs[stepOf(scale) - 1];
  }

  /** Upload what the baker finished, within `budgetMs` — always at least one. */
  pump(budgetMs: number = UPLOAD_BUDGET_MS): void {
    for (const key of this.graveyard) {
      this.textures.remove(key);
    }
    this.graveyard = [];
    this.landed.push(...this.baker.collect(budgetMs));
    const start = performance.now();
    while (this.landed.length > 0) {
      const done = this.landed.shift();
      if (done !== undefined) {
        this.land(done.ticket, done.result);
      }
      if (performance.now() - start >= budgetMs) {
        break;
      }
    }
  }

  /** Bakes asked for and not yet on the GPU — for the debug readout and the tests. */
  pending(): number {
    return this.tickets.size;
  }

  /** Make sure every lean of a body is on its way, in the light it should be drawn in. */
  private schedule(record: BodyRecord): void {
    if (record.current.light !== this.lightId && record.next === undefined) {
      record.next = this.freshSet();
    }
    const set = record.next ?? record.current;
    if (set.asked.every(Boolean)) {
      return;
    }
    for (const lean of leanOrder(record, set)) {
      this.askLean(record, set, lean);
    }
  }

  private askLean(record: BodyRecord, set: LightSet, lean: number): void {
    if (set.asked[lean] === true) {
      return;
    }
    set.asked[lean] = true;
    const job: BakeJob = { kind: "lean", species: record.species, seed: record.seed, light: set.bake, lean };
    this.tickets.set(this.baker.submit(job, record.id), { kind: "lean", record, set, lean });
  }

  private askLadder(record: BodyRecord): void {
    if (record.ladderAsked === this.lightId || record.ladder?.light === this.lightId) {
      return;
    }
    record.ladderAsked = this.lightId;
    const job: BakeJob = { kind: "ladder", species: record.species, seed: record.seed, light: this.light, scales: LADDER_SCALES };
    this.tickets.set(this.baker.submit(job, record.id), { kind: "ladder", record, light: this.lightId });
  }

  private land(id: number, result: BakeResult | null): void {
    const ticket = this.tickets.get(id);
    this.tickets.delete(id);
    if (ticket === undefined || result === null) {
      return;
    }
    if (ticket.kind === "ladder") {
      if (result.kind === "ladder") {
        this.landLadder(ticket, result.frames);
      }
      return;
    }
    const { record, set, lean } = ticket;
    if (result.kind !== "lean" || (set !== record.current && set !== record.next)) {
      return;
    }
    set.leans[lean] = {
      body: this.install(result.body, `${record.id}-b`),
      shadow: result.shadow === null ? null : this.install(result.shadow, `${record.id}-h`),
    };
    this.promote(record);
  }

  private landLadder(ticket: Extract<Ticket, { kind: "ladder" }>, frames: readonly BakedCloud[]): void {
    const { record, light } = ticket;
    const held = record.ladder;
    // A bake from a light already passed still beats nothing, never a newer one.
    if (held !== undefined && (light !== this.lightId || held.light === this.lightId)) {
      return;
    }
    if (held !== undefined) {
      this.graveyard.push(held.key);
    }
    serial += 1;
    const key = `scenery-${record.id}-s-${serial}`;
    installFrames(
      this.textures,
      key,
      frames.map((frame) => frame.buffer),
    );
    record.ladder = {
      light,
      key,
      rungs: frames.map((frame, index) => ({ key, frame: String(index), originX: frame.originX, originY: frame.originY })),
    };
  }

  private recordFor(feature: BodyRef): BodyRecord | undefined {
    const id = `${feature.species}:${feature.seed}`;
    let record = this.records.get(id);
    if (record === undefined) {
      if (findSpecies(feature.species) === undefined) {
        return undefined;
      }
      record = {
        id,
        species: feature.species,
        seed: feature.seed,
        sways: speciesSways(feature.species, feature.seed),
        current: { light: "", bake: this.light, leans: [], asked: [] },
        next: undefined,
        ladder: undefined,
        ladderAsked: undefined,
      };
      record.current = this.freshSet(record.sways);
      this.records.set(id, record);
    }
    return record;
  }

  private freshSet(sways = true): LightSet {
    const count = sways ? WIND_LEVELS.length : 1;
    return {
      light: this.lightId,
      bake: this.light,
      leans: Array.from({ length: count }, () => undefined),
      asked: Array.from({ length: count }, () => false),
    };
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
}

/** A scale as a whole number of `SCALE_STEP`s: a rung of the ladder. */
function stepOf(scale: number): number {
  return Math.min(LADDER_STEPS, Math.max(1, Math.round(scale / SCALE_STEP)));
}

function restLean(record: BodyRecord): number {
  return record.sways ? Math.floor(WIND_LEVELS.length / 2) : 0;
}

/** Every lean of a set, from rest outward, so the likeliest arrive first. */
function leanOrder(record: BodyRecord, set: LightSet): number[] {
  const rest = restLean(record);
  return set.leans.map((_unused, index) => index).sort((a, b) => Math.abs(a - rest) - Math.abs(b - rest));
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
