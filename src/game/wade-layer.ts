/**
 * Wading: what walking through water does to it, and to the walker.
 *
 * Each wader's footfalls are counted by `water/wake.ts`; this plays them - a
 * ring on the water at the foot (`WaterLayer.ring`, so it is clipped to the
 * water and drawn with every other ring) and a throw of spray from the
 * general particle pool, drawn on a surface of its own over everything that
 * stands, since a splash rises in front of the legs that made it. And it says
 * how far a wader has sunk (`sinkRows`): the rows of it the water hides.
 *
 * Spray lies on the ground like the weather's splashes, so it lives on the
 * zero-phase grid and is slid by the scroll offset: thrown where the foot was,
 * it stays there as the world walks on under the hero.
 */

import type { Scene } from "../engine";

import { scrollOffset } from "./camera";
import { ALL_EFFECTS, type EffectSwitches } from "./effects";
import type { FrameContext } from "./frame-context";
import { clearPool, createPool, emit, particleCloud, stepParticles, type ParticlePool } from "./fx/particles";
import { nearLake, wadeDepth } from "./lakes";
import type { PlanetPoint } from "./planet";
import { PixelSurface } from "./pixel-surface";
import type { Foot } from "./water-layer";
import { createWake, IDLE_RING, SPRAY_COUNT, SPRAY_SPEC, STEP_RING, stepWake, type WakeState } from "./water/wake";

/** Over everything standing, under the ambient motes and the lighting pass: spray is lit like the rest. */
export const SPRAY_DEPTH = 2950;

/** The deepest a wader sinks, logical pixels: to the shins at the edge of the deep water. */
export const MAX_SINK = 4;

/** How far apart a wader's two feet strike the water, logical pixels either side of its centre. */
const STANCE = 2;

/** Anything walking: its feet on screen, and how far it has walked in all. */
export interface Wader {
  readonly id: string;
  readonly foot: Foot;
  /** Tiles walked in all - where its footfalls are. */
  readonly travelled: number;
}

/** What the wade layer rings: the water layer, or a stand-in that records the rings. */
export interface RingWater {
  holdsWater(point: Foot, frame: FrameContext["frame"]): boolean;
  ring(point: Foot, frame: FrameContext["frame"], lifeMs: number, radius: number): boolean;
}

/**
 * How many rows of a wader standing at `point` the water hides: none on dry
 * ground or in a puddle, which is only ever ankle-wet, and from one at a
 * lake's shore to `MAX_SINK` where the shallows end.
 */
export function sinkRows(wet: boolean, point: PlanetPoint): number {
  if (!wet || !nearLake(point)) {
    return 0;
  }
  return 1 + Math.round(wadeDepth(point) * (MAX_SINK - 1));
}

export class WadeLayer {
  private readonly wakes = new Map<string, WakeState>();
  private readonly spray: ParticlePool;
  private surface: PixelSurface | undefined;
  /** The rows the spray was last painted over, `to` exclusive. */
  private painted: { from: number; to: number } | undefined;

  /** Whether the spray was on last frame. */
  private spraying = true;

  /**
   * `spray` is read every frame: off, none is thrown, stepped or painted, and
   * what was in the air when it went off is cleared.
   */
  constructor(
    seed: number,
    private readonly effects: EffectSwitches = ALL_EFFECTS,
  ) {
    this.spray = createPool(64, seed);
  }

  create(scene: Scene, width: number, height: number): void {
    this.surface = new PixelSurface(scene, width, height, "wade-spray");
    this.surface.image.setDepth(SPRAY_DEPTH);
  }

  /** One frame: each wader's footfall, if one fell, rings the water and throws spray; then the spray flies. */
  update(ctx: FrameContext, water: RingWater, waders: readonly Wader[]): void {
    const offset = scrollOffset(ctx.frame);
    const sprays = this.effects.on("spray");
    for (const wader of waders) {
      let wake = this.wakes.get(wader.id);
      if (wake === undefined) {
        wake = createWake();
        this.wakes.set(wader.id, wake);
      }
      const wet = water.holdsWater(wader.foot, ctx.frame);
      const beat = stepWake(wake, wader.travelled, wet, ctx.deltaMs);
      if (beat?.kind === "step") {
        const foot = { x: wader.foot.x + beat.side * STANCE, y: wader.foot.y };
        water.ring(foot, ctx.frame, STEP_RING.lifeMs, STEP_RING.radius);
        if (sprays) {
          emit(this.spray, SPRAY_SPEC, SPRAY_COUNT, foot.x - offset.x, foot.y - offset.y - 1);
        }
      } else if (beat?.kind === "lap") {
        water.ring(wader.foot, ctx.frame, IDLE_RING.lifeMs, IDLE_RING.radius);
      }
    }
    const listed = new Set(waders.map((wader) => wader.id));
    for (const id of this.wakes.keys()) {
      if (!listed.has(id)) {
        this.wakes.delete(id);
      }
    }
    if (sprays) {
      stepParticles(this.spray, ctx.deltaMs);
      this.paint(offset.x, offset.y);
    } else if (this.spraying) {
      // Off this frame: drop what was in the air, and paint the empty pool once to wipe it.
      clearPool(this.spray);
      this.paint(offset.x, offset.y);
    }
    this.spraying = sprays;
  }

  /** Clear and upload only the rows the spray covers now and covered last frame. */
  private paint(dx: number, dy: number): void {
    const surface = this.surface;
    if (surface === undefined) {
      return;
    }
    const cloud = particleCloud(this.spray, dx, dy);
    let rows: { from: number; to: number } | undefined;
    for (const pixel of cloud) {
      const y = Math.round(pixel.y);
      rows = rows === undefined ? { from: y, to: y + 1 } : { from: Math.min(rows.from, y), to: Math.max(rows.to, y + 1) };
    }
    const band = rows ?? this.painted;
    if (band === undefined) {
      return;
    }
    const last = this.painted ?? band;
    const span = { from: Math.min(band.from, last.from), to: Math.max(band.to, last.to) };
    surface.clearRows(span.from, span.to).paint(cloud, 0, 0, 0.85).commit(span);
    this.painted = rows;
  }
}
