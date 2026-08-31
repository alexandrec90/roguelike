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
  type HorizonLayout,
} from "./horizon";
import { quantizedWave } from "./pixel-art";
import {
  cellOrigin,
  columnsAcross,
  rowsDown,
  TILE_DEPTH,
  TILE_WIDTH,
  wallCapY,
  wallFaceY,
} from "./projection";
import { createEmitter, particleAlpha, stepEmitter, type EmitterState } from "./spark-emitter";
import { FAR_PINE, FAR_TOWER, HERO, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { installPixelTexture } from "./textures";
import { WALL_FACE, WALL_TOP } from "./tiles";

const WIDTH = 320;
const HEIGHT = 180;

/** Depths are `row * TILE_WIDTH + rank`; the ground sits below every row. */
const GROUND_DEPTH = -1000;
const BAND_DEPTH = -2000;
const RANK_CAP = 0;
const RANK_FACE = 1;
const RANK_SHADOW = 2;
const RANK_ACTOR = 8;

/** Cells the sample scene puts things on. Row 0 is at the horizon. */
const HERO_CELL = { column: 10, row: 11 } as const;
const SLIME_CELL = { column: 16, row: 9 } as const;
const TORCH_CELL = { column: 13, row: 10 } as const;

/** Landmarks in the rolled-over band, as screen x of their left edge. */
const DISTANT_PINES = [52, 68, 244, 276];
const DISTANT_TOWER_X = 210;

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55, color: "#41505f" } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26, color: "#2b3846" } as const;

/**
 * The sample outdoor scene.
 *
 * Nothing here decides the projection or the horizon split — it reads both and
 * draws. That is the separation the visual contract asks for: retuning the
 * split in `horizon.ts` (or in the URL) must not need a scene edit, and it
 * does not.
 */
export class DemoScene extends Phaser.Scene {
  private readonly skyFraction: number;
  private layout!: HorizonLayout;
  private columns = 0;
  private rows = 0;

