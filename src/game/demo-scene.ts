import Phaser from "phaser";

import { localFoot, localReach, localRow, visibleLocal, type CameraFrame, type LocalBounds } from "./camera";
import { GroundLayer } from "./ground-layer";
import { HeroLayer, heroHeight } from "./hero-layer";
import { DEFAULT_SKY_FRACTION, horizonLayout, type HorizonLayout } from "./horizon";
import type { MapOverlay } from "./map-overlay";
import { quantizedWave } from "./pixel-art";
import {
  DEFAULT_STRAFE_RADIUS,
  toLocal,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";
import { TILE_WIDTH, type ScreenPoint } from "./projection";
import { createEmitter, particleAlpha, stepEmitter, type EmitterState } from "./spark-emitter";
import { SkyLayer } from "./sky-layer";
import { FAR_PINE_FRAMES, FAR_TOWER, RAIN_STREAK, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { openGround } from "./terrain";
import { installPixelTexture } from "./textures";
import { SceneryLayer } from "./scenery-layer";
import { VegetationLayer } from "./vegetation-layer";
import { anchorFoot, walkableBand } from "./viewport";
import { WaterLayer } from "./water-layer";
import { WeatherLayer } from "./weather-layer";

const WIDTH = 320;
const HEIGHT = 180;

const RANK_ACTOR = 8;
/**
 * Where on the planet this session opens, and the two landmarks beside it.
 *
 * Planet coordinates, not screen cells: they are places, and the hero walks
 * away from them and - the point of a round world - eventually back to them.
 * `openGround` nudges each off any outcrop the seed happened to put it in.
 */
const START: PlanetPoint = { x: 128, y: 128 };
const SLIME_AT: PlanetPoint = { x: 134, y: 131 };
const TORCH_AT: PlanetPoint = { x: 131, y: 129 };

const STORM_SEED = 0x51a7;

function installSceneTextures(scene: Phaser.Scene): void {
  SLIME_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `slime-${index}`, frame),
  );
  TORCH_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `torch-${index}`, frame),
  );
  installPixelTexture(scene.textures, "spark", SPARK);
  installPixelTexture(scene.textures, "rain", RAIN_STREAK);
  FAR_PINE_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `far-pine-${index}`, frame),
  );
  installPixelTexture(scene.textures, "far-tower", FAR_TOWER);
}

