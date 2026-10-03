/**
 * One slime's life, stepped: the state machine, the hop it chooses, and the
 * physics that carries it.
 *
 * Pure and renderer-free. A slime is planet-anchored — its position is a
 * `PlanetPoint`, and every decision is taken in planet coordinates — so the
 * camera turning under the hero never changes what a slime does, only where it
 * is drawn. Every choice it makes is a seeded hash of its own seed and hop
 * count, so the same slime, fed the same frames, lives the same life.
 *
 * | Mode     | What it is doing                                                |
 * | -------- | --------------------------------------------------------------- |
 * | `emerge` | rising out of a puddle of itself (a melt played backwards)      |
 * | `idle`   | breathing; counting down to its next hop                        |
 * | `hop`    | a committed arc: windup, flight, landing (`slime-motion.ts`)    |
 * | `hurt`   | flashed, knocked back, briefly stunned and immune               |
 * | `dying`  | melting where it fell; removed when the puddle has faded        |
 */

import type { LocalPoint, PlanetPoint } from "../planet";
import { wrapDelta, wrapTile } from "../planet";
import { pixelHash } from "../transforms";
import {
  arcLift,
  createSpring,
  HOP_MAX,
  HOP_MIN,
  hopBeat,
  hopHeight,
  hopSquashTarget,
  LANDING_KICK,
  stepSpring,
  TAKEOFF_KICK,
  type Spring,
} from "./slime-motion";
import type { SlimeVariant } from "./slime-palette";
import type { Blocked } from "./slime-spawn";

export type SlimeMode = "emerge" | "idle" | "hop" | "hurt" | "dying";

/** Rising out of the ground, ms. */
export const EMERGE_MS = 650;
/** Stunned and immune after a hit, ms. */
export const HURT_MS = 380;
/** How long a hit re-inks the body pale, ms. */
export const FLASH_MS = 90;
/** The melt, then the puddle fading, ms. */
export const MELT_MS = 650;
export const DYING_MS = MELT_MS + 1500;

export const SLIME_HP = 3;

/** Within this many tiles the hero is noticed; past `FORGET_RANGE` forgotten. */
export const NOTICE_RANGE = 5;
export const FORGET_RANGE = 7;
/** The distance an aware slime tries to hold from the hero, tiles. */
export const KEEP_DISTANCE = 1.1;
/** How far a wandering slime strays from where it was spawned, tiles. */
export const LEASH = 3;
/** Two slimes will not land closer than this, tiles. */
const PERSONAL_SPACE = 0.75;

/** Knockback friction: velocity falls by e every this many ms. */
const KNOCK_TAU_MS = 110;
/** Pull of gravity on a slime off the ground outside a hop, px/s². */
const GRAVITY = 520;

export interface Slime {
  readonly id: number;
  /** The den it came from (`slime-spawn.ts`), or -1 for one placed by hand. */
  readonly den: number;
  readonly seed: number;
  readonly variant: SlimeVariant;
  /** Where it was spawned; a wandering slime stays leashed to it. */
  readonly home: PlanetPoint;
  at: PlanetPoint;
  /** Its foot in the local frame of the last step. */
  local: LocalPoint;
  mode: SlimeMode;
  modeMs: number;
  hp: number;
  waitMs: number;
  /** Hops taken — the counter every hop's seeded choices are hashed from. */
  hops: number;
  hopFrom: PlanetPoint;
  hopTo: PlanetPoint;
  hopHeight: number;
  /** Logical pixels above the ground, and how fast that is changing (up is +). */
  lift: number;
  liftVelocity: number;
  /** Knockback, planet tiles per second. */
  knockX: number;
  knockY: number;
  flashMs: number;
  burnMs: number;
  chillMs: number;
  aware: boolean;
  /** Vertical squash: +0.3 is stretched tall, -0.3 pancaked. */
  readonly squash: Spring;
  /** Planet tiles it moved in the last step — what its ground effects subtract. */
  movedX: number;
  movedY: number;
}

export interface BrainWorld {
  readonly hero: PlanetPoint;
  readonly blocked: Blocked;
  readonly others: readonly Slime[];
}

export function createSlime(
  id: number,
  at: PlanetPoint,
  seed: number,
  variant: SlimeVariant,
  options: { readonly den?: number; readonly mode?: SlimeMode } = {},
): Slime {
  return {
    id,
    den: options.den ?? -1,
    seed,
    variant,
    home: at,
    at,
    local: { x: 0, y: 0 },
    mode: options.mode ?? "idle",
    modeMs: 0,
    hp: SLIME_HP,
    waitMs: 400 + pixelHash(seed, 0, 0x1d, 1) * 1400,
    hops: 0,
    hopFrom: at,
    hopTo: at,
    hopHeight: 0,
    lift: 0,
    liftVelocity: 0,
    knockX: 0,
    knockY: 0,
    flashMs: 0,
    burnMs: 0,
    chillMs: 0,
    aware: false,
    squash: createSpring(),
    movedX: 0,
    movedY: 0,
  };
}

