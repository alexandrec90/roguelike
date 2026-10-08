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
import type { Atmosphere } from "../../game/atmosphere";
import { ACTOR_MESH_KEYS, ActorMeshes, type ActorMeshKey } from "./actor-frame";
import type { DrawableHandle, DrawCall, ImpostorScene, LowpolyBackend } from "./backend";
import { WetWorld } from "./wet-world";
import { heroCutaway } from "./cutaway";
import { heroHeightPx } from "./hero-mesh";
import { ImpostorBuilder } from "./impostor";
import type { LookOptions } from "./look-options";
import { fieldRows, lowpolyView, type LowpolyView } from "./placement";
import { plumeBalls } from "./plume-balls";
import { cloudShadeOf, skyPuffs } from "./sky-puffs";
import { MAX_PUSHES, windUniform } from "./sway";
import { pushesOf } from "./sway-pushes";
import { buildChunk, chunkOffset, CHUNK_TILES, CHUNKS_PER_SIDE, groundInView, MIRROR_ROWS, type ChunkMesh, type FieldRows } from "./world-chunks";

/** Where the session opens: the pixel skin's start, so a switch lands in the same field. */
const START: PlanetPoint = { x: 128, y: 128 };

/** Milliseconds of chunk building a frame may spend while the planet is still being made. */
const BUILD_BUDGET_MS = 10;

interface LoadedChunk {
  readonly mesh: ChunkMesh;
  readonly ground: DrawableHandle;
  readonly solid: DrawableHandle;
  readonly land: DrawableHandle;
  readonly sheer: DrawableHandle;
  readonly balls: DrawableHandle;
}

const DEFAULT_LOOK: LookOptions = { resolution: "full", leaves: "mesh", volume: false };

export class LowpolyGame {
  readonly hero: HeroDriver;
  readonly encounter = new EncounterSim();
  readonly heroHeight = heroHeightPx();
  private readonly clock: WorldClock;
  private readonly wet: WetWorld;
  private readonly chunks: LoadedChunk[] = [];
  private readonly pending: { cx: number; cy: number }[];
  private readonly actors = new ActorMeshes();
  private readonly pushes = new Float32Array(MAX_PUSHES * 4);
  private readonly dynamic: Record<ActorMeshKey, DrawableHandle>;
  /** Rebuilt every frame: the volcano smoke and the clouds, as impostor balls. */
  private readonly smoke = new ImpostorBuilder();
  private readonly clouds = new ImpostorBuilder();
  private readonly smokeDrawable: DrawableHandle;
  private readonly cloudDrawable: DrawableHandle;
  private shownYaw: number;
  view: LowpolyView;

  constructor(
    readonly renderer: LowpolyBackend,
    private readonly options: SceneOptions,
    private readonly look: LookOptions = DEFAULT_LOOK,
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
    this.smokeDrawable = this.renderer.createDrawable(undefined, "impostor");
    this.cloudDrawable = this.renderer.createDrawable(undefined, "impostor");
    this.shownYaw = this.hero.player.facing;
    this.view = lowpolyView(16 / 9, options.skyFraction, this.heroHeight);
    this.pending = nearestFirst(START);
  }

