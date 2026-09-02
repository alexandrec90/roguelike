import Phaser from "phaser";

import { hexToInt } from "./color";
import { drawCloud } from "./draw-cloud";
import { cellFoot, composeGround, faceCells, rockCells, rowAtFoot } from "./field";
import {
  DEFAULT_SKY_FRACTION,
  horizonLayout,
  ridgeProfile,
  rollBands,
  rollColors,
  skyBands,
  starField,
  type HorizonLayout,
} from "./horizon";
import { cloudBounds, INK_COLORS, type PixelCloud } from "./ink";
import { CAST, HERO_EQUIPPED, IDLE, SWING, WALK } from "./models";
import { quantizedWave } from "./pixel-art";
import {
  cellOrigin,
  columnsAcross,
  rowsDown,
  TILE_WIDTH,
  wallCapY,
  wallFaceY,
} from "./projection";
import { renderModel, samplePose, type Clip, type Facing } from "./rig";
import { createEmitter, particleAlpha, stepEmitter, type EmitterState } from "./spark-emitter";
import { FAR_PINE_FRAMES, FAR_TOWER, RAIN_STREAK, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { installPixelTexture } from "./textures";
import { WALL_FACE, WALL_TOP } from "./tiles";
import { freezeCloud, meltCloud } from "./transforms";
import { VegetationLayer } from "./vegetation-layer";
import { centerFoot, walkableBand, type Anchor } from "./viewport";
import { WaterLayer } from "./water-layer";
import { createRain, lightningAt, lightningBolt } from "./weather";

const WIDTH = 320;
const HEIGHT = 180;

/** Depths are `row * TILE_WIDTH + rank`; the ground sits below every row. */
const GROUND_DEPTH = -1000;
const BAND_DEPTH = -2000;
const RANK_CAP = 0;
const RANK_FACE = 1;
const RANK_ACTOR = 8;
/** Weather draws over the world: rain in front, then the bolt and its flash. */
const RAIN_DEPTH = 5000;
const BOLT_DEPTH = 6000;

/** Cells the sample scene puts things on. Row 0 is at the horizon. */
const SLIME_CELL = { column: 16, row: 9 } as const;
const TORCH_CELL = { column: 13, row: 10 } as const;

/**
 * The hero is placed by the window rather than by the map, so what decides
 * where he stands is how tall he is — measured once, from the base pose.
 *
 * A clip or a transform changes the silhouette frame by frame, and anchoring
 * to *that* would make him drift up the screen as he swung. The base pose is
 * the one that holds still.
 */
const HERO_BOUNDS = cloudBounds(renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose));

/** Landmarks in the rolled-over band, as screen x of their left edge. */
const DISTANT_PINES = [52, 68, 244, 276];
const DISTANT_TOWER_X = 210;

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55, color: "#0d1830" } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26, color: "#08101e" } as const;

const STORM_SEED = 0x51a7;
const FREEZE_SEED = 0xf20e;
const MELT_SEED = 0xa11ce;

/**
 * What the hero demonstrates, in order: clips in three facings, then the
 * freeze and melt transforms — the whole new art pipeline in one loop.
 */
type ShowPhase =
  | { readonly kind: "clip"; readonly clip: Clip; readonly ms: number; readonly facing: Facing; readonly flipX?: boolean }
  | { readonly kind: "freeze"; readonly ms: number }
  | { readonly kind: "melt"; readonly ms: number; readonly direction: 1 | -1 };

const SHOWCASE: readonly ShowPhase[] = [
  { kind: "clip", clip: IDLE, ms: 2800, facing: "front" },
  { kind: "clip", clip: WALK, ms: 1920, facing: "back" },
  { kind: "clip", clip: WALK, ms: 1920, facing: "front", flipX: true },
  { kind: "clip", clip: SWING, ms: 700, facing: "front" },
  { kind: "clip", clip: CAST, ms: 900, facing: "front" },
  { kind: "freeze", ms: 1600 },
  { kind: "melt", ms: 1400, direction: 1 },
  { kind: "melt", ms: 1400, direction: -1 },
];
const SHOWCASE_TOTAL = SHOWCASE.reduce((total, phase) => total + phase.ms, 0);

function installSceneTextures(scene: Phaser.Scene, columns: number, rows: number): void {
  SLIME_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `slime-${index}`, frame),
  );
  TORCH_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `torch-${index}`, frame),
  );
  installPixelTexture(scene.textures, "spark", SPARK);
  installPixelTexture(scene.textures, "rain", RAIN_STREAK);
  installPixelTexture(scene.textures, "wall-top", WALL_TOP);
  installPixelTexture(scene.textures, "wall-face", WALL_FACE);
  FAR_PINE_FRAMES.forEach((frame, index) =>
    installPixelTexture(scene.textures, `far-pine-${index}`, frame),
  );
  installPixelTexture(scene.textures, "far-tower", FAR_TOWER);
  installPixelTexture(scene.textures, "ground", composeGround(columns, rows));
}

