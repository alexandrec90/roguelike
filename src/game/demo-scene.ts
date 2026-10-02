import Phaser from "phaser";

import { AmbientLayer } from "./ambient-layer";
import { visibleLocal, type CameraFrame, type LocalBounds } from "./camera";
import { cloudShade, cloudShadowsAt } from "./cloud-shadow";
import { Encounter } from "./encounter";
import { beginFrame, type FrameContext } from "./frame-context";
import { GroundLayer } from "./ground-layer";
import { HeroLayer, heroHeight } from "./hero-layer";
import { horizonLayout, type HorizonLayout } from "./horizon";
import { MAX_SHAKE } from "./impulse";
import { hasWebGL2 } from "./gpu/float-texture";
import { LandformGpuLayer } from "./landform-gpu-layer";
import { LandformLayer } from "./landform-layer";
import { LightingLayer } from "./lighting-layer";
import type { MapOverlay } from "./map-overlay";
import { createOdometer, trackScroll } from "./odometer";
import { Prefetcher } from "./prefetcher";
import type { PlanetPoint, PlanetPose } from "./planet";
import type { ScreenPoint } from "./projection";
import { RollGroundLayer } from "./roll-ground-layer";
import { DEFAULT_SCENE_OPTIONS, type RenderPath, type SceneOptions } from "./scene-options";
import { SceneryLayer } from "./scenery-layer";
import { SkyLayer } from "./sky-layer";
import { openGround } from "./landforms";
import { VegetationLayer } from "./vegetation-layer";
import { anchorFoot, walkableBand } from "./viewport";
import { WaterLayer } from "./water-layer";
import { WEATHER_PRESETS } from "./weather";
import { WeatherLayer } from "./weather-layer";
import { scorchAt } from "./wildfire";
import { WorldClock } from "./world-clock";

const WIDTH = 320;
const HEIGHT = 180;

/**
 * Where on the planet this session opens, and the campfire beside it.
 *
 * Planet coordinates, not screen cells: they are places, and the hero walks
 * away from them and - the point of a round world - eventually back to them.
 * `openGround` nudges each off any outcrop the seed happened to put it in.
 */
const START: PlanetPoint = { x: 128, y: 128 };
const CAMPFIRE_AT: PlanetPoint = { x: 131, y: 129 };

const STORM_SEED = 0x51a7;

/** Milliseconds of the next anchor's work a frame may do ahead, beyond the first task. */
const PREFETCH_BUDGET_MS = 1.5;

/** Longest the first frame is held for scenery, ms, and how long it then fades in. */
const REVEAL_CAP_MS = 4000;
const REVEAL_FADE_MS = 250;

/**
 * The sample outdoor scene, on a round planet.
 *
 * Nothing here decides the projection, the horizon split, what a key means,
 * what a step does to a pose, what time it is or how anything is drawn — it
 * reads all of them and hands them on. What it *does* own is the one fact every
 * layer needs and none may derive twice: the `FrameContext` for this instant,
 * built from where the window put the hero, how far through a stride he is, and
 * what the clock and the sky say.
 *
 * The hero never moves. He is nailed to the middle of the walkable band and the
 * world slides and turns beneath him, which is what "the camera turns with the
 * player" has to mean when the camera is also the tile grid.
 */
export class DemoScene extends Phaser.Scene {
  private readonly skyFraction: number;
  private layout!: HorizonLayout;
  private anchor: ScreenPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  private readonly hero: HeroLayer;
  private readonly sky = new SkyLayer();
  private readonly rollGround = new RollGroundLayer();
  private readonly ground = new GroundLayer();
  private readonly vegetation = new VegetationLayer();
  private readonly scenery = new SceneryLayer();
  private landforms!: LandformLayer | LandformGpuLayer;
  private readonly renderPath: RenderPath;
  private readonly encounter = new Encounter();
  private readonly water = new WaterLayer();
  private readonly weather: WeatherLayer;
  private readonly ambient = new AmbientLayer();
  private readonly lighting = new LightingLayer();
  private readonly clock: WorldClock;
  private readonly odometer = createOdometer();
  /** Scanlines of the render target the window is showing; the rest is clipped. */
  private visible = HEIGHT;
  private built = false;
  /** Whether the first frame has been faded in, and when holding it began. */
  private shown = false;
  private holdSince: number | undefined;
  /** The next anchor's work, done a share at a time between crossings. */
  private readonly prefetcher = new Prefetcher<PlanetPose>();
  private lastPose: PlanetPose | undefined;
  /** The `?map=1` instrument, or null on an ordinary load. */
  private map: MapOverlay | null = null;

