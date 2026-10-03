/**
 * A fireball in flight: where it is, what it has hit, and what it looks like.
 *
 * Pure and renderer-free, so the lab steps exactly the projectile the game
 * throws. The layer (`fireball-layer.ts`) owns the list and the surface.
 *
 * **Two coordinate systems, on purpose.** The fireball *is* on the planet — its
 * position is a `PlanetPoint`, advanced along a planet heading, and every
 * collision test happens there, so it hits the rock that is really in its path
 * however the hero moves while it flies. But it is *drawn* as pixel offsets from
 * its launch point, in the frame it was launched in: the trail is a particle
 * pool, and a particle pool is a set of offsets from an anchor. The two only
 * disagree by how far the camera turns during one flight, which at the strafe
 * radius the planet uses is a small fraction of a degree — the same bargain every
 * point feature on the planet already makes (`CLAUDE.md`, "Point features pay
 * the same strafe quantisation as tiles").
 *
 * The look is three primitives: a small lit SDF sphere for the core, a pooled
 * emitter for the trail (fire licks cooling into smoke puffs, plus the odd
 * spark), and a ramp for all of it.
 */

import { createPool, emit, particleCloud, stepParticles, type ParticlePool, type ParticleSpec } from "../fx/particles";
import type { PixelCloud } from "../ink";
import { type LightSource } from "../lights";
import { familyHex } from "../palette";
import { wrapTile, type LocalPoint, type PlanetPoint, type PlanetPose } from "../planet";
import { valueNoise3 } from "../procgen/noise";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { ditherThreshold, rampInk } from "../shading";
import { FLAME_RAMP } from "./flame";
import { driftPuffs, puffCloud, type PuffStyle } from "./smoke";

/** Tiles per second. */
export const FIREBALL_SPEED = 7;
/** How far it flies before it bursts on its own, tiles. */
export const FIREBALL_RANGE = 8;
/** How high over the ground it flies, pixels — enough to cast a shadow of its own. */
export const FIREBALL_HEIGHT = 7;
/** The longest single collision step, tiles — finer than any rock is wide. */
const PROBE_TILES = 0.2;
const CORE_RADIUS = 3.2;

const TRAIL_CAP = 80;
const SMOKE_CAP = 24;
const LICK_EVERY_MS = 8;
const PUFF_EVERY_MS = 36;
const SPARK_EVERY_MS = 70;

const LICK: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 0.95,
  levelTo: 0.05,
  lifeMs: [120, 300],
  speed: [0.004, 0.025],
  angle: [-Math.PI, 0],
  gravity: -0.00006,
  drag: 0.004,
  spreadX: 2,
  spreadY: 2,
  size: 1,
  fade: 0.4,
  wobble: 0.02,
};

const SPARK: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 1,
  levelTo: 0.5,
  lifeMs: [140, 280],
  speed: [0.04, 0.08],
  angle: [-Math.PI, Math.PI],
  gravity: 0.00012,
  drag: 0.002,
  fade: 0.3,
};

const TRAIL_SMOKE: ParticleSpec = { ...LICK, lifeMs: [500, 850], speed: [0.003, 0.01], gravity: -0.00002 };
/** A second, larger lick drawn as a 2x2 near the core: the trail's hot body. */
const BODY: ParticleSpec = { ...LICK, lifeMs: [60, 130], levelFrom: 1, levelTo: 0.5, size: 2, spreadX: 1, spreadY: 1 };
const TRAIL_PUFF: PuffStyle = { from: 1.2, to: 4, density: 1.1, levelFrom: 0.2, levelTo: 0.9 };

export interface Fireball {
  readonly seed: number;
  readonly origin: PlanetPoint;
  /** Unit heading on the planet. */
  readonly heading: PlanetPoint;
  /** Unit heading in the launch frame (local tiles: +x right, +y ahead). */
  readonly direction: LocalPoint;
  /** Tiles flown so far. */
  travelled: number;
  ageMs: number;
  /** False once it has hit something or run out of range. */
  flying: boolean;
  /** Offsets from the launch point's foot, in the launch frame's pixels. */
  readonly trail: ParticlePool;
  readonly smoke: ParticlePool;
  lickCarry: number;
  puffCarry: number;
  sparkCarry: number;
}

/** A local-frame vector turned into the planet's, by the pose's rotation. */
export function localToPlanetVector(pose: PlanetPose, vector: LocalPoint): PlanetPoint {
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  return { x: vector.x * cos + vector.y * sin, y: -vector.x * sin + vector.y * cos };
}

/**
 * Throw one. `from` is where it leaves the hero, local tiles; `direction` need
 * not be normalised, but must not be zero.
 */
export function launchFireball(from: PlanetPoint, direction: LocalPoint, pose: PlanetPose, seed: number): Fireball {
  const length = Math.hypot(direction.x, direction.y);
  if (!(length > 0)) {
    throw new Error("A fireball needs a direction");
  }
  const unit = { x: direction.x / length, y: direction.y / length };
  return {
    seed,
    origin: from,
    heading: localToPlanetVector(pose, unit),
    direction: unit,
    travelled: 0,
    ageMs: 0,
    flying: true,
    trail: createPool(TRAIL_CAP, seed + 1),
    smoke: createPool(SMOKE_CAP, seed + 2),
    lickCarry: 0,
    puffCarry: 0,
    sparkCarry: 0,
  };
}

/** Where it is on the planet now. */
export function fireballPoint(ball: Fireball): PlanetPoint {
  return {
    x: wrapTile(ball.origin.x + ball.heading.x * ball.travelled),
    y: wrapTile(ball.origin.y + ball.heading.y * ball.travelled),
  };
}

