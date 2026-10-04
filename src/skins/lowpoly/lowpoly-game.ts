/**
 * One frame of the low-poly skin: step the shared simulation, then draw it.
 *
 * The order is the pixel scene's: the clock (with its hit stop), the hero, the
 * fight, then the picture. Nothing here decides an outcome - the hero is a
 * `HeroDriver`, the fight an `EncounterSim`, the hour a `WorldClock` - so the
 * two skins cannot disagree about where anything is or what happened.
 *
 * The world is drawn from the hero's *live* pose - the continuous one. The pixel
 * skin has to carry a step as whole tiles plus a scroll because its ground is a
 * tile grid; geometry has no grid, so here a strafe simply turns the world.
 */

import { WorldClock } from "../../game/world-clock";
import { EncounterSim } from "../../game/encounter-sim";
import { HeroDriver } from "../../game/hero/hero-driver";
import { layeredPose } from "../../game/hero/hero-figure";
import { tracksOf } from "../../game/hero/hero-look";
import { easeYaw } from "../../game/hero/turn";
import { dryGround, wadeDepth } from "../../game/lakes";
import type { SceneOptions } from "../../game/scene-options";
import type { PlanetPoint } from "../../game/planet";
import { burstMesh, fireballMesh, slimeMesh } from "./actor-mesh";
import { heroHeightPx, heroMesh } from "./hero-mesh";
import { MeshBuilder } from "./mesh";
import { lowpolyView, type LowpolyView } from "./placement";
import { LowpolyRenderer } from "./renderer";
import { shadowUnder } from "./scenery-mesh";
import { buildChunk, chunkOffset, CHUNK_TILES, CHUNKS_PER_SIDE, type ChunkMesh } from "./world-chunks";

/** Where the session opens: the pixel skin's start, so a switch lands in the same field. */
const START: PlanetPoint = { x: 128, y: 128 };

/** How far into a lake the hero's shins go, tiles, at the edge of the deep water. */
const WADE_SINK = 0.4;

/** Milliseconds of chunk building a frame may spend while the planet is still being made. */
const BUILD_BUDGET_MS = 10;

type Drawable = ReturnType<LowpolyRenderer["createDrawable"]>;

interface LoadedChunk {
  readonly mesh: ChunkMesh;
  readonly solid: Drawable;
  readonly sheer: Drawable;
}

export class LowpolyGame {
  readonly hero: HeroDriver;
  readonly encounter = new EncounterSim();
  readonly heroHeight = heroHeightPx();
  private readonly clock: WorldClock;
  private readonly renderer: LowpolyRenderer;
  private readonly chunks: LoadedChunk[] = [];
  private readonly pending: { cx: number; cy: number }[];
  private readonly builders = { heroSolid: new MeshBuilder(), heroSheer: new MeshBuilder(), actorSolid: new MeshBuilder(), actorSheer: new MeshBuilder() };
  private readonly dynamic: Record<keyof LowpolyGame["builders"], Drawable>;
  private shownYaw: number;
  view: LowpolyView;

  constructor(
    gl: WebGL2RenderingContext,
    private readonly options: SceneOptions,
  ) {
    this.hero = new HeroDriver({ ...dryGround(START), turn: 0 }, options.radius);
    this.clock = new WorldClock(options.pinnedHours, options.dayMs);
    this.renderer = new LowpolyRenderer(gl);
    this.dynamic = {
      heroSolid: this.renderer.createDrawable(),
      heroSheer: this.renderer.createDrawable(),
      actorSolid: this.renderer.createDrawable(),
      actorSheer: this.renderer.createDrawable(),
    };
    this.shownYaw = this.hero.player.facing;
    this.view = lowpolyView(16 / 9, options.skyFraction, this.heroHeight);
    this.pending = nearestFirst(START);
  }

  /** The window changed shape: re-cut the logical view to it. */
  resize(aspect: number): void {
    this.view = lowpolyView(aspect, this.options.skyFraction, this.heroHeight);
  }

  /** Whether every chunk of the planet has its geometry - the first frame waits on it. */
  ready(): boolean {
    return this.pending.length === 0;
  }