  constructor(options: SceneOptions = DEFAULT_SCENE_OPTIONS) {
    super("overworld-field");
    this.skyFraction = options.skyFraction;
    this.renderPath = options.render;
    this.hero = new HeroLayer({ ...openGround(START), turn: 0 }, options.radius);
    this.clock = new WorldClock(options.pinnedHours, options.dayMs);
    this.weather = new WeatherLayer(
      STORM_SEED,
      options.weather === undefined ? undefined : WEATHER_PRESETS[options.weather],
    );
  }

  create(): void {
    this.layout = horizonLayout(HEIGHT, this.skyFraction);
    this.relayout();

    this.sky.create(this, this.layout, WIDTH);
    this.rollGround.create(this, this.frame(), WIDTH, this.bounds);
    this.hero.create(this, this.layout.groundTop, this.anchor);
    this.ground.create(this, this.frame(), this.bounds);
    this.vegetation.create(this, this.frame(), this.bounds);
    this.scenery.create(this, this.bounds, WIDTH);
    // The march per pixel on the GPU where WebGL2 is there, per column on the CPU otherwise.
    this.landforms = this.renderPath === "gpu" && hasWebGL2(this) ? new LandformGpuLayer() : new LandformLayer();
    this.landforms.create(this, WIDTH, HEIGHT, heroHeight());
    this.encounter.create(this, WIDTH, HEIGHT, openGround(CAMPFIRE_AT));
    // Burnt ground has no grass on it until it greens over again.
    const fire = this.encounter.wildfire.fire;
    this.vegetation.setBare((point) => scorchAt(fire, point) > 0.15);
    this.water.create(this, WIDTH, HEIGHT);
    this.weather.create(this, WIDTH, HEIGHT, this.layout.horizonY);
    this.ambient.create(this);
    this.lighting.create(this, WIDTH, HEIGHT);
    this.cameras.main.fadeOut(0);
    this.built = true;
  }

  /** Hand the scene the debug map to feed, once `main.ts` has attached one. */
  setMap(map: MapOverlay | null): void {
    this.map = map;
  }

  /**
   * How much playfield the window is still showing.
   *
   * The crop can no longer strand the hero - a round planet has no near edge to
   * be carried over - so this is now purely a framing input: it moves the anchor
   * he is pinned to, and with it how much grid there is to fill.
   */
  setVisibleHeight(height: number): void {
    const clamped = Math.min(Math.max(Math.floor(height), 1), HEIGHT);
    if (clamped === this.visible) {
      return;
    }
    this.visible = clamped;
    this.relayout();
  }

  update(time: number, delta: number): void {
    if (!this.revealed(time)) {
      return;
    }
    const worldDelta = this.clock.tick(delta);
    this.hero.animate(worldDelta, this.clock.elapsedMs);

    const where = this.hero.whereabouts();
    const frame = this.frame(where.phase);
    const pose = where.ground;
    const ctx = this.context(frame, pose);
    trackScroll(this.odometer, where.phase, pose);

    this.ground.update(ctx);
    this.rollGround.update(ctx, this.water.sizeScale());
    this.vegetation.update(ctx, this.grassPushers(ctx));
    this.scenery.update(ctx);
    this.landforms.update(ctx, ctx.shade);
    this.hero.update(ctx);
    this.encounter.update(ctx, this.hero);
    this.drawWater(ctx);
    // After everything standing has been placed: the slices are cut round it.
    this.landforms.arrange();
    this.prefetch(ctx, where.upcoming?.pose);
    this.sky.update(where.turn, ctx.atmosphere, ctx.elapsedMs);
    this.ambient.update(ctx, this.odometer);
    this.light(ctx);
    this.drawMap(frame, pose, delta);
  }

  /**
   * Whether the world is on screen yet.
   *
   * The first frames are held behind a black fade until every scenery body has
   * a picture (`SceneryLayer.ready`), then faded in — a load shows the wood
   * whole rather than filling in. `REVEAL_CAP_MS` stops a baker that never
   * answers from leaving the screen black.
   */
  private revealed(time: number): boolean {
    if (this.shown) {
      return true;
    }
    this.holdSince ??= time;
    if (!this.scenery.ready() && time - this.holdSince < REVEAL_CAP_MS) {
      return false;
    }
    this.shown = true;
    this.cameras.main.fadeIn(REVEAL_FADE_MS);
    return true;
  }

  /**
   * Do a share of the next anchor's work now (`prefetcher.ts`). Never on the
   * frame the anchor just moved: that frame has paid for this one already.
   */
  private prefetch(ctx: FrameContext, pose: PlanetPose | undefined): void {
    const crossed = ctx.pose !== this.lastPose;
    this.lastPose = ctx.pose;
    this.prefetcher.aim(pose, () =>
      pose === undefined
        ? []
        : [
            () => this.ground.prefetch(pose),
            () => this.vegetation.prefetch(pose),
            () => this.water.prefetchFor(ctx, pose),
            ...this.rollGround.prefetchTasks(ctx, pose, this.water.sizeScale()),
          ],
    );
    if (!crossed) {
      this.prefetcher.run(PREFETCH_BUDGET_MS);
    }
  }