/** Where its core is drawn, in pixels from the launch point's foot. */
export function fireballOffset(ball: Fireball): { x: number; y: number } {
  return {
    x: ball.direction.x * ball.travelled * TILE_WIDTH,
    y: -ball.direction.y * ball.travelled * TILE_DEPTH - FIREBALL_HEIGHT,
  };
}

/**
 * Fly for `deltaMs`, probing the path in short steps.
 *
 * Returns the planet point it burst at, or null while it is still flying. It
 * bursts on the first probe `blocked` says yes to — rock, or something the
 * scene says is in the way — or at the end of its range. Stepped finely so a
 * fast frame cannot carry it through a one-tile outcrop.
 */
export function flyFireball(
  ball: Fireball,
  deltaMs: number,
  blocked: (point: PlanetPoint) => boolean,
): PlanetPoint | null {
  const dt = Math.min(Math.max(deltaMs, 0), 100);
  ball.ageMs += dt;
  if (ball.flying) {
    let left = (FIREBALL_SPEED * dt) / 1000;
    while (left > 0 && ball.flying) {
      const probe = Math.min(left, PROBE_TILES, FIREBALL_RANGE - ball.travelled);
      left -= probe;
      ball.travelled += probe;
      if (blocked(fireballPoint(ball)) || ball.travelled >= FIREBALL_RANGE - 1e-9) {
        ball.flying = false;
        emitTrail(ball, dt);
        return fireballPoint(ball);
      }
    }
    emitTrail(ball, dt);
  }
  stepParticles(ball.trail, dt);
  stepParticles(ball.smoke, dt);
  driftPuffs(ball.smoke, dt, 0.3, 0.004);
  return null;
}

function emitTrail(ball: Fireball, dt: number): void {
  const at = fireballOffset(ball);
  // The trail is thrown backward off the core, so it streams rather than hangs.
  const backX = -ball.direction.x * 0.03;
  const backY = ball.direction.y * 0.02;
  ball.lickCarry += dt;
  while (ball.lickCarry >= LICK_EVERY_MS) {
    ball.lickCarry -= LICK_EVERY_MS;
    emit(ball.trail, LICK, 1, at.x, at.y, { inheritX: backX, inheritY: backY });
    emit(ball.trail, BODY, 1, at.x, at.y, { inheritX: backX, inheritY: backY });
  }
  ball.sparkCarry += dt;
  while (ball.sparkCarry >= SPARK_EVERY_MS) {
    ball.sparkCarry -= SPARK_EVERY_MS;
    emit(ball.trail, SPARK, 1, at.x, at.y);
  }
  ball.puffCarry += dt;
  while (ball.puffCarry >= PUFF_EVERY_MS) {
    ball.puffCarry -= PUFF_EVERY_MS;
    emit(ball.smoke, TRAIL_SMOKE, 1, at.x, at.y - 1);
  }
}

/** Nothing left to draw: burst, and every trail particle has burned out. */
export function fireballSpent(ball: Fireball): boolean {
  return !ball.flying && ball.trail.particles.every((p) => !p.active) && ball.smoke.particles.every((p) => !p.active);
}

/**
 * The core: a small sphere hot at its heart and red at its rim, its outline
 * boiling with a little noise so it burns rather than glows.
 */
export function coreCloud(ageMs: number, seed: number, cx = 0, cy = 0): PixelCloud {
  const cloud: PixelCloud = [];
  const reach = Math.ceil(CORE_RADIUS + 1);
  for (let oy = -reach; oy <= reach; oy += 1) {
    for (let ox = -reach; ox <= reach; ox += 1) {
      const boil = valueNoise3(ox * 0.7, oy * 0.7, ageMs / 60, seed) - 0.5;
      const d = Math.hypot(ox, oy) / (CORE_RADIUS + boil * 1.4);
      if (d > 1) {
        continue;
      }
      const x = Math.round(cx) + ox;
      const y = Math.round(cy) + oy;
      // A hot centre, lifted a pixel toward the top-left where the sphere would
      // catch its own light, falling to red at the rim.
      const hot = 1 - Math.hypot(ox + 0.6, oy + 0.8) / (CORE_RADIUS + 0.4);
      cloud.push({ x, y, ink: rampInk(FLAME_RAMP, 0.35 + hot * 0.85, { x, y }) });
    }
  }
  return cloud;
}

/** The dark smudge on the ground under the core. Sheer, and tighter than the ball. */
function shadowCloud(x: number, y: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -3; ox <= 3; ox += 1) {
      const d = Math.hypot(ox / 3.2, oy / 1.3);
      if (d <= 1 && (d < 0.6 || ditherThreshold(x + ox, y + oy) > 0.4)) {
        cloud.push({ x: x + ox, y: y + oy, ink: d < 0.6 ? "shadow" : "shadow-soft" });
      }
    }
  }
  return cloud;
}

/** Everything the fireball draws, in offsets from its launch point's foot. */
export function fireballCloud(ball: Fireball): PixelCloud {
  const at = fireballOffset(ball);
  const cloud: PixelCloud = [...puffCloud(ball.smoke, TRAIL_PUFF)];
  if (ball.flying) {
    cloud.push(...shadowCloud(Math.round(at.x), Math.round(at.y + FIREBALL_HEIGHT)));
  }
  cloud.push(...particleCloud(ball.trail));
  if (ball.flying) {
    cloud.push(...coreCloud(ball.ageMs, ball.seed, at.x, at.y));
  }
  return cloud;
}

/** The light it carries while it flies, at a screen position. */
export function fireballLight(ball: Fireball, x: number, y: number): LightSource | null {
  if (!ball.flying) {
    return null;
  }
  const pulse = 0.85 + 0.15 * Math.sin(ball.ageMs / 37);
  return { x, y, radius: 44, color: familyHex("fire-5"), intensity: 0.95 * pulse };
}
