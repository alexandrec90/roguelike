/**
 * What a slime throws off: goo when it is hit or dies, a splat when it lands,
 * flames while it burns.
 *
 * All of it is the shared particle pool (`fx/particles.ts`) with a spec per
 * effect — no effect owns a colour, each takes its variant's goo ramp — so a
 * fire slime's death sprays embers and a frost slime's sprays ice without a
 * line of per-variant code. Coordinates are foot-relative, logical pixels:
 * (0, 0) is the ground under the slime, so the floor a droplet lands on is a
 * few pixels either side of 0, which is the ground seen at a slant.
 */

import { emit, type ParticlePool, type ParticleSpec } from "../fx/particles";
import { INK_RAMPS } from "../shading";
import { SLIME_INKS, type SlimeVariant } from "./slime-palette";

/**
 * Droplets land on one of a few floors, because the ground is foreshortened: a
 * blob thrown toward the camera lands lower on the screen than one thrown away.
 * One floor would lay every droplet on a single line.
 */
const FLOORS = [-2, 0, 2, 4] as const;

type SpecKind = "goo" | "splat";

const SPECS = new Map<string, ParticleSpec>();

function gooSpec(variant: SlimeVariant, kind: SpecKind, floor: number): ParticleSpec {
  const key = `${variant}|${kind}|${floor}`;
  let spec = SPECS.get(key);
  if (spec === undefined) {
    const ramp = SLIME_INKS[variant].goo;
    spec =
      kind === "goo"
        ? {
            ramp,
            levelFrom: 0.9,
            levelTo: 0.3,
            lifeMs: [520, 900],
            speed: [0.04, 0.1],
            angle: [-Math.PI * 0.95, -Math.PI * 0.05],
            gravity: 0.00042,
            drag: 0.0015,
            size: 2,
            floor,
            bounce: 0.15,
            fade: 0.4,
          }
        : {
            ramp,
            levelFrom: 0.7,
            levelTo: 0.35,
            lifeMs: [240, 380],
            speed: [0.025, 0.055],
            angle: [-Math.PI * 0.92, -Math.PI * 0.08],
            gravity: 0.0005,
            drag: 0.002,
            floor,
            fade: 0.5,
          };
    SPECS.set(key, spec);
  }
  return spec;
}

/** A little puff where it lands: sheer smoke, which on grass reads as dust. */
const DUST: ParticleSpec = {
  ramp: INK_RAMPS.smoke.slice(2),
  levelFrom: 1,
  levelTo: 0,
  lifeMs: [220, 360],
  speed: [0.012, 0.03],
  angle: [-Math.PI * 0.15, Math.PI * 0.15],
  drag: 0.006,
  spreadX: 2,
  fade: 0.6,
};

/** Tongues of flame off a burning slime — rising, wandering, cooling. */
const FLAME: ParticleSpec = {
  ramp: INK_RAMPS.fire.slice(1),
  levelFrom: 1,
  levelTo: 0.15,
  lifeMs: [220, 420],
  speed: [0.01, 0.03],
  angle: [-Math.PI * 0.7, -Math.PI * 0.3],
  gravity: -0.00012,
  wobble: 0.012,
  size: 2,
  spreadX: 4,
  fade: 0.4,
};

/** Launch `count` droplets, dealt round the floors so they land at different depths. */
function spray(
  pool: ParticlePool,
  variant: SlimeVariant,
  kind: SpecKind,
  count: number,
  from: { readonly x: number; readonly y: number; readonly turn?: number },
): void {
  for (let index = 0; index < count; index += 1) {
    const floor = FLOORS[index % FLOORS.length] as number;
    emit(pool, gooSpec(variant, kind, floor), 1, from.x, from.y, { turn: from.turn ?? 0 });
  }
}

/**
 * Goo off a hit, thrown the way the blow pushed. `pushX`/`pushY` are screen
 * axes (+y down); only their direction matters.
 */
export function emitHitGoo(pool: ParticlePool, variant: SlimeVariant, pushX: number, pushY: number): void {
  const length = Math.hypot(pushX, pushY);
  // The cone is centred straight up; lean it toward the push, never past sideways.
  const turn = length === 0 ? 0 : Math.max(-1.1, Math.min(1.1, (pushX / length) * 1.1));
  spray(pool, variant, "goo", 5, { x: 0, y: -5, turn });
}

/** The burst a slime dies in: a big splash of its own jelly in every direction. */
export function emitDeathGoo(pool: ParticlePool, variant: SlimeVariant): void {
  spray(pool, variant, "goo", 14, { x: 0, y: -5 });
}

/** A landing: a few low droplets and a puff of dust either side. */
export function emitLanding(pool: ParticlePool, variant: SlimeVariant): void {
  spray(pool, variant, "splat", 4, { x: 0, y: -1 });
  emit(pool, DUST, 2, -5, 0);
  emit(pool, DUST, 2, 5, 0, { turn: Math.PI });
}

/** A lick of flame — two tongues — off a burning body `height` pixels tall. */
export function emitFlame(pool: ParticlePool, height: number): void {
  emit(pool, FLAME, 2, 0, -Math.max(2, height * 0.6));
}

/**
 * Keep live particles where they were on the ground while their emitter moves.
 *
 * A slime's particles are drawn relative to its foot, so when the slime slides
 * two pixels the droplets it threw would slide with it. Subtracting its own
 * motion leaves them on the ground they fell on, while the world's scroll —
 * which moves the slime and its droplets together — still carries both.
 */
export function shiftPool(pool: ParticlePool, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) {
    return;
  }
  for (const particle of pool.particles) {
    if (particle.active) {
      particle.x -= dx;
      particle.y -= dy;
    }
  }
}
