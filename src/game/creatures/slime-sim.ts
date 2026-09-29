/**
 * The slime population: who is alive near the hero, what hit them, and what
 * the rest of the game should hear about it.
 *
 * Pure, deterministic and Phaser-free — the `Separation` contract. Each frame
 * the scene hands it the hero's position, the frame's pose and the strikes the
 * hero's weapons produced; it hands back events (a hit landed here, a slime
 * died there, one landed from a hop) that the presentation turns into hit
 * stop, shake, decals and goo. Rendering can exaggerate any of those; it cannot
 * change one.
 *
 * Population is **dens**, not a list: `slime-spawn.ts` hashes them out of the
 * planet, this module keeps a few alive within reach of the hero, lets the far
 * ones go, and restocks a den some seconds after its slime dies.
 */

import { strikePush, type Element, type Strike } from "../combat";
import { fromLocal, toLocal, type LocalPoint, type PlanetPoint, type PlanetPose } from "../planet";
import { isRockAt } from "../terrain";
import { pixelHash } from "../transforms";
import {
  createSlime,
  EMERGE_MS,
  FLASH_MS,
  stepSlime,
  type Slime,
  type SlimeMode,
} from "./slime-brain";
import { HIT_KICK } from "./slime-motion";
import { elementalFactor, type SlimeVariant } from "./slime-palette";
import {
  densNear,
  planetDistance,
  slimeSeed,
  spawnPoint,
  variantOf,
  type Blocked,
  type Den,
} from "./slime-spawn";

/** Never more than this many alive at once, whatever the dens say. */
export const MAX_SLIMES = 8;
/** Dens within this many tiles of the hero are stocked. */
export const SPAWN_REACH = 12;
/** A slime further than this is let go (its den keeps its place). */
export const DESPAWN_REACH = 16;
/** A den restocks this long after its slime died, ms, plus up to half again. */
export const RESPAWN_MS = 7000;
/** A respawn never happens closer to the hero than this, tiles. */
const RESPAWN_CLEARANCE = 3.5;
/** The dens are re-swept this often, ms — they are a slow question. */
const SWEEP_MS = 250;
/** Added to a strike's reach: a slime is a body, not a point. */
export const SLIME_RADIUS = 0.35;
/** The longest frame the sim will integrate; a backgrounded tab does not teleport slimes. */
const MAX_STEP_MS = 100;

interface DenState {
  readonly den: Den;
  generation: number;
  respawnAtMs: number;
  occupied: boolean;
}

export interface SlimeSim {
  readonly slimes: Slime[];
  readonly dens: Map<number, DenState>;
  readonly blocked: Blocked;
  clockMs: number;
  sweepMs: number;
  nextId: number;
  /** The pose of the last step, which the queries answer in. */
  pose: PlanetPose | null;
}

export interface SlimeInput {
  readonly pose: PlanetPose;
  /** The hero's foot in that pose's local frame — `(phaseX, phaseY)` mid-step. */
  readonly hero: LocalPoint;
  readonly strikes: readonly Strike[];
  readonly deltaMs: number;
}

export interface SlimeHit {
  readonly id: number;
  readonly variant: SlimeVariant;
  readonly element: Element;
  /** Where it was struck, local tiles of this frame. */
  readonly at: LocalPoint;
  /** After elemental resistance: 0 when a fire slime was hit with fire. */
  readonly damage: number;
  readonly killed: boolean;
  /** The knockback it took, local tiles per second — which way to spray the goo. */
  readonly push: LocalPoint;
}

export interface SlimeDeath {
  readonly id: number;
  readonly variant: SlimeVariant;
  readonly at: LocalPoint;
  readonly element: Element;
}

export interface SlimeLanding {
  readonly id: number;
  readonly variant: SlimeVariant;
  readonly at: LocalPoint;
}

export interface SlimeEvents {
  readonly hits: SlimeHit[];
  readonly deaths: SlimeDeath[];
  readonly landings: SlimeLanding[];
}