  /** Build chunks, nearest the hero first, for up to `budgetMs`. */
  build(budgetMs = BUILD_BUDGET_MS): void {
    const start = performance.now();
    while (this.pending.length > 0 && performance.now() - start < budgetMs) {
      const next = this.pending.shift()!;
      const mesh = buildChunk(next.cx, next.cy);
      this.chunks.push({ mesh, solid: this.renderer.createDrawable(mesh.solid), sheer: this.renderer.createDrawable(mesh.sheer) });
    }
  }

  /** Step the world by a real frame's delta, ms. */
  step(deltaMs: number): void {
    const worldDelta = this.clock.tick(deltaMs);
    this.hero.step(worldDelta);
    this.encounter.step(this.hero, worldDelta, this.clock.elapsedMs, this.clock.sink);
    this.shownYaw = easeYaw(this.shownYaw, this.hero.player.facing, worldDelta);
  }

  /** Draw the frame into a drawing buffer of `width` × `height` device pixels. */
  draw(width: number, height: number): void {
    const where = this.hero.whereabouts();
    const live = where.at;
    this.buildActors(live);
    const atmosphere = this.clock.atmosphere(0);
    const renderer = this.renderer;
    renderer.begin(width, height, { view: this.view, atmosphere, shake: this.clock.shake() });
    const turn = where.turn;
    const local = { offset: [0, 0] as const, turn: 0 };
    const planet = { offset: [0, 0] as const, turn };
    renderer.solid();
    for (const chunk of this.chunks) {
      renderer.draw(chunk.solid, { offset: asPair(chunkOffset(chunk.mesh, live)), turn });
    }
    renderer.draw(this.dynamic.actorSolid, planet);
    renderer.draw(this.dynamic.heroSolid, local);
    renderer.sheer();
    for (const chunk of this.chunks) {
      renderer.draw(chunk.sheer, { offset: asPair(chunkOffset(chunk.mesh, live)), turn });
    }
    renderer.draw(this.dynamic.actorSheer, planet);
    renderer.draw(this.dynamic.heroSheer, local);
  }

  private buildActors(live: PlanetPoint): void {
    const b = this.builders;
    for (const builder of Object.values(b)) {
      builder.reset();
    }
    const player = this.hero.player;
    heroMesh(b.heroSolid, layeredPose(tracksOf(player, this.clock.elapsedMs)), {
      yaw: this.shownYaw,
      enchanted: player.enchanted,
      sunk: wadeDepth(live) * WADE_SINK,
    });
    shadowUnder(b.heroSheer, [0, 0, 0], 0.32);
    for (const slime of this.encounter.slimes.slimes) {
      slimeMesh(b.actorSolid, b.actorSheer, slime, live);
    }
    for (const ball of this.encounter.fireballs) {
      fireballMesh(b.actorSheer, ball, live);
    }
    for (const burst of this.encounter.bursts) {
      burstMesh(b.actorSheer, burst, live);
    }
    for (const key of Object.keys(b) as (keyof typeof b)[]) {
      this.renderer.update(this.dynamic[key], b[key].bytesView());
    }
  }
}

function asPair(point: PlanetPoint): readonly [number, number] {
  return [point.x, point.y];
}

/** Every chunk of the planet, the one under `point` first and the far side last. */
export function nearestFirst(point: PlanetPoint): { cx: number; cy: number }[] {
  const all: { cx: number; cy: number; d: number }[] = [];
  for (let cy = 0; cy < CHUNKS_PER_SIDE; cy += 1) {
    for (let cx = 0; cx < CHUNKS_PER_SIDE; cx += 1) {
      const offset = chunkOffset({ origin: { x: cx * CHUNK_TILES, y: cy * CHUNK_TILES } }, point);
      all.push({ cx, cy, d: Math.hypot(offset.x + CHUNK_TILES / 2, offset.y + CHUNK_TILES / 2) });
    }
  }
  return all.sort((a, b) => a.d - b.d).map(({ cx, cy }) => ({ cx, cy }));
}
