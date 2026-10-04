/**
 * The fight, with no pixels in it: the routing `encounter.ts` does, over the
 * pure simulations only, for a skin that draws its own way.
 *
 * The hero swings and casts (`HeroDriver`); a fireball flies (`fireball.ts`)
 * and bursts on rock or on a slime; a frost nova strikes where he stands; every
 * blow lands on the slimes (`slime-sim.ts`) in the same frame it was dealt.
 * What a skin reads back is state - the slimes, the fireballs in flight, the
 * bursts still ringing - and it may draw them any way it likes.
 *
 * Not here yet, and still only in the pixel skin's `Encounter`: the wildfire in
 * the grass, the campfire and the decals. They are pixel layers that own their
 * own simulation; moving each one's sim out is what would bring it here.
 */

import type { Strike } from "./combat";
import { occupiedNear, stepSlimes, createSlimeSim, type SlimeEvents, type SlimeSim } from "./creatures/slime-sim";
import { launchFireball, flyFireball, type Fireball } from "./fire/fireball";
import { BLAST_DAMAGE, BLAST_FORCE, BLAST_RADIUS, NOVA_DAMAGE, NOVA_FORCE, NOVA_REACH } from "./fire/spell-layer";
import type { HeroDriver } from "./hero/hero-driver";
import type { ImpulseSink } from "./impulse";
import { blockedByLand } from "./landforms";
import { fromLocal, toLocal, type PlanetPoint } from "./planet";
import { pixelHash } from "./transforms";

/** How long a burst stays on screen, ms: a fireball's blast, and a nova's ring. */
export const BURST_MS = { blast: 520, nova: 420 } as const;

/** A spell's aftermath: where it went off, and how long ago. */
export interface Burst {
  readonly kind: keyof typeof BURST_MS;
  readonly at: PlanetPoint;
  /** Tiles it reaches - what the picture should cover. */
  readonly radius: number;
  ageMs: number;
}

/** How close to a slime a fireball must pass to burst on it, tiles. */
const BALL_HITS_WITHIN = 0.55;

export class EncounterSim {
  readonly slimes: SlimeSim = createSlimeSim();
  readonly fireballs: Fireball[] = [];
  readonly bursts: Burst[] = [];
  private launches = 0;
  private hits = 0;

  /** How many of the hero's own blows have connected: a skin flashes the blade on a change. */
  heroHits(): number {
    return this.hits;
  }

  /**
   * One frame of the fight. Call after `hero.step`: his strikes and casts are
   * drained here, and land on the slimes this frame.
   */
  step(hero: HeroDriver, deltaMs: number, elapsedMs: number, impulse?: ImpulseSink): SlimeEvents {
    const where = hero.whereabouts();
    const pose = where.ground;
    const heroLocal = where.phase;
    const spellStrikes: Strike[] = [];

    for (const cast of hero.drainCasts()) {
      this.launches += 1;
      const seed = Math.floor(pixelHash(Math.floor(elapsedMs), this.launches, 0xf1ba11) * 0xffffff);
      if (cast.element === "frost") {
        spellStrikes.push({ at: heroLocal, radius: NOVA_REACH, damage: NOVA_DAMAGE, element: "frost", force: NOVA_FORCE });
        this.bursts.push({ kind: "nova", at: where.at, radius: NOVA_REACH, ageMs: 0 });
      } else {
        this.fireballs.push(launchFireball(fromLocal(pose, cast.from), cast.direction, pose, seed));
      }
    }

    const blocked = (point: PlanetPoint): boolean =>
      blockedByLand(point) || occupiedNear(this.slimes, toLocal(pose, point), BALL_HITS_WITHIN);
    for (let index = this.fireballs.length - 1; index >= 0; index -= 1) {
      const ball = this.fireballs[index] as Fireball;
      const burst = flyFireball(ball, deltaMs, blocked);
      if (burst !== null) {
        spellStrikes.push({ at: toLocal(pose, burst), radius: BLAST_RADIUS, damage: BLAST_DAMAGE, element: "fire", force: BLAST_FORCE });
        this.bursts.push({ kind: "blast", at: burst, radius: BLAST_RADIUS, ageMs: 0 });
        impulse?.shake(2.5, 250);
        impulse?.hitStop(40);
      }
      if (!ball.flying) {
        this.fireballs.splice(index, 1);
      }
    }

    const heroStrikes = hero.drainStrikes();
    const events = stepSlimes(this.slimes, { pose, hero: heroLocal, strikes: [...heroStrikes, ...spellStrikes], deltaMs });
    if (heroStrikes.length > 0 && events.hits.length > 0) {
      this.hits += 1;
    }
    for (const hit of events.hits) {
      impulse?.hitStop(hit.killed ? 70 : 45);
      impulse?.shake(hit.killed ? 2.5 : 1.5, hit.killed ? 240 : 160);
    }
    this.age(deltaMs);
    return events;
  }

  private age(deltaMs: number): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index] as Burst;
      burst.ageMs += deltaMs;
      if (burst.ageMs >= BURST_MS[burst.kind]) {
        this.bursts.splice(index, 1);
      }
    }
  }
}