  private hero!: Phaser.GameObjects.Image;
  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private heroShadow!: Phaser.GameObjects.Ellipse;
  private slimeShadow!: Phaser.GameObjects.Ellipse;
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private emitter!: EmitterState;
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
    this.createActors();
    this.createTorch();
    this.createCaption();
  }

  update(_time: number, delta: number): void {
    this.elapsedMs += Math.min(delta, 40);
    this.animateHero();
    this.animateSlime();
    this.animateTorch();
    this.updateSparks(delta);
  }

  private createTextures(): void {
    installPixelTexture(this.textures, "hero", HERO);
    SLIME_FRAMES.forEach((frame, index) =>
      installPixelTexture(this.textures, `slime-${index}`, frame),
    );
    TORCH_FRAMES.forEach((frame, index) =>
      installPixelTexture(this.textures, `torch-${index}`, frame),
    );
    installPixelTexture(this.textures, "spark", SPARK);
    installPixelTexture(this.textures, "wall-top", WALL_TOP);
    installPixelTexture(this.textures, "wall-face", WALL_FACE);
    installPixelTexture(this.textures, "far-pine", FAR_PINE);
    installPixelTexture(this.textures, "far-tower", FAR_TOWER);
    installPixelTexture(this.textures, "ground", composeGround(this.columns, this.rows));
  }

  /** One filled scanline per row of the ramp: exact, and it never bands twice. */
  private drawSky(): void {
    const sky = this.add.graphics().setDepth(BAND_DEPTH);
    for (const band of skyBands(this.layout.skyHeight)) {
      sky.fillStyle(hexToInt(band.color)).fillRect(0, band.y, WIDTH, band.height);
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
   *
   * A dozen world rows land on `rollHeight` scanlines, so most of them draw
   * nothing at all; what survives is a short gradient from the field's colour
   * into the haze at the horizon.
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
   * have nothing standing in front of them.
   *
   * Depth is the world row, so a near block covers a far one and an actor
   * between two of them lands between them.
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

      // The face tile deliberately carries no contact band of its own, because
      // it stacks; the shadow at the wall's foot is drawn once, here. One
      // Graphics per cell, because depth is per object and these belong to
      // different world rows.
      this.add
        .graphics()
        .fillStyle(0x000000, 0.3)
        .fillRect(origin.x, origin.y + TILE_DEPTH, TILE_WIDTH, 2)
        .setDepth(cell.row * TILE_WIDTH + RANK_SHADOW);
    }
  }

  private createActors(): void {
    const heroFoot = cellFoot(HERO_CELL.column, HERO_CELL.row, this.layout.groundTop);
    const heroDepth = HERO_CELL.row * TILE_WIDTH + RANK_ACTOR;
    this.heroShadow = this.add
      .ellipse(heroFoot.x, heroFoot.y, 20, 5, 0x050608, 0.5)
      .setDepth(heroDepth - 1);
    this.hero = this.add
      .image(heroFoot.x, heroFoot.y, "hero")
      .setOrigin(0.5, 1)
      .setDepth(heroDepth);

    const slimeFoot = cellFoot(SLIME_CELL.column, SLIME_CELL.row, this.layout.groundTop);
    const slimeDepth = SLIME_CELL.row * TILE_WIDTH + RANK_ACTOR;
    this.slimeShadow = this.add
      .ellipse(slimeFoot.x, slimeFoot.y, 24, 5, 0x050608, 0.46)
      .setDepth(slimeDepth - 1);
    this.slime = this.add
      .image(slimeFoot.x, slimeFoot.y, "slime-0")
      .setOrigin(0.5, 1)
      .setDepth(slimeDepth);
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

    this.add
      .ellipse(foot.x, foot.y, 12, 4, 0x050608, 0.42)
      .setDepth(depth - 1);
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

  /**
   * The split, on screen.
   *
   * The 95/5 is meant to be retuned by eye, and eyeballing it is much easier
   * when the number you are judging is in the frame next to the result.
   */
  private createCaption(): void {
    const { skyFraction, skyHeight, rollHeight, groundHeight } = this.layout;
    const percent = (skyFraction * 100).toFixed(skyFraction * 100 < 10 ? 1 : 0);
    // On its own the caption sat at whatever colour the grass happened to be
    // under it, which is unreadable over half the field; it is a chip so the
    // numbers stay legible wherever the scene puts them.
    this.add
      .text(
        3,
        HEIGHT - 12,
        `horizon ${percent}%  sky ${skyHeight}px  roll ${rollHeight}px  flat ${groundHeight}px`,
        {
          color: "#e4ead8",
          backgroundColor: "#0d1116",
          fontFamily: "monospace",
          fontSize: "5px",
          padding: { x: 2, y: 1 },
        },
      )
      .setResolution(1)
      .setAlpha(0.85)
      .setDepth(9000);
  }

  private animateHero(): void {
    const foot = cellFoot(HERO_CELL.column, HERO_CELL.row, this.layout.groundTop);
    const bob = quantizedWave(this.elapsedMs, 1240, 2, -0.35);
    this.hero.y = foot.y + bob;
    this.heroShadow.scaleX = 1 - Math.abs(bob) * 0.06;
    this.heroShadow.alpha = 0.5 - Math.abs(bob) * 0.05;

    const phase = (this.elapsedMs % 1240) / 1240;
    const squash = phase > 0.42 && phase < 0.58 ? 0.96 : 1;
    this.hero.setScale(2 - squash, squash);
  }

  private animateSlime(): void {
    const foot = cellFoot(SLIME_CELL.column, SLIME_CELL.row, this.layout.groundTop);
    const cycle = this.elapsedMs % 1500;
    const frame = cycle < 150 ? 1 : cycle < 360 ? 2 : cycle > 1190 && cycle < 1320 ? 3 : 0;
    this.slime.setTexture(`slime-${frame}`);

    const hop = Math.max(0, quantizedWave(this.elapsedMs, 1500, 3, -0.8));
    this.slime.y = foot.y - hop;
    this.slimeShadow.scaleX = 1 - hop * 0.045;
    this.slimeShadow.alpha = 0.46 - hop * 0.05;
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
   * steps — so what the lab shows for `sparks` is what this scene draws, and a
   * capture of it is reproducible rather than merely plausible.
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
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