function drawSky(scene: Phaser.Scene, layout: HorizonLayout): void {
  const sky = scene.add.graphics().setDepth(BAND_DEPTH);
  for (const band of skyBands(layout.skyHeight)) {
    sky.fillStyle(hexToInt(band.color)).fillRect(0, band.y, WIDTH, band.height);
  }
  for (const star of starField(WIDTH, layout.skyHeight)) {
    sky.fillStyle(hexToInt(star.bright ? "#f2f7ff" : "#5e7ea6")).fillRect(star.x, star.y, 1, 1);
  }
}

function drawDistantObjects(
  scene: Phaser.Scene,
  layout: HorizonLayout,
): Phaser.GameObjects.Image[] {
  const { horizonY } = layout;
  const ridges = scene.add.graphics().setDepth(BAND_DEPTH + 1);
  for (const ridge of [RIDGE_FAR, RIDGE_NEAR]) {
    const profile = ridgeProfile(WIDTH, { ...ridge, maxHeight: horizonY });
    ridges.fillStyle(hexToInt(ridge.color));
    profile.forEach((height, x) => {
      if (height > 0) {
        ridges.fillRect(x, horizonY - height, 1, height);
      }
    });
  }
  const pines = DISTANT_PINES.map((x) =>
    scene.add.image(x, horizonY, "far-pine-0").setOrigin(0.5, 1).setDepth(BAND_DEPTH + 2),
  );
  scene.add.image(DISTANT_TOWER_X, horizonY, "far-tower").setOrigin(0, 1).setDepth(BAND_DEPTH + 2);
  return pines;
}

function drawWorld(
  scene: Phaser.Scene,
  layout: HorizonLayout,
  columns: number,
  rows: number,
): Phaser.GameObjects.Image[] {
  drawSky(scene, layout);
  const pines = drawDistantObjects(scene, layout);
  const roll = scene.add.graphics().setDepth(BAND_DEPTH + 3);
  for (const band of rollColors(rollBands(layout.rollHeight))) {
    roll.fillStyle(hexToInt(band.color)).fillRect(0, layout.horizonY + band.y, WIDTH, band.height);
  }
  scene.add.image(0, layout.groundTop, "ground").setOrigin(0, 0).setDepth(GROUND_DEPTH);
  for (const cell of rockCells(columns, rows)) {
    const origin = cellOrigin(cell.column, cell.row, layout.groundTop);
    scene.add
      .image(origin.x, wallCapY(origin.y), "wall-top")
      .setOrigin(0, 0)
      .setDepth(cell.row * TILE_WIDTH + RANK_CAP);
  }
  for (const cell of faceCells(columns, rows)) {
    const origin = cellOrigin(cell.column, cell.row, layout.groundTop);
    scene.add
      .image(origin.x, wallFaceY(origin.y), "wall-face")
      .setOrigin(0, 0)
      .setDepth(cell.row * TILE_WIDTH + RANK_FACE);
  }
  return pines;
}

/**
 * The sample outdoor scene, in the 1-bit direction: a pitch-black field with
 * neon marks on it. The hero is not a sprite — it is the humanoid rig from
 * `models.ts`, rendered to a pixel cloud every frame and cycled through its
 * clips, its transforms, and its reflection in a puddle.
 *
 * Nothing here decides the projection or the horizon split — it reads both
 * and draws.
 */
export class DemoScene extends Phaser.Scene {
  private readonly skyFraction: number;
  private layout!: HorizonLayout;
  private columns = 0;
  private rows = 0;

  private heroGfx!: Phaser.GameObjects.Graphics;
  private boltGfx!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Rectangle;
  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private rainImages: Phaser.GameObjects.Image[] = [];
  private emitter!: EmitterState;
  private rain!: EmitterState;
  private distantPines: Phaser.GameObjects.Image[] = [];
  private readonly vegetation = new VegetationLayer();
  private readonly water = new WaterLayer();
  private elapsedMs = 0;
  /** Scanlines of the render target the window is showing; the rest is clipped. */
  private visible = HEIGHT;
  private heroAnchor: Anchor = { x: WIDTH / 2, y: HEIGHT };
  private built = false;

  constructor(skyFraction: number = DEFAULT_SKY_FRACTION) {
    super("overworld-field");
    this.skyFraction = skyFraction;
  }