export function createSlimeSim(options: { readonly blocked?: Blocked } = {}): SlimeSim {
  return {
    slimes: [],
    dens: new Map(),
    blocked: options.blocked ?? isRockAt,
    clockMs: 0,
    sweepMs: 0,
    nextId: 1,
    pose: null,
  };
}

/**
 * Put a slime somewhere by hand — the lab, a test, a scripted encounter.
 * It belongs to no den, so nothing restocks it.
 */
export function spawnSlime(
  sim: SlimeSim,
  at: PlanetPoint,
  options: { readonly seed?: number; readonly variant?: SlimeVariant; readonly mode?: SlimeMode } = {},
): Slime {
  const seed = options.seed ?? sim.nextId * 7919;
  const slime = createSlime(sim.nextId, at, seed, options.variant ?? variantOf(seed), {
    mode: options.mode,
  });
  sim.nextId += 1;
  sim.slimes.push(slime);
  return slime;
}

function stockDen(sim: SlimeSim, state: DenState, hero: PlanetPoint): void {
  const point = spawnPoint(state.den, state.generation, sim.blocked);
  if (state.generation > 0 && planetDistance(point, hero) < RESPAWN_CLEARANCE) {
    return;
  }
  const seed = slimeSeed(state.den, state.generation);
  sim.slimes.push(
    createSlime(sim.nextId, point, seed, variantOf(seed), {
      den: state.den.key,
      // A den's first slime has been sitting there all along; a restock rises
      // out of the ground, which is what tells the player it is new.
      mode: state.generation === 0 ? "idle" : "emerge",
    }),
  );
  sim.nextId += 1;
  state.occupied = true;
}

/** Stock the dens in reach, let the far slimes go, and forget far empty dens. */
function sweep(sim: SlimeSim, hero: PlanetPoint): void {
  for (let index = sim.slimes.length - 1; index >= 0; index -= 1) {
    const slime = sim.slimes[index] as Slime;
    if (slime.mode !== "dying" && planetDistance(slime.at, hero) > DESPAWN_REACH) {
      sim.slimes.splice(index, 1);
      const state = sim.dens.get(slime.den);
      if (state !== undefined) {
        state.occupied = false;
      }
    }
  }
  for (const den of densNear(hero, SPAWN_REACH, sim.blocked)) {
    let state = sim.dens.get(den.key);
    if (state === undefined) {
      state = { den, generation: 0, respawnAtMs: 0, occupied: false };
      sim.dens.set(den.key, state);
    }
    if (!state.occupied && sim.clockMs >= state.respawnAtMs && sim.slimes.length < MAX_SLIMES) {
      stockDen(sim, state, hero);
    }
  }
  for (const [key, state] of sim.dens) {
    if (!state.occupied && planetDistance(state.den.point, hero) > DESPAWN_REACH * 2) {
      sim.dens.delete(key);
    }
  }
}

/** Can this slime be hurt right now? Not while stunned, dying, or still mostly puddle. */
function vulnerable(slime: Slime): boolean {
  if (slime.mode === "emerge") {
    return slime.modeMs > EMERGE_MS * 0.5;
  }
  return slime.mode === "idle" || slime.mode === "hop";
}

/** Local tiles per second to planet tiles per second: the inverse of `toLocal`'s rotation. */
function toPlanetVector(pose: PlanetPose, local: LocalPoint): { x: number; y: number } {
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  return { x: local.x * cos + local.y * sin, y: -local.x * sin + local.y * cos };
}

function applyStrike(slime: Slime, strike: Strike, pose: PlanetPose, events: SlimeEvents): void {
  const factor = elementalFactor(slime.variant, strike.element);
  const damage = strike.damage * factor;
  const push = strikePush(strike, slime.local);
  // An immune slime is still shoved — the blow landed — just not as far.
  const shove = toPlanetVector(pose, push);
  const give = damage > 0 ? 1 : 0.4;
  slime.knockX = shove.x * give;
  slime.knockY = shove.y * give;
  slime.hp -= damage;
  slime.squash.velocity += HIT_KICK;
  slime.liftVelocity = Math.max(slime.liftVelocity, 0) + 40;
  if (damage > 0) {
    slime.flashMs = FLASH_MS;
    if (strike.element === "fire") {
      slime.burnMs = 1400;
    } else if (strike.element === "frost") {
      slime.chillMs = 2200;
    }
  }
  const killed = slime.hp <= 0;
  slime.mode = killed ? "dying" : "hurt";
  slime.modeMs = 0;
  const at = { x: slime.local.x, y: slime.local.y };
  events.hits.push({ id: slime.id, variant: slime.variant, element: strike.element, at, damage, killed, push });
  if (killed) {
    events.deaths.push({ id: slime.id, variant: slime.variant, at, element: strike.element });
  }
}

