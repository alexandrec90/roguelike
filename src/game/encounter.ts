/**
 * Everything that happens *between* the layers when something is struck.
 *
 * The hero swings and casts; spells fly and burst; slimes take the blows; fire
 * catches in the grass; frost puts it out; the dead leave marks. None of those
 * layers imports another — each produces or consumes plain values (`Strike`,
 * `CastEvent`, slime events) — and this is the one place they are routed to
 * each other, once a frame, in an order that lets a blow and its consequences
 * land on the same frame.
 */

import type Phaser from "phaser";

import type { Strike } from "./combat";
import { SlimeLayer } from "./creatures/slime-layer";
import type { SlimeEvents } from "./creatures/slime-sim";
import { CampfireLayer } from "./fire/campfire-layer";
import { DecalLayer } from "./fire/decal-layer";
import { SpellLayer } from "./fire/spell-layer";
import type { FrameContext } from "./frame-context";
import type { HeroLayer } from "./hero-layer";
import { fromLocal, type LocalPoint, type PlanetPoint } from "./planet";
import { WildfireLayer } from "./wildfire-layer";

/** How far a fire strike sets the grass alight, as a share of its reach. */
const KINDLE_SHARE = 0.6;

export class Encounter {
  readonly decals = new DecalLayer();
  readonly campfire = new CampfireLayer();
  readonly spells = new SpellLayer();
  readonly slimes = new SlimeLayer();
  readonly wildfire = new WildfireLayer();

  create(scene: Phaser.Scene, width: number, height: number, campfireAt: PlanetPoint): void {
    this.decals.create(scene, width, height);
    this.wildfire.create(scene, width, height);
    this.campfire.create(scene, campfireAt, 0xf17e);
    this.slimes.create(scene);
    this.spells.create(scene, this.decals, (local) => this.slimes.occupiedNear(local, 0.55));
  }

  update(ctx: FrameContext, hero: HeroLayer): void {
    const heroLocal: LocalPoint = { x: ctx.frame.phaseX, y: ctx.frame.phaseY };
    for (const cast of hero.drainCasts()) {
      if (cast.element === "frost") {
        this.spells.castNova(heroLocal, ctx.pose, ctx.elapsedMs);
      } else {
        this.spells.launch(cast.from, cast.direction, ctx.pose, ctx.elapsedMs);
      }
    }
    this.campfire.update(ctx);
    this.spells.update(ctx);

    const heroStrikes = hero.drainStrikes();
    const strikes = [...heroStrikes, ...this.spells.drainStrikes()];
    const events = this.slimes.update(ctx, { strikes, heroLocal });
    if (heroStrikes.length > 0 && events.hits.length > 0) {
      hero.reportHit();
    }
    this.kindle(ctx, strikes);
    this.markTheDead(ctx, events);

    this.wildfire.update(ctx);
    this.decals.update(ctx);
  }

  /** Fire in the grass where fire struck; frost puts it out. */
  private kindle(ctx: FrameContext, strikes: readonly Strike[]): void {
    for (const strike of strikes) {
      const at = fromLocal(ctx.pose, strike.at);
      if (strike.element === "fire") {
        this.wildfire.ignite(at, strike.radius * KINDLE_SHARE);
      } else if (strike.element === "frost") {
        this.wildfire.douse(at, strike.radius + 0.5);
      }
    }
  }

  /** A burst slime leaves a puddle of itself; a fire slime sets the grass going. */
  private markTheDead(ctx: FrameContext, events: SlimeEvents): void {
    for (const death of events.deaths) {
      const at = fromLocal(ctx.pose, death.at);
      if (death.variant === "fire") {
        this.decals.stamp(at, "scorch", death.id * 977);
        this.wildfire.ignite(at, 0.8);
      } else if (death.variant === "frost") {
        this.decals.stamp(at, "frost", death.id * 977);
      } else {
        this.decals.stamp(at, "goo", death.id * 977);
      }
    }
  }
}