  create(): void {
    this.layout = horizonLayout(HEIGHT, this.skyFraction);
    this.columns = columnsAcross(WIDTH);
    this.rows = rowsDown(this.layout.groundHeight);
    this.placeHero();

    installSceneTextures(this, this.columns, this.rows);
    this.distantPines = drawWorld(this, this.layout, this.columns, this.rows);
    this.vegetation.create(this, this.layout.groundTop, this.columns, this.rows);
    this.water.create(this, this.layout.groundTop, this.heroAnchor);
    this.createHero();
    this.createSlime();
    this.createTorch();
    this.createWeather();
    this.built = true;
  }

  /**
   * How much playfield the window is still showing, so the hero can be put in
   * the middle of it.
   *
   * The shell calls this on every resize, and once before the scene has built
   * anything — so it stores the number either way and only redraws when there
   * is something to redraw.
   */
  setVisibleHeight(height: number): void {
    const clamped = Math.min(Math.max(Math.floor(height), 1), HEIGHT);
    if (clamped === this.visible) {
      return;
    }
    this.visible = clamped;
    if (!this.built) {
      return;
    }
    this.placeHero();
    this.heroGfx.setDepth(this.heroDepth());
    this.water.relocateHero(this.heroAnchor);
  }

  update(_time: number, delta: number): void {
    this.elapsedMs += Math.min(delta, 40);
    this.vegetation.animate(this.elapsedMs);
    this.animateDistantPines();
    const heroCloud = this.heroCloud();
    this.animateHero(heroCloud);
    this.animateSlime();
    this.animateTorch();
    this.updateSparks(delta);
    // Before the water, so a drop that lands this frame rings this frame.
    this.updateRain(delta);
    this.water.animate(
      delta,
      this.elapsedMs,
      { cloud: heroCloud, foot: this.heroAnchor },
      cellFoot(TORCH_CELL.column, TORCH_CELL.row, this.layout.groundTop),
    );
    this.updateLightning();
  }

  private createHero(): void {
    this.heroGfx = this.add.graphics().setDepth(this.heroDepth());
  }

  /** Centred across the target, and halfway down whatever playfield is left. */
  private placeHero(): void {
    this.heroAnchor = centerFoot(
      HERO_BOUNDS,
      walkableBand(this.layout.groundTop, this.visible),
      WIDTH / 2,
    );
  }

  private heroDepth(): number {
    return rowAtFoot(this.heroAnchor.y, this.layout.groundTop) * TILE_WIDTH + RANK_ACTOR;
  }

  private createSlime(): void {
    const foot = cellFoot(SLIME_CELL.column, SLIME_CELL.row, this.layout.groundTop);
    this.slime = this.add
      .image(foot.x, foot.y, "slime-0")
      .setOrigin(0.5, 1)
      .setDepth(SLIME_CELL.row * TILE_WIDTH + RANK_ACTOR);
  }