/** A seeded unit draw for this slime's current hop. */
function roll(slime: Slime, salt: number): number {
  return pixelHash(slime.hops, salt, slime.seed, 0x5b);
}

function offset(point: PlanetPoint, dx: number, dy: number): PlanetPoint {
  return { x: wrapTile(point.x + dx), y: wrapTile(point.y + dy) };
}

function distanceBetween(a: PlanetPoint, b: PlanetPoint): number {
  return Math.hypot(wrapDelta(a.x, b.x), wrapDelta(a.y, b.y));
}

/** Where it wants to go and how far, before rock and neighbours have a say. */
function intent(slime: Slime, hero: PlanetPoint): { angle: number; length: number } {
  const dx = wrapDelta(hero.x, slime.at.x);
  const dy = wrapDelta(hero.y, slime.at.y);
  const toHero = Math.atan2(dy, dx);
  const distance = Math.hypot(dx, dy);
  if (slime.burnMs > 0) {
    // Panic: anywhere, as far as it can.
    return { angle: roll(slime, 1) * Math.PI * 2, length: HOP_MAX };
  }
  if (slime.aware) {
    if (distance > KEEP_DISTANCE + 0.4) {
      const length = Math.min(Math.max(distance - KEEP_DISTANCE, HOP_MIN), HOP_MAX);
      return { angle: toHero + (roll(slime, 1) - 0.5) * 0.7, length };
    }
    if (distance < KEEP_DISTANCE - 0.3) {
      return { angle: toHero + Math.PI, length: HOP_MIN };
    }
    // Close enough: circle him, which keeps a crowd from stacking up on one side.
    return { angle: toHero + (roll(slime, 1) < 0.5 ? 1 : -1) * Math.PI * 0.5, length: HOP_MIN };
  }
  const length = HOP_MIN + roll(slime, 2) * (HOP_MAX - HOP_MIN);
  const homeX = wrapDelta(slime.home.x, slime.at.x);
  const homeY = wrapDelta(slime.home.y, slime.at.y);
  if (Math.hypot(homeX, homeY) > LEASH) {
    return { angle: Math.atan2(homeY, homeX) + (roll(slime, 1) - 0.5) * 0.9, length };
  }
  return { angle: roll(slime, 1) * Math.PI * 2, length };
}

function crowded(slime: Slime, target: PlanetPoint, others: readonly Slime[]): boolean {
  return others.some(
    (other) =>
      other.id !== slime.id &&
      other.mode !== "dying" &&
      (distanceBetween(other.at, target) < PERSONAL_SPACE ||
        (other.mode === "hop" && distanceBetween(other.hopTo, target) < PERSONAL_SPACE)),
  );
}

/**
 * The hop it will take, or null when every way it tried was rock or taken.
 *
 * The wanted direction first, then fanning out either side of it, then
 * straight back: a slime against a cliff slides along it instead of freezing.
 */
export function chooseHop(slime: Slime, world: BrainWorld): PlanetPoint | null {
  const wanted = intent(slime, world.hero);
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
    const angle = wanted.angle + turn;
    const dx = Math.cos(angle) * wanted.length;
    const dy = Math.sin(angle) * wanted.length;
    const target = offset(slime.at, dx, dy);
    const midway = offset(slime.at, dx / 2, dy / 2);
    if (!world.blocked(target) && !world.blocked(midway) && !crowded(slime, target, world.others)) {
      return target;
    }
  }
  return null;
}

/** How long to sit before the next hop: impatient when hunting, lazy when not. */
function nextWait(slime: Slime): number {
  const unit = roll(slime, 3);
  if (slime.burnMs > 0) {
    return unit * 120;
  }
  return slime.aware ? 160 + unit * 360 : 900 + unit * 1700;
}

function updateAwareness(slime: Slime, hero: PlanetPoint): void {
  const distance = distanceBetween(slime.at, hero);
  if (distance < NOTICE_RANGE) {
    slime.aware = true;
  } else if (distance > FORGET_RANGE) {
    slime.aware = false;
  }
}

/** Slide under knockback; rock stops it dead rather than letting it in. */
function slide(slime: Slime, deltaMs: number, blocked: Blocked): void {
  if (slime.knockX === 0 && slime.knockY === 0) {
    return;
  }
  const seconds = deltaMs / 1000;
  const next = offset(slime.at, slime.knockX * seconds, slime.knockY * seconds);
  if (blocked(next)) {
    slime.knockX = 0;
    slime.knockY = 0;
    return;
  }
  slime.at = next;
  const keep = Math.exp(-deltaMs / KNOCK_TAU_MS);
  slime.knockX *= keep;
  slime.knockY *= keep;
  if (Math.hypot(slime.knockX, slime.knockY) < 0.05) {
    slime.knockX = 0;
    slime.knockY = 0;
  }
}