/**
 * The sample outdoor scene, on a round planet.
 *
 * Nothing here decides the projection, the horizon split, what a key means, or
 * what a step does to a pose - it reads all four and draws. What it *does* own
 * is the one fact every layer needs and none of them may derive twice: the
 * `CameraFrame` for this instant, built from where the window put the hero and
 * how far through a stride he is.
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

  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private torchFoot: ScreenPoint = { x: -99, y: -99 };
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private emitter!: EmitterState;

  private readonly hero: HeroLayer;
  private readonly sky = new SkyLayer();
  private readonly ground = new GroundLayer();
  private readonly vegetation = new VegetationLayer();
  private readonly scenery = new SceneryLayer();
  private readonly water = new WaterLayer();
  private readonly weather = new WeatherLayer(STORM_SEED);
  private elapsedMs = 0;
  /** Scanlines of the render target the window is showing; the rest is clipped. */
  private visible = HEIGHT;
  private built = false;
  /** The `?map=1` instrument, or null on an ordinary load. */
  private map: MapOverlay | null = null;

  constructor(skyFraction: number = DEFAULT_SKY_FRACTION, radius: number = DEFAULT_STRAFE_RADIUS) {
    super("overworld-field");
    this.skyFraction = skyFraction;
    this.hero = new HeroLayer({ ...openGround(START), turn: 0 }, radius);
  }

  create(): void {
    this.layout = horizonLayout(HEIGHT, this.skyFraction);
    this.relayout();

    installSceneTextures(this);
    this.sky.create(this, this.layout, WIDTH);
    this.hero.create(this, this.layout.groundTop, this.anchor);
    this.ground.create(this, this.frame(), this.bounds);
    this.vegetation.create(this, this.frame(), this.bounds);
    this.scenery.create(this, this.bounds);
    this.water.create(this);
    this.createProps();
    this.weather.create(this, WIDTH, HEIGHT, this.layout.horizonY);
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

  update(_time: number, delta: number): void {
    this.elapsedMs += Math.min(delta, 40);
    this.hero.animate(delta, this.elapsedMs);

    const frame = this.frame();
    const pose = this.hero.groundPose();
    this.ground.draw(frame, pose);
    this.vegetation.animate(frame, pose, this.elapsedMs);
    this.scenery.animate(frame, pose, delta, this.elapsedMs);
    this.water.relocate(frame, pose, localReach(this.bounds));
    this.drawProps(frame, pose);

    this.updateSparks(delta);
    // Before the water, so a drop that lands this frame rings this frame.
    this.weather.animate(delta, this.elapsedMs, HEIGHT, frame, this.water);
    this.water.animate(
      delta,
      this.elapsedMs,
      { cloud: this.hero.cloudNow(), foot: this.hero.footNow() },
      this.torchFoot,
      frame,
    );
    this.sky.animate(this.hero.turn(), this.elapsedMs);
    this.drawMap(frame, pose, delta);
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
  private frame(): CameraFrame {
    const phase = this.hero.phase();
    return {
      groundTop: this.layout.groundTop,
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
    this.vegetation.layout(flat, this.bounds);
    this.scenery.layout(this.bounds);
  }

  private createProps(): void {
    this.slime = this.add.image(-99, -99, "slime-0").setOrigin(0.5, 1);
    this.torch = this.add.image(-99, -99, "torch-0").setOrigin(0.5, 1);

    // Stamped around its own origin and then moved, because the torch scrolls
    // now: a glow drawn at absolute coordinates would stay where it was lit.
    this.torchGlow = this.add.graphics();
    this.torchGlow.fillStyle(0xe66d2e, 0.025).fillCircle(0, 0, 60);
    this.torchGlow.fillStyle(0xf08d3d, 0.045).fillCircle(0, 0, 40);
    this.torchGlow.fillStyle(0xffc05a, 0.075).fillCircle(0, 0, 22);
    this.torchGlow.setBlendMode(Phaser.BlendModes.ADD);

    // The emitter runs around its own origin and is drawn wherever the flame
    // currently is, so a pooled, seeded plume travels without being re-seeded.
    this.emitter = createEmitter({ originX: 0, originY: 0 });
    this.sparkImages = this.emitter.particles.map(() =>
      this.add.image(-99, -99, "spark").setVisible(false).setBlendMode(Phaser.BlendModes.ADD),
    );
  }

  /**
   * The two landmarks, wherever the world has carried them to.
   *
   * Both are planet points read through the same frame the ground is, so they
   * scroll and swing with the tile they are standing on rather than beside it.
   */
  private drawProps(frame: CameraFrame, pose: PlanetPose): void {
    const slimeAt = toLocal(pose, openGround(SLIME_AT));
    const slimeFoot = localFoot(frame, slimeAt);
    const hop = Math.max(0, quantizedWave(this.elapsedMs, 1500, 3, -0.8));
    const cycle = this.elapsedMs % 1500;
    const slimeFrame = cycle < 150 ? 1 : cycle < 360 ? 2 : cycle > 1190 && cycle < 1320 ? 3 : 0;
    this.slime
      .setTexture(`slime-${slimeFrame}`)
      .setPosition(slimeFoot.x, slimeFoot.y - hop)
      .setDepth(Math.round(localRow(frame, slimeAt)) * TILE_WIDTH + RANK_ACTOR)
      .setVisible(this.onScreen(slimeFoot));

    const torchAt = toLocal(pose, openGround(TORCH_AT));
    this.torchFoot = localFoot(frame, torchAt);
    const depth = Math.round(localRow(frame, torchAt)) * TILE_WIDTH + RANK_ACTOR;
    const visible = this.onScreen(this.torchFoot);
    const flicker =
      Math.sin(this.elapsedMs * 0.019) * 0.035 + Math.sin(this.elapsedMs * 0.047) * 0.018;

    this.torch
      .setTexture(`torch-${Math.floor(this.elapsedMs / 92) % TORCH_FRAMES.length}`)
      .setPosition(this.torchFoot.x, this.torchFoot.y)
      .setDepth(depth)
      .setVisible(visible);
    this.torchGlow
      .setPosition(this.torchFoot.x, this.torchFoot.y - 9)
      .setDepth(depth - 2)
      .setScale(1 + flicker, 1 + flicker * 0.72)
      .setVisible(visible);
    this.torchGlow.alpha = 0.86 + flicker * 2.1;
  }

  private onScreen(point: ScreenPoint): boolean {
    return point.x > -32 && point.x < WIDTH + 32 && point.y > -32 && point.y < HEIGHT + 32;
  }

  /**
   * Sparks come from the shared seeded emitter - the same one the asset lab
   * steps - so what the lab shows for `sparks` is what this scene draws. Its
   * particles are in flame-relative coordinates; the flame's screen position is
   * added on the way out.
   */
  private updateSparks(delta: number): void {
    stepEmitter(this.emitter, delta);
    const originY = this.torchFoot.y - 13;

    this.emitter.particles.forEach((particle, index) => {
      const image = this.sparkImages[index];
      if (image === undefined) {
        return;
      }
      if (!particle.active) {
        image.setVisible(false);
        return;
      }
      image
        .setPosition(Math.round(this.torchFoot.x + particle.x), Math.round(originY + particle.y))
        .setDepth(Math.round(localRow(this.frame(), { x: 0, y: 0 })) * TILE_WIDTH + RANK_ACTOR + 1)
        .setAlpha(particleAlpha(particle))
        .setVisible(true);
    });
  }
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
