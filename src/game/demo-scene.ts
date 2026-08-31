import Phaser from "phaser";

import { hexToInt } from "./color";
import { cellFoot, composeGround, faceCells, rockCells } from "./field";
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
import { INK_COLORS, maskFromRows, type InkId, type PixelCloud } from "./ink";
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
import { FAR_PINE, FAR_TOWER, RAIN_STREAK, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { installPixelTexture } from "./textures";
import { WALL_FACE, WALL_TOP } from "./tiles";
import { freezeCloud, meltCloud, reflectCloud } from "./transforms";
import { createRain, lightningAt, lightningBolt } from "./weather";

const WIDTH = 320;
const HEIGHT = 180;

/** Depths are `row * TILE_WIDTH + rank`; the ground sits below every row. */
const GROUND_DEPTH = -1000;
const BAND_DEPTH = -2000;
const PUDDLE_DEPTH = -900;
const RANK_CAP = 0;
const RANK_FACE = 1;
const RANK_ACTOR = 8;
/** Weather draws over the world: rain in front, then the bolt and its flash. */
const RAIN_DEPTH = 5000;
const BOLT_DEPTH = 6000;

/** Cells the sample scene puts things on. Row 0 is at the horizon. */
const HERO_CELL = { column: 10, row: 11 } as const;
const SLIME_CELL = { column: 16, row: 9 } as const;
const TORCH_CELL = { column: 13, row: 10 } as const;

/** Landmarks in the rolled-over band, as screen x of their left edge. */
const DISTANT_PINES = [52, 68, 244, 276];
const DISTANT_TOWER_X = 210;

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55, color: "#0d1830" } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26, color: "#08101e" } as const;

const STORM_SEED = 0x51a7;
const FREEZE_SEED = 0xf20e;
const MELT_SEED = 0xa11ce;