/** Off the ground outside a hop — knocked up by a hit — gravity brings it back. */
function fall(slime: Slime, deltaMs: number): void {
  if (slime.lift <= 0 && slime.liftVelocity <= 0) {
    slime.lift = 0;
    slime.liftVelocity = 0;
    return;
  }
  const seconds = deltaMs / 1000;
  slime.liftVelocity -= GRAVITY * seconds;
  slime.lift += slime.liftVelocity * seconds;
  if (slime.lift <= 0) {
    slime.lift = 0;
    slime.liftVelocity = 0;
  }
}

function enter(slime: Slime, mode: SlimeMode): void {
  slime.mode = mode;
  slime.modeMs = 0;
}

function startHop(slime: Slime, world: BrainWorld): void {
  const target = chooseHop(slime, world);
  slime.hops += 1;
  if (target === null) {
    slime.waitMs = 300 + roll(slime, 4) * 500;
    return;
  }
  slime.hopFrom = slime.at;
  slime.hopTo = target;
  slime.hopHeight = hopHeight(distanceBetween(slime.at, target));
  enter(slime, "hop");
}

/** One frame of a hop. Returns true on the frame it lands. */
function stepHop(slime: Slime, deltaMs: number): boolean {
  const before = hopBeat(slime.modeMs).beat;
  slime.modeMs += deltaMs;
  const { beat, t } = hopBeat(slime.modeMs);
  let landed = false;
  if (before === "windup" && beat !== "windup") {
    slime.squash.velocity += TAKEOFF_KICK;
  }
  if (beat === "air") {
    slime.at = offset(
      slime.hopFrom,
      wrapDelta(slime.hopTo.x, slime.hopFrom.x) * t,
      wrapDelta(slime.hopTo.y, slime.hopFrom.y) * t,
    );
    slime.lift = arcLift(t, slime.hopHeight);
  } else if (before === "windup" || before === "air") {
    if (beat !== "windup") {
      slime.at = slime.hopTo;
      slime.lift = 0;
      slime.squash.velocity += LANDING_KICK;
      landed = true;
    }
  }
  if (beat === "done") {
    enter(slime, "idle");
    slime.waitMs = nextWait(slime);
  }
  return landed;
}

/** The squash spring's target this frame, before the idle breath is added. */
function squashTarget(slime: Slime): number {
  if (slime.mode === "hop") {
    return hopSquashTarget(slime.modeMs);
  }
  if (slime.mode === "hurt") {
    return slime.modeMs < 120 ? -0.14 : 0;
  }
  return 0;
}

/** What one step did that the world might want to hear about. */
export interface StepOutcome {
  readonly landed: boolean;
  /** The slime has finished dying and should be removed. */
  readonly gone: boolean;
}

/** Advance one slime by `deltaMs`. The only place a slime's state changes over time. */
export function stepSlime(slime: Slime, world: BrainWorld, deltaMs: number): StepOutcome {
  const before = slime.at;
  // A chilled slime runs slow: its waits, its hops and its wobble all stretch.
  const pace = slime.chillMs > 0 ? 0.45 : 1;
  const dt = deltaMs * pace;
  slime.flashMs = Math.max(0, slime.flashMs - deltaMs);
  slime.burnMs = Math.max(0, slime.burnMs - deltaMs);
  slime.chillMs = Math.max(0, slime.chillMs - deltaMs);
  updateAwareness(slime, world.hero);
  slide(slime, deltaMs, world.blocked);

  let landed = false;
  switch (slime.mode) {
    case "emerge":
      slime.modeMs += deltaMs;
      if (slime.modeMs >= EMERGE_MS) {
        enter(slime, "idle");
      }
      break;
    case "idle":
      slime.waitMs -= dt;
      if (slime.waitMs <= 0) {
        startHop(slime, world);
      }
      break;
    case "hop":
      landed = stepHop(slime, dt);
      break;
    case "hurt":
      slime.modeMs += deltaMs;
      if (slime.modeMs >= HURT_MS) {
        enter(slime, "idle");
        slime.waitMs = 220;
      }
      break;
    case "dying":
      slime.modeMs += deltaMs;
      break;
  }
  if (slime.mode !== "hop") {
    fall(slime, deltaMs);
  }
  stepSpring(slime.squash, squashTarget(slime), dt);
  slime.movedX = wrapDelta(slime.at.x, before.x);
  slime.movedY = wrapDelta(slime.at.y, before.y);
  return { landed, gone: slime.mode === "dying" && slime.modeMs >= DYING_MS };
}