  /** Whatever walks through the grass and bends it aside: the hero, and the slimes. */
  private grassPushers(ctx: FrameContext): { x: number; y: number; weight?: number }[] {
    const feet = this.encounter.slimes.reflectables().map((slime) => ({ x: slime.x, y: slime.y, weight: 0.7 }));
    return [{ x: ctx.frame.footX, y: ctx.frame.footY }, ...feet];
  }

  /** Rain, then the water it lands in — so a drop that lands this frame rings this frame. */
  private drawWater(ctx: FrameContext): void {
    this.weather.update(ctx, this.water);
    const campfire = this.encounter.campfire;
    this.water.update(ctx, {
      hero: { cloud: this.hero.cloudNow(), foot: this.hero.footNow() },
      reflectables: [
        ...this.encounter.slimes.reflectables().map((slime) => ({
          cloud: slime.cloud,
          foot: { x: slime.x, y: slime.y },
        })),
        ...(campfire.visible ? [{ cloud: campfire.flameCloud(), foot: campfire.foot, glow: true }] : []),
      ],
    });
  }

  /** The lighting pass, and the camera's shake — the last things a frame does. */
  private light(ctx: FrameContext): void {
    this.lighting.draw({
      ambient: ctx.atmosphere.ambient,
      lights: ctx.lights,
      flash: 0,
      night: 1 - ctx.atmosphere.daylight,
      clouds: this.clouds(ctx),
      skyRows: this.layout.horizonY,
    });
    const shake = this.clock.shake();
    this.cameras.main.setScroll(shake.x, shake.y);
  }

  /** The one description of this frame every layer reads. */
  private context(frame: CameraFrame, pose: PlanetPose): FrameContext {
    const sky = this.weather.weatherState(this.clock.elapsedMs);
    const atmosphere = this.clock.atmosphere(sky.overcast);
    return beginFrame({
      frame,
      pose,
      elapsedMs: this.clock.elapsedMs,
      deltaMs: this.clock.deltaMs,
      atmosphere,
      wind: { strength: sky.wind, gustiness: 0.6 },
      rain: sky.rain,
      // The lighting pass is offset by its shake margin; the sampler reads the same pixel.
      shade: cloudShade(cloudShadowsAt(this.odometer, this.clock.elapsedMs, atmosphere), MAX_SHAKE),
      width: WIDTH,
      height: HEIGHT,
      impulse: this.clock.sink,
    });
  }

  /** Where the cloud shadows are this frame: the one answer the pass and the sampler share. */
  private clouds(ctx: FrameContext): ReturnType<typeof cloudShadowsAt> {
    return cloudShadowsAt(this.odometer, ctx.elapsedMs, ctx.atmosphere);
  }

  /**
   * Feed the map, if one was asked for.
   *
   * It is handed the *same* frame and pose every other layer just drew from,
   * plus the live state only it may see, so what it reports is what happened
   * rather than a second simulation that could drift from this one.
   */
  private drawMap(frame: CameraFrame, pose: PlanetPose, delta: number): void {
    if (this.map === null) {
      return;
    }
    const debug = this.hero.debugState();
    this.map.draw({
      groundPose: pose,
      livePose: debug.live,
      gait: debug.gait,
      progress: debug.progress,
      phase: { x: frame.phaseX, y: frame.phaseY },
      bounds: this.bounds,
      radius: debug.radius,
      frameMs: delta,
    });
  }

  /** The one description of where the world has got to, this instant. */
  private frame(phase = this.hero.whereabouts().phase): CameraFrame {
    return {
      groundTop: this.layout.groundTop,
      rollHeight: this.layout.rollHeight,
      footX: this.anchor.x,
      footY: this.anchor.y,
      phaseX: phase.x,
      phaseY: phase.y,
    };
  }

  /** Re-pin the hero and re-cut the grid after the window changed shape. */
  private relayout(): void {
    this.anchor = anchorFoot(walkableBand(this.layout.groundTop, this.visible), WIDTH, heroHeight());
    const flat: CameraFrame = { ...this.frame(), phaseX: 0, phaseY: 0 };
    this.bounds = visibleLocal(flat, WIDTH, HEIGHT);
    if (!this.built) {
      return;
    }
    this.hero.setAnchor(this.anchor);
    this.ground.layout(flat, this.bounds);
    this.rollGround.layout(flat, this.bounds);
    this.vegetation.layout(flat, this.bounds);
    this.scenery.layout(this.bounds, WIDTH);
  }
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