  private createTorch(): void {
    const foot = cellFoot(TORCH_CELL.column, TORCH_CELL.row, this.layout.groundTop);
    const depth = TORCH_CELL.row * TILE_WIDTH + RANK_ACTOR;
    const flameY = foot.y - 9;

    this.torchGlow = this.add.graphics().setDepth(depth - 2);
    this.torchGlow.fillStyle(0xe66d2e, 0.025).fillCircle(foot.x, flameY, 60);
    this.torchGlow.fillStyle(0xf08d3d, 0.045).fillCircle(foot.x, flameY, 40);
    this.torchGlow.fillStyle(0xffc05a, 0.075).fillCircle(foot.x, flameY, 22);
    this.torchGlow.setBlendMode(Phaser.BlendModes.ADD);

    this.torch = this.add.image(foot.x, foot.y, "torch-0").setOrigin(0.5, 1).setDepth(depth);

    this.emitter = createEmitter({ originX: foot.x, originY: flameY - 4 });
    this.sparkImages = this.emitter.particles.map(() =>
      this.add
        .image(-10, -10, "spark")
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth + 1),
    );
  }

  private createWeather(): void {
    this.rain = createRain(WIDTH);
    // Bottom-right origin: the streak leans, and its bright head is its
    // last pixel, so that corner is where the drop actually is. An origin of
    // 1 keeps the offset a whole number of pixels, which a centred one would
    // not on an odd-sized texture.
    this.rainImages = this.rain.particles.map(() =>
      this.add
        .image(-10, -10, "rain")
        .setOrigin(1, 1)
        .setVisible(false)
        .setDepth(RAIN_DEPTH)
        .setAlpha(0.7),
    );

    this.boltGfx = this.add.graphics().setDepth(BOLT_DEPTH);
    this.flash = this.add
      .rectangle(0, 0, WIDTH, HEIGHT, 0xdff2ff, 1)
      .setOrigin(0, 0)
      .setDepth(BOLT_DEPTH + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  /** The hero this instant: which phase of the showcase, flattened to pixels. */
  private heroCloud(): PixelCloud {
    let t = this.elapsedMs % SHOWCASE_TOTAL;
    for (const phase of SHOWCASE) {
      if (t < phase.ms) {
        return this.phaseCloud(phase, t);
      }
      t -= phase.ms;
    }
    return renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
  }

  private phaseCloud(phase: ShowPhase, t: number): PixelCloud {
    if (phase.kind === "clip") {
      const pose = samplePose(phase.clip, HERO_EQUIPPED.basePose, t);
      return renderModel(HERO_EQUIPPED, pose, { facing: phase.facing, flipX: phase.flipX });
    }

    const still = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
    if (phase.kind === "freeze") {
      // Frost climbs for the first stretch, then holds — the pose stays pinned
      // because the scene simply stops advancing the clip, not because the
      // transform knows about time.
      return freezeCloud(still, Math.min(t / 600, 1), FREEZE_SEED);
    }
    const progress = phase.direction === 1 ? t / phase.ms : 1 - t / phase.ms;
    return meltCloud(still, progress, MELT_SEED);
  }

  private animateHero(cloud: PixelCloud): void {
    this.heroGfx.clear();
    drawCloud(this.heroGfx, cloud, this.heroAnchor.x, this.heroAnchor.y);
  }

  private animateSlime(): void {
    const foot = cellFoot(SLIME_CELL.column, SLIME_CELL.row, this.layout.groundTop);
    const cycle = this.elapsedMs % 1500;
    const frame = cycle < 150 ? 1 : cycle < 360 ? 2 : cycle > 1190 && cycle < 1320 ? 3 : 0;
    this.slime.setTexture(`slime-${frame}`);

    const hop = Math.max(0, quantizedWave(this.elapsedMs, 1500, 3, -0.8));
    this.slime.y = foot.y - hop;
  }

  private animateTorch(): void {
    const flickerFrame = Math.floor(this.elapsedMs / 92) % TORCH_FRAMES.length;
    this.torch.setTexture(`torch-${flickerFrame}`);

    const flicker =
      Math.sin(this.elapsedMs * 0.019) * 0.035 + Math.sin(this.elapsedMs * 0.047) * 0.018;
    this.torchGlow.setScale(1 + flicker, 1 + flicker * 0.72);
    this.torchGlow.alpha = 0.86 + flicker * 2.1;
  }

  private animateDistantPines(): void {
    const frameMs = 600;
    this.distantPines.forEach((pine, index) => {
      const frame = Math.floor((this.elapsedMs + index * 900) / frameMs) % FAR_PINE_FRAMES.length;
      pine.setTexture(`far-pine-${frame}`);
    });
  }

  /**
   * Sparks come from the shared seeded emitter — the same one the asset lab
   * steps — so what the lab shows for `sparks` is what this scene draws.
   */
  private updateSparks(delta: number): void {
    stepEmitter(this.emitter, delta);

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
        .setPosition(Math.round(particle.x), Math.round(particle.y))
        .setAlpha(particleAlpha(particle))
        .setVisible(true);
    });
  }

  /**
   * The same pooled emitter as the sparks, pointed down and leaned over by the
   * wind. Drops that reach water land in it rather than falling through.
   */
  private updateRain(delta: number): void {
    stepEmitter(this.rain, delta);
    this.water.landRain(this.rain, delta);

    this.rain.particles.forEach((particle, index) => {
      const image = this.rainImages[index];
      if (image === undefined) {
        return;
      }
      if (!particle.active || particle.y > HEIGHT) {
        image.setVisible(false);
        return;
      }
      image
        .setPosition(Math.round(particle.x), Math.round(particle.y))
        .setAlpha(0.7 * particleAlpha(particle))
        .setVisible(true);
    });
  }

  /** Bolt and flash are pure functions of time, so a capture is repeatable. */
  private updateLightning(): void {
    const strike = lightningAt(this.elapsedMs, STORM_SEED);
    this.boltGfx.clear();
    this.flash.setVisible(strike.active);
    this.water.setStrike(strike.active ? strike.alpha : 0);
    if (!strike.active) {
      return;
    }

    const x = 20 + Math.round(strike.xUnit * (WIDTH - 40));
    const points = lightningBolt(strike.boltSeed, x, 0, this.layout.horizonY + 2);
    this.boltGfx.fillStyle(hexToInt(INK_COLORS.bone), Math.min(strike.alpha + 0.3, 1));
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from === undefined || to === undefined) {
        continue;
      }
      const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
      for (let step = 0; step <= steps; step += 1) {
        const px = Math.round(from.x + ((to.x - from.x) * step) / steps);
        const py = Math.round(from.y + ((to.y - from.y) * step) / steps);
        this.boltGfx.fillRect(px, py, 1, 1);
      }
    }
    this.flash.setAlpha(0.1 * strike.alpha);
  }
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