  /** The window changed shape: re-cut the logical view to it, `height` scanlines tall (`lowpolyView`). */
  resize(aspect: number, height?: number): void {
    this.view = lowpolyView(aspect, this.options.skyFraction, this.heroHeight, height);
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
      const mesh = buildChunk(next.cx, next.cy, this.look.leaves);
      this.chunks.push({
        mesh,
        ground: this.renderer.createDrawable(mesh.ground),
        solid: this.renderer.createDrawable(mesh.solid),
        land: this.renderer.createDrawable(mesh.land),
        sheer: this.renderer.createDrawable(mesh.sheer),
        balls: this.renderer.createDrawable(mesh.balls, "impostor"),
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
    this.buildActors(live);
    const weather = this.wet.weather;
    const atmosphere = this.clock.atmosphere(weather.overcast);
    const sway = {
      wind: windUniform(this.clock.elapsedMs, weather.wind),
      pushes: pushesOf(
        { player: this.hero.player, live, slimes: this.encounter.slimes.slimes, fireballs: this.encounter.fireballs, bursts: this.encounter.bursts },
        this.pushes,
      ),
    };
    const shake = this.clock.shake();
    const cut = heroCutaway(this.view, live, this.heroHeight);
    const cutaway = cut === undefined ? undefined : { ...cut, x: cut.x + shake.x, y: cut.y + shake.y };
    const cloudShade = cloudShadeOf(atmosphere);
    const frame = { view: this.view, atmosphere, shake, water: this.wet.water(live, this.clock.elapsedMs), sway, width, height, cutaway, cloudShade };
    const turn = where.turn;
    const chunkCall = (drawable: DrawableHandle, mesh: ChunkMesh): DrawCall => ({ drawable, offset: asPair(chunkOffset(mesh, live)), turn });
    const rows = fieldRows(this.view);
    const mirrorable = this.chunks.filter((chunk) => groundInView(chunkOffset(chunk.mesh, live), turn, rows, MIRROR_ROWS));
    const onField = this.chunks.filter((chunk) => groundInView(chunkOffset(chunk.mesh, live), turn, rows));
    const actors: DrawCall[] = [
      { drawable: this.dynamic.actorSolid, offset: [0, 0], turn },
      { drawable: this.dynamic.heroSolid, offset: [0, 0], turn: 0 },
    ];
    this.renderer.render(frame, {
      mirrored: [
        ...mirrorable.flatMap((chunk) => [chunkCall(chunk.land, chunk.mesh), chunkCall(chunk.solid, chunk.mesh)]),
        ...actors,
      ],
      lands: this.chunks.map((chunk) => chunkCall(chunk.land, chunk.mesh)),
      grounds: onField.map((chunk) => chunkCall(chunk.ground, chunk.mesh)),
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
      impostors: this.impostorScene(live, turn, atmosphere, rows, mirrorable, chunkCall),
      rain: {
        strength: weather.rain,
        seconds: this.clock.elapsedMs / 1000,
        slant: RAIN_SLANT * weather.wind,
        light: 0.55 + 0.45 * atmosphere.daylight,
      },
    });
  }

  /**
   * This frame's impostors: the crowns of every chunk, the plumes in sight and
   * the clouds on screen. Smoke and clouds are balls, or with `?volume=1`
   * volumes, blended far to near - so the clouds first, then the plumes.
   */
  private impostorScene(
    live: PlanetPoint,
    turn: number,
    atmosphere: Atmosphere,
    rows: FieldRows,
    mirrorable: readonly LoadedChunk[],
    chunkCall: (drawable: DrawableHandle, mesh: ChunkMesh) => DrawCall,
  ): ImpostorScene {
    this.smoke.reset();
    this.clouds.reset();
    plumeBalls(this.smoke, live, turn, this.clock.elapsedMs, this.wet.weather.wind, rows);
    skyPuffs(this.clouds, this.view, atmosphere, turn, this.clock.elapsedMs);
    this.renderer.update(this.smokeDrawable, this.smoke.bytesView());
    this.renderer.update(this.cloudDrawable, this.clouds.bytesView());
    const soft = [
      { drawable: this.cloudDrawable, offset: [0, 0], turn: 0 },
      { drawable: this.smokeDrawable, offset: [0, 0], turn },
    ] as const;
    const crowns = this.chunks.filter((chunk) => chunk.balls.count > 0);
    return {
      balls: [...crowns.map((chunk) => chunkCall(chunk.balls, chunk.mesh)), ...(this.look.volume ? [] : soft)],
      volumes: this.look.volume ? soft : [],
      mirrored: mirrorable.filter((chunk) => chunk.balls.count > 0).map((chunk) => chunkCall(chunk.balls, chunk.mesh)),
    };
  }

  private buildActors(live: PlanetPoint): void {
    this.actors.build({ player: this.hero.player, elapsedMs: this.clock.elapsedMs, yaw: this.shownYaw, live, encounter: this.encounter });
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
