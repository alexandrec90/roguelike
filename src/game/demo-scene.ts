import Phaser from "phaser";

import { hexToInt } from "./color";
import { cellFoot, composeGround, faceCells, PUDDLE_SITES, rockCells } from "./field";
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
import { INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";
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
import {
  clipToPuddle,
  createPuddle,
  createRippleField,
  puddleGlints,
  puddleHolds,
  puddleReflection,
  puddleSurface,
  rainImpact,
  rippleAlpha,
  rippleCloud,
  spawnRipple,
  stepRipples,
  type Puddle,
  type RippleField,
} from "./puddles";
import { renderModel, samplePose, type Clip, type Facing } from "./rig";
import {
  createEmitter,
  MAX_STEP_MS,
  particleAlpha,
  stepEmitter,
  type EmitterState,
} from "./spark-emitter";
import { FAR_PINE, FAR_TOWER, RAIN_STREAK, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { installPixelTexture } from "./textures";
import { WALL_FACE, WALL_TOP } from "./tiles";
import { freezeCloud, meltCloud } from "./transforms";
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

/**
 * How sheer each water layer is drawn.
 *
 * These are the scene's lighting, not the water's geometry — `puddles.ts`
 * hands back clouds and says nothing about how hard they are lit, so a darker
 * night is these five numbers rather than a second set of art.
 */
const GLINT_ALPHA = 0.5;
const REFLECTION_ALPHA = 0.5;
const TORCH_REFLECTION_ALPHA = 0.55;
/** How far the torch's light reaches down its puddle before it breaks up. */
const TORCH_REFLECTION_ROWS = 14;
/** How much brighter a strike makes every puddle at its peak. */
const LIGHTNING_WATER_GAIN = 0.55;

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
  installPixelTexture(scene.textures, "far-pine", FAR_PINE);
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

function drawDistantObjects(scene: Phaser.Scene, layout: HorizonLayout): void {
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
  for (const x of DISTANT_PINES) {
    scene.add.image(x, horizonY, "far-pine").setOrigin(0, 1).setDepth(BAND_DEPTH + 2);
  }
  scene.add.image(DISTANT_TOWER_X, horizonY, "far-tower").setOrigin(0, 1).setDepth(BAND_DEPTH + 2);
}

function drawWorld(scene: Phaser.Scene, layout: HorizonLayout, columns: number, rows: number): void {
  drawSky(scene, layout);
  drawDistantObjects(scene, layout);
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
  private waterGfx!: Phaser.GameObjects.Graphics;
  private waterFlashGfx!: Phaser.GameObjects.Graphics;
  private glintGfx!: Phaser.GameObjects.Graphics;
  private reflectionGfx!: Phaser.GameObjects.Graphics;
  private rippleGfx!: Phaser.GameObjects.Graphics;
  private boltGfx!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Rectangle;
  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private rainImages: Phaser.GameObjects.Image[] = [];
  private emitter!: EmitterState;
  private rain!: EmitterState;
  private puddles: Puddle[] = [];
  private ripples!: RippleField;
  private elapsedMs = 0;

  constructor(skyFraction: number = DEFAULT_SKY_FRACTION) {
    super("overworld-field");
    this.skyFraction = skyFraction;
  }

  create(): void {
    this.layout = horizonLayout(HEIGHT, this.skyFraction);
    this.columns = columnsAcross(WIDTH);
    this.rows = rowsDown(this.layout.groundHeight);

    installSceneTextures(this, this.columns, this.rows);
    drawWorld(this, this.layout, this.columns, this.rows);
    this.createPuddles();
    this.createHero();
    this.createSlime();
    this.createTorch();
    this.createWeather();
  }

  update(_time: number, delta: number): void {
    this.elapsedMs += Math.min(delta, 40);
    const heroCloud = this.heroCloud();
    this.animateHero(heroCloud);
    this.animateSlime();
    this.animateTorch();
    this.updateSparks(delta);
    // Before the water, so a drop that lands this frame rings this frame.
    this.updateRain(delta);
    this.animateWater(delta, heroCloud);
    this.updateLightning();
  }

  /**
   * The field's standing water: one generated puddle per site, and the four
   * layers drawn over them.
   *
   * The bodies never change, so they are stamped once here; only the glints,
   * the reflections and the rings are redrawn per frame.
   */
  private createPuddles(): void {
    this.puddles = PUDDLE_SITES.map((site) => {
      const foot = cellFoot(site.column, site.row, this.layout.groundTop);
      return createPuddle({
        id: site.id,
        centerX: foot.x + (site.offsetX ?? 0),
        centerY: foot.y + (site.offsetY ?? 0),
        radius: site.radius,
        seed: site.seed,
      });
    });

    this.waterGfx = this.add.graphics().setDepth(PUDDLE_DEPTH);
    for (const puddle of this.puddles) {
      drawCloud(this.waterGfx, puddleSurface(puddle), 0, 0);
    }

    this.glintGfx = this.add.graphics().setDepth(PUDDLE_DEPTH + 1);
    this.reflectionGfx = this.add.graphics().setDepth(PUDDLE_DEPTH + 2);
    this.rippleGfx = this.add.graphics().setDepth(PUDDLE_DEPTH + 3);

    // Lightning lights water harder than it lights grass. Stamped once at full
    // strength and then held at alpha 0; a strike only turns it up.
    this.waterFlashGfx = this.add
      .graphics()
      .setDepth(PUDDLE_DEPTH + 4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    for (const puddle of this.puddles) {
      const lit: PixelCloud = puddle.water.map((pixel) => ({ ...pixel, ink: "deep" }));
      drawCloud(this.waterFlashGfx, lit, 0, 0);
    }

    this.ripples = createRippleField();
  }

  private createHero(): void {
    this.heroGfx = this.add.graphics().setDepth(HERO_CELL.row * TILE_WIDTH + RANK_ACTOR);
  }

  private puddleFor(id: string): Puddle | undefined {
    return this.puddles.find((puddle) => puddle.id === id);
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

  private animateHero(cloud: PixelCloud): void {
    const foot = this.heroFoot();
    this.heroGfx.clear();
    drawCloud(this.heroGfx, cloud, foot.x, foot.y);
  }

  /**
   * Everything drawn on water, in the order light reaches the eye: the sky's
   * shimmer, then what is standing over it, then the rings the rain punched.
   *
   * The puddle sees whatever the hero is doing, transforms included, and gives
   * it back in the hero's own inks — a frozen hero reflects ice.
   */
  private animateWater(delta: number, heroCloud: PixelCloud): void {
    stepRipples(this.ripples, Math.min(delta, 40));

    this.glintGfx.clear();
    for (const puddle of this.puddles) {
      drawCloud(this.glintGfx, puddleGlints(puddle, this.elapsedMs), 0, 0, GLINT_ALPHA);
    }

    this.reflectionGfx.clear();
    const heroPuddle = this.puddleFor("hero");
    if (heroPuddle !== undefined) {
      const foot = this.heroFoot();
      const reflection = puddleReflection(heroPuddle, heroCloud, foot.x, foot.y, this.elapsedMs);
      drawCloud(this.reflectionGfx, reflection, 0, 0, REFLECTION_ALPHA);
    }
    const torchPuddle = this.puddleFor("torch");
    if (torchPuddle !== undefined) {
      const light = this.torchReflection(torchPuddle);
      drawCloud(this.reflectionGfx, light, 0, 0, TORCH_REFLECTION_ALPHA);
    }

    this.rippleGfx.clear();
    for (const ripple of this.ripples.ripples) {
      if (!ripple.active) {
        continue;
      }
      drawCloud(this.rippleGfx, this.overWater(rippleCloud(ripple)), 0, 0, rippleAlpha(ripple));
    }
  }

  /** Rings spread past the rim they started inside; the water is the frame. */
  private overWater(cloud: PixelCloud): PixelCloud {
    return cloud.filter((pixel) =>
      this.puddles.some((puddle) => puddleHolds(puddle, pixel.x, pixel.y)),
    );
  }

  /**
   * The torch on the water — a swaying column of light, not a mirrored sprite.
   *
   * A flame has no silhouette worth flipping; what a puddle actually shows of
   * one is a smeared streak that breaks up with distance, which is three lines
   * of wave rather than a second set of torch frames.
   */
  private torchReflection(puddle: Puddle): PixelCloud {
    const foot = cellFoot(TORCH_CELL.column, TORCH_CELL.row, this.layout.groundTop);
    const cloud: PixelCloud = [];
    for (let dy = 0; dy < TORCH_REFLECTION_ROWS; dy += 1) {
      const sway = quantizedWave(this.elapsedMs + dy * 130, 1100, 2, dy * 0.4);
      const half = dy < 5 ? 1 : 0;
      for (let dx = -half; dx <= half; dx += 1) {
        cloud.push({ x: foot.x + dx + sway, y: foot.y + dy, ink: dx === 0 ? "amber" : "ember" });
      }
    }
    return clipToPuddle(puddle, cloud);
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

  /**
   * The same pooled emitter as the sparks, pointed down and leaned over by the
   * wind. Drops that reach water land in it rather than falling through.
   */
  private updateRain(delta: number): void {
    stepEmitter(this.rain, delta);
    this.landRain(delta);

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

  /**
   * Retire every drop that crossed water this step, and ring the puddle where
   * it went in.
   *
   * The drop's own velocity reconstructs where it was before the step; where
   * along that segment the ring belongs is `rainImpact`'s problem, and the
   * comment there is the one worth reading.
   */
  private landRain(delta: number): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    for (const particle of this.rain.particles) {
      if (!particle.active) {
        continue;
      }
      const impact = rainImpact(
        this.puddles,
        particle.x - particle.vx * step,
        particle.y - particle.vy * step,
        particle.x,
        particle.y,
      );
      if (impact !== null) {
        spawnRipple(this.ripples, impact.x, impact.y);
        particle.active = false;
      }
    }
  }

  /** Bolt and flash are pure functions of time, so a capture is repeatable. */
  private updateLightning(): void {
    const strike = lightningAt(this.elapsedMs, STORM_SEED);
    this.boltGfx.clear();
    this.flash.setVisible(strike.active);
    this.waterFlashGfx.setAlpha(strike.active ? LIGHTNING_WATER_GAIN * strike.alpha : 0);
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

/**
 * Group by ink so a 100-pixel model costs a handful of fill-style switches.
 *
 * `alpha` is the *scene's* opinion — how hard this particular draw is lit — and
 * it multiplies the ink's own `INK_ALPHA`, which is a property of the colour
 * and travels with it everywhere. Phaser takes the two as a numeric fill alpha
 * rather than as an eight-digit hex, which `hexToInt` could not parse anyway.
 */
function drawCloud(
  gfx: Phaser.GameObjects.Graphics,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  alpha = 1,
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
    gfx.fillStyle(hexToInt(INK_COLORS[ink]), INK_ALPHA[ink] * alpha);
    for (const pixel of pixels) {
      gfx.fillRect(originX + pixel.x, originY + pixel.y, 1, 1);
    }
  }
}

export const GAME_SIZE = { width: WIDTH, height: HEIGHT } as const;