function resolveStrikes(sim: SlimeSim, strikes: readonly Strike[], pose: PlanetPose, events: SlimeEvents): void {
  if (strikes.length === 0) {
    return;
  }
  for (const slime of sim.slimes) {
    if (!vulnerable(slime)) {
      continue;
    }
    for (const strike of strikes) {
      const reach = strike.radius + SLIME_RADIUS;
      if (Math.hypot(slime.local.x - strike.at.x, slime.local.y - strike.at.y) <= reach) {
        applyStrike(slime, strike, pose, events);
        break;
      }
    }
  }
}

function retire(sim: SlimeSim, index: number): void {
  const [slime] = sim.slimes.splice(index, 1);
  const state = slime === undefined ? undefined : sim.dens.get(slime.den);
  if (state === undefined) {
    return;
  }
  state.occupied = false;
  state.generation += 1;
  const jitter = pixelHash(state.den.cellX, state.den.cellY, state.generation, 0x2e);
  state.respawnAtMs = sim.clockMs + RESPAWN_MS * (1 + jitter * 0.5);
}

/** One frame of the population. Mutates `sim`; returns what happened. */
export function stepSlimes(sim: SlimeSim, input: SlimeInput): SlimeEvents {
  const deltaMs = Math.min(Math.max(input.deltaMs, 0), MAX_STEP_MS);
  const events: SlimeEvents = { hits: [], deaths: [], landings: [] };
  const hero = fromLocal(input.pose, input.hero);
  sim.clockMs += deltaMs;
  sim.pose = input.pose;

  sim.sweepMs -= deltaMs;
  if (sim.sweepMs <= 0) {
    sim.sweepMs = SWEEP_MS;
    sweep(sim, hero);
  }
  for (const slime of sim.slimes) {
    slime.local = toLocal(input.pose, slime.at);
  }
  resolveStrikes(sim, input.strikes, input.pose, events);

  const world = { hero, blocked: sim.blocked, others: sim.slimes };
  for (let index = sim.slimes.length - 1; index >= 0; index -= 1) {
    const slime = sim.slimes[index] as Slime;
    const outcome = stepSlime(slime, world, deltaMs);
    slime.local = toLocal(input.pose, slime.at);
    if (outcome.landed) {
      events.landings.push({ id: slime.id, variant: slime.variant, at: slime.local });
    }
    if (outcome.gone) {
      retire(sim, index);
    }
  }
  return events;
}

/** Slimes a blast or a fireball could touch: alive, and not a fading puddle. */
function solid(slime: Slime): boolean {
  return slime.mode !== "dying";
}

/** Whether any live slime's foot is within `radius` tiles of a local point (last step's frame). */
export function occupiedNear(sim: SlimeSim, local: LocalPoint, radius: number): boolean {
  return sim.slimes.some(
    (slime) => solid(slime) && Math.hypot(slime.local.x - local.x, slime.local.y - local.y) <= radius + SLIME_RADIUS,
  );
}

/** The nearest live slime to a local point, and how far its foot is, tiles. */
export function nearestSlime(
  sim: SlimeSim,
  local: LocalPoint,
): { readonly slime: Slime; readonly distance: number } | null {
  let best: { slime: Slime; distance: number } | null = null;
  for (const slime of sim.slimes) {
    if (!solid(slime)) {
      continue;
    }
    const distance = Math.hypot(slime.local.x - local.x, slime.local.y - local.y);
    if (best === null || distance < best.distance) {
      best = { slime, distance };
    }
  }
  return best;
}