/** The still water the hero stands over. Stamped as pixels, not an ellipse. */
const PUDDLE_MASK = maskFromRows([
  "......########......",
  "...##############...",
  ".##################.",
  "####################",
  ".##################.",
  "...##############...",
  "......########......",
]);
const PUDDLE_COLOR = "#08141f";

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
  private reflectionGfx!: Phaser.GameObjects.Graphics;
  private boltGfx!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Rectangle;
  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private rainImages: Phaser.GameObjects.Image[] = [];
  private emitter!: EmitterState;
  private rain!: EmitterState;
  private puddlePixels = new Set<string>();
  private elapsedMs = 0;

  constructor(skyFraction: number = DEFAULT_SKY_FRACTION) {
    super("overworld-field");
    this.skyFraction = skyFraction;
  }

  create(): void {
    this.layout = horizonLayout(HEIGHT, this.skyFraction);
    this.columns = columnsAcross(WIDTH);
    this.rows = rowsDown(this.layout.groundHeight);

    this.createTextures();
    this.drawSky();
    this.drawDistantObjects();
    this.drawRoll();
    this.drawGround();
    this.drawRocks();
    this.drawPuddle();
    this.createHero();
    this.createSlime();
    this.createTorch();
    this.createWeather();
  }

  update(_time: number, delta: number): void {
    this.elapsedMs += Math.min(delta, 40);
    this.animateHero();
    this.animateSlime();
    this.animateTorch();
    this.updateSparks(delta);
    this.updateRain(delta);
    this.updateLightning();
  }

  private createTextures(): void {
    SLIME_FRAMES.forEach((frame, index) =>
      installPixelTexture(this.textures, `slime-${index}`, frame),
    );
    TORCH_FRAMES.forEach((frame, index) =>
      installPixelTexture(this.textures, `torch-${index}`, frame),
    );
    installPixelTexture(this.textures, "spark", SPARK);
    installPixelTexture(this.textures, "rain", RAIN_STREAK);
    installPixelTexture(this.textures, "wall-top", WALL_TOP);
    installPixelTexture(this.textures, "wall-face", WALL_FACE);
    installPixelTexture(this.textures, "far-pine", FAR_PINE);
    installPixelTexture(this.textures, "far-tower", FAR_TOWER);
    installPixelTexture(this.textures, "ground", composeGround(this.columns, this.rows));
  }

  /** One filled scanline per row of the ramp, then the stars over it. */
  private drawSky(): void {
    const sky = this.add.graphics().setDepth(BAND_DEPTH);
    for (const band of skyBands(this.layout.skyHeight)) {
      sky.fillStyle(hexToInt(band.color)).fillRect(0, band.y, WIDTH, band.height);
    }
    for (const star of starField(WIDTH, this.layout.skyHeight)) {
      sky.fillStyle(hexToInt(star.bright ? "#f2f7ff" : "#5e7ea6")).fillRect(star.x, star.y, 1, 1);
    }
  }

  private drawDistantObjects(): void {
    const { horizonY } = this.layout;
    const ridges = this.add.graphics().setDepth(BAND_DEPTH + 1);

    for (const ridge of [RIDGE_FAR, RIDGE_NEAR]) {
      const profile = ridgeProfile(WIDTH, { ...ridge, maxHeight: horizonY });
      ridges.fillStyle(hexToInt(ridge.color));
      profile.forEach((height, x) => {
        if (height > 0) {
          ridges.fillRect(x, horizonY - height, 1, height);
        }
      });
    }

    // Landmarks stand *on* the horizon line. When the band is squeezed small
    // enough that they overrun the top of the screen the canvas clips them,
    // which reads as a distant thing half over the curve — the right answer.
    for (const x of DISTANT_PINES) {
      this.add.image(x, horizonY, "far-pine").setOrigin(0, 1).setDepth(BAND_DEPTH + 2);
    }
    this.add.image(DISTANT_TOWER_X, horizonY, "far-tower").setOrigin(0, 1).setDepth(BAND_DEPTH + 2);
  }

  /**
   * The ground curving away, between the horizon line and the flat playfield.
   */
  private drawRoll(): void {
    const roll = this.add.graphics().setDepth(BAND_DEPTH + 3);
    const bands = rollColors(rollBands(this.layout.rollHeight));
    for (const band of bands) {
      roll.fillStyle(hexToInt(band.color)).fillRect(0, this.layout.horizonY + band.y, WIDTH, band.height);
    }
  }

  private drawGround(): void {
    this.add.image(0, this.layout.groundTop, "ground").setOrigin(0, 0).setDepth(GROUND_DEPTH);
  }

  /**
   * Rock blocks: a cap lifted by one wall unit, and a face for the blocks that
   * have nothing standing in front of them. On a black ground the mortar
   * outlines carry the shape, so no contact shadow is drawn — there is nothing
   * darker than the field to draw it with.
   */
  private drawRocks(): void {
    const { groundTop } = this.layout;

    for (const cell of rockCells(this.columns, this.rows)) {
      const origin = cellOrigin(cell.column, cell.row, groundTop);
      this.add
        .image(origin.x, wallCapY(origin.y), "wall-top")
        .setOrigin(0, 0)
        .setDepth(cell.row * TILE_WIDTH + RANK_CAP);
    }

    for (const cell of faceCells(this.columns, this.rows)) {
      const origin = cellOrigin(cell.column, cell.row, groundTop);
      this.add
        .image(origin.x, wallFaceY(origin.y), "wall-face")
        .setOrigin(0, 0)
        .setDepth(cell.row * TILE_WIDTH + RANK_FACE);
    }
  }

  /** Still water at the hero's feet, and the lookup the reflection clips to. */
  private drawPuddle(): void {
    const foot = this.heroFoot();
    const left = foot.x - Math.floor(PUDDLE_MASK.width / 2);
    const top = foot.y - 1;

    const puddle = this.add.graphics().setDepth(PUDDLE_DEPTH);
    puddle.fillStyle(hexToInt(PUDDLE_COLOR));
    for (const pixel of PUDDLE_MASK.pixels) {
      puddle.fillRect(left + pixel.x, top + pixel.y, 1, 1);
      this.puddlePixels.add(`${left + pixel.x},${top + pixel.y}`);
    }
  }

  private createHero(): void {
    const depth = HERO_CELL.row * TILE_WIDTH + RANK_ACTOR;
    this.reflectionGfx = this.add.graphics().setDepth(PUDDLE_DEPTH + 1);
    this.heroGfx = this.add.graphics().setDepth(depth);
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
    this.rainImages = this.rain.particles.map(() =>
      this.add.image(-10, -10, "rain").setVisible(false).setDepth(RAIN_DEPTH).setAlpha(0.7),
    );

    this.boltGfx = this.add.graphics().setDepth(BOLT_DEPTH);
    this.flash = this.add
      .rectangle(0, 0, WIDTH, HEIGHT, 0xdff2ff, 1)
      .setOrigin(0, 0)
      .setDepth(BOLT_DEPTH + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  private heroFoot(): { readonly x: number; readonly y: number } {
    return cellFoot(HERO_CELL.column, HERO_CELL.row, this.layout.groundTop);
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

  private animateHero(): void {
    const foot = this.heroFoot();
    const cloud = this.heroCloud();

    this.heroGfx.clear();
    drawCloud(this.heroGfx, cloud, foot.x, foot.y);

    // The puddle sees whatever is standing over it, transforms included, with
    // a one-pixel ripple that scrolls down the reflection.
    this.reflectionGfx.clear();
    const reflection = reflectCloud(cloud);
    this.reflectionGfx.fillStyle(hexToInt(INK_COLORS.deep));
    for (const pixel of reflection) {
      const ripple = quantizedWave(this.elapsedMs + pixel.y * 90, 1700, 1);
      const x = foot.x + pixel.x + ripple;
      const y = foot.y + pixel.y;
      if (this.puddlePixels.has(`${x},${y}`)) {
        this.reflectionGfx.fillRect(x, y, 1, 1);
      }
    }
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

  /** The same pooled emitter as the sparks, pointed down instead of up. */
  private updateRain(delta: number): void {
    stepEmitter(this.rain, delta);

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

/** Group by ink so a 100-pixel model costs a handful of fill-style switches. */
function drawCloud(
  gfx: Phaser.GameObjects.Graphics,
  cloud: PixelCloud,
  originX: number,
  originY: number,
): void {
  const byInk = new Map<InkId, { x: number; y: number }[]>();
  for (const pixel of cloud) {
    const bucket = byInk.get(pixel.ink);
    if (bucket === undefined) {
      byInk.set(pixel.ink, [{ x: pixel.x, y: pixel.y }]);
    } else {
      bucket.push({ x: pixel.x, y: pixel.y });
    }
  }
  for (const [ink, pixels] of byInk) {
    gfx.fillStyle(hexToInt(INK_COLORS[ink]));
    for (const pixel of pixels) {
      gfx.fillRect(originX + pixel.x, originY + pixel.y, 1, 1);
    }
  }
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
