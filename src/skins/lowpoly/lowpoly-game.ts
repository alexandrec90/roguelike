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
import { easeYaw } from "../../game/hero/turn";
import { dryGround } from "../../game/lakes";
import type { SceneOptions } from "../../game/scene-options";
import { fromLocal, type PlanetPoint } from "../../game/planet";
import { WEATHER_PRESETS } from "../../game/water/schedule";
import { RAIN_SLANT } from "../../game/weather";
import { ACTOR_MESH_KEYS, ActorMeshes, type ActorMeshKey } from "./actor-frame";
import type { DrawableHandle, DrawCall, LowpolyBackend } from "./backend";
import { WetWorld } from "./wet-world";
import { heroHeightPx } from "./hero-mesh";
import { fieldRows, lowpolyView, type LowpolyView } from "./placement";
import { buildChunk, chunkOffset, CHUNK_TILES, CHUNKS_PER_SIDE, groundInView, MIRROR_ROWS, type ChunkMesh } from "./world-chunks";

/** Where the session opens: the pixel skin's start, so a switch lands in the same field. */
const START: PlanetPoint = { x: 128, y: 128 };

/** Milliseconds of chunk building a frame may spend while the planet is still being made. */
const BUILD_BUDGET_MS = 10;

interface LoadedChunk {
  readonly mesh: ChunkMesh;
  readonly ground: DrawableHandle;
  readonly solid: DrawableHandle;
  readonly sheer: DrawableHandle;
}

export class LowpolyGame {
  readonly hero: HeroDriver;
  readonly encounter = new EncounterSim();
  readonly heroHeight = heroHeightPx();
  private readonly clock: WorldClock;
  private readonly wet: WetWorld;
  private readonly chunks: LoadedChunk[] = [];
  private readonly pending: { cx: number; cy: number }[];
  private readonly actors = new ActorMeshes();
  private readonly dynamic: Record<ActorMeshKey, DrawableHandle>;
  private shownYaw: number;
  view: LowpolyView;

  constructor(
    readonly renderer: LowpolyBackend,
    private readonly options: SceneOptions,
  ) {
    this.hero = new HeroDriver({ ...dryGround(START), turn: 0 }, options.radius);
    this.clock = new WorldClock(options.pinnedHours, options.dayMs);
    this.wet = new WetWorld(options.weather === undefined ? undefined : WEATHER_PRESETS[options.weather]);
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
      this.chunks.push({
        mesh,
        ground: this.renderer.createDrawable(mesh.ground),
        solid: this.renderer.createDrawable(mesh.solid),
        sheer: this.renderer.createDrawable(mesh.sheer),
      });
    }
  }

  /** Step the world by a real frame's delta, ms. */
  step(deltaMs: number): void {
    const worldDelta = this.clock.tick(deltaMs);
    this.hero.step(worldDelta);
    const events = this.encounter.step(this.hero, worldDelta, this.clock.elapsedMs, this.clock.sink);
    const where = this.hero.whereabouts();
    const landings = events.landings.map((landing) => fromLocal(where.ground, landing.at));
    this.wet.step(this.clock.elapsedMs, worldDelta, { pose: { ...where.at, turn: where.turn }, walked: where.walked }, landings);
    this.shownYaw = easeYaw(this.shownYaw, this.hero.player.facing, worldDelta);
  }

  /** Draw the frame into a drawing buffer of `width` × `height` device pixels. */
  draw(width: number, height: number): void {
    const where = this.hero.whereabouts();
    const live = where.at;
    this.buildActors(live, where.turn);
    const weather = this.wet.weather;
    const atmosphere = this.clock.atmosphere(weather.overcast);
    const frame = { view: this.view, atmosphere, shake: this.clock.shake(), water: this.wet.water(live, this.clock.elapsedMs), width, height };
    const turn = where.turn;
    const chunkCall = (drawable: DrawableHandle, mesh: ChunkMesh): DrawCall => ({ drawable, offset: asPair(chunkOffset(mesh, live)), turn });
    const rows = fieldRows(this.view);
    const actors: DrawCall[] = [
      { drawable: this.dynamic.actorSolid, offset: [0, 0], turn },
      { drawable: this.dynamic.heroSolid, offset: [0, 0], turn: 0 },
    ];
    this.renderer.render(frame, {
      mirrored: [
        ...this.chunks
          .filter((chunk) => groundInView(chunkOffset(chunk.mesh, live), turn, rows, MIRROR_ROWS))
          .map((chunk) => chunkCall(chunk.solid, chunk.mesh)),
        ...actors,
      ],
      grounds: this.chunks
        .filter((chunk) => groundInView(chunkOffset(chunk.mesh, live), turn, rows))
        .map((chunk) => chunkCall(chunk.ground, chunk.mesh)),
      solids: [
        ...this.chunks.map((chunk) => chunkCall(chunk.solid, chunk.mesh)),
        { drawable: this.dynamic.actorSolid, offset: [0, 0], turn },
        { drawable: this.dynamic.heroSolid, offset: [0, 0], turn: 0 },
      ],
      sheers: [
        ...this.chunks.map((chunk) => chunkCall(chunk.sheer, chunk.mesh)),
        { drawable: this.dynamic.actorSheer, offset: [0, 0], turn },
        { drawable: this.dynamic.heroSheer, offset: [0, 0], turn: 0 },
      ],
      rain: {
        strength: weather.rain,
        seconds: this.clock.elapsedMs / 1000,
        slant: RAIN_SLANT * weather.wind,
        light: 0.55 + 0.45 * atmosphere.daylight,
      },
    });
  }

  private buildActors(live: PlanetPoint, turn: number): void {
    this.actors.build({ player: this.hero.player, elapsedMs: this.clock.elapsedMs, yaw: this.shownYaw, live, turn, encounter: this.encounter });
    for (const key of ACTOR_MESH_KEYS) {
      this.renderer.update(this.dynamic[key], this.actors.bytes(key));
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
