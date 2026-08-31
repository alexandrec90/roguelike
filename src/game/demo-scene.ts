import Phaser from "phaser";

import { quantizedWave } from "./pixel-art";
import { createEmitter, particleAlpha, stepEmitter, type EmitterState } from "./spark-emitter";
import { HERO, SLIME_FRAMES, SPARK, TORCH_FRAMES } from "./sprites";
import { installPixelTexture } from "./textures";

const WIDTH = 320;
const HEIGHT = 180;
const FLOOR_Y = 132;

export class DemoScene extends Phaser.Scene {
  private hero!: Phaser.GameObjects.Image;
  private slime!: Phaser.GameObjects.Image;
  private torch!: Phaser.GameObjects.Image;
  private torchGlow!: Phaser.GameObjects.Graphics;
  private heroShadow!: Phaser.GameObjects.Ellipse;
  private slimeShadow!: Phaser.GameObjects.Ellipse;
  private sparkImages: Phaser.GameObjects.Image[] = [];
  private emitter: EmitterState = createEmitter();
  private elapsedMs = 0;

  constructor() {
    super("world");
  }

  create(): void {
    this.createTextures();
    this.drawRoom();
    this.createTorch();
    this.createActors();
    this.createAtmosphere();
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
    SLIME_FRAMES.forEach((frame, index) => installPixelTexture(this.textures, `slime-${index}`, frame));
    TORCH_FRAMES.forEach((frame, index) => installPixelTexture(this.textures, `torch-${index}`, frame));
    installPixelTexture(this.textures, "spark", SPARK);
  }

  private drawRoom(): void {
    const room = this.add.graphics();
    room.fillStyle(0x090b10).fillRect(0, 0, WIDTH, HEIGHT);

    room.fillStyle(0x11151b).fillRect(16, 22, 288, 124);
    room.fillStyle(0x1a1b21).fillRect(20, 26, 280, 116);

    for (let y = 28; y < 118; y += 12) {
      for (let x = 22; x < 298; x += 24) {
        const offset = ((y / 12) % 2) * 12;
        room.fillStyle((x + y) % 48 === 0 ? 0x262229 : 0x211f25);
        room.fillRect(x + offset - 12, y, 21, 10);
        room.fillStyle(0x15161b).fillRect(x + offset - 12, y + 9, 21, 1);
        room.fillRect(x + offset + 9, y, 2, 10);
      }
    }

    room.fillStyle(0x08090c).fillRect(45, 42, 38, 54);
    room.fillStyle(0x2c282d).fillRect(42, 39, 44, 4);
    room.fillRect(42, 43, 4, 56);
    room.fillRect(82, 43, 4, 56);
    room.fillStyle(0x111218).fillRect(49, 47, 30, 49);
    room.fillStyle(0x0a0b0f).fillRect(54, 52, 20, 44);

    room.fillStyle(0x0e1014).fillRect(20, 116, 280, 26);
    room.fillStyle(0x292329).fillRect(20, 116, 280, 3);
    for (let y = 120; y < 143; y += 8) {
      for (let x = 22; x < 298; x += 16) {
        const shade = (x / 16 + y / 8) % 3 === 0 ? 0x1d1b20 : 0x18191d;
        room.fillStyle(shade).fillRect(x, y, 14, 6);
        room.fillStyle(0x101116).fillRect(x, y + 6, 14, 1);
      }
    }

    room.fillStyle(0x08090c).fillRect(0, 146, WIDTH, 34);
    room.fillStyle(0x17151a).fillRect(0, 146, WIDTH, 2);
    room.fillStyle(0x242027).fillRect(16, 142, 288, 4);

    const vignette = this.add.graphics();
    vignette.fillStyle(0x000000, 0.28).fillRect(0, 0, 18, HEIGHT);
    vignette.fillRect(WIDTH - 18, 0, 18, HEIGHT);
    vignette.fillStyle(0x000000, 0.18).fillRect(0, 0, WIDTH, 18);
  }

  private createTorch(): void {
    this.torchGlow = this.add.graphics();
    this.torchGlow.fillStyle(0xe66d2e, 0.025).fillCircle(160, 68, 62);
    this.torchGlow.fillStyle(0xf08d3d, 0.045).fillCircle(160, 68, 42);
    this.torchGlow.fillStyle(0xffc05a, 0.075).fillCircle(160, 68, 23);
    this.torchGlow.setBlendMode(Phaser.BlendModes.ADD);

    const sconce = this.add.graphics();
    sconce.fillStyle(0x08090c).fillRect(154, 74, 12, 3);
    sconce.fillStyle(0x5e4436).fillRect(156, 74, 8, 2);
    sconce.fillStyle(0x261d20).fillRect(159, 76, 2, 5);

    this.torch = this.add.image(160, 72, "torch-0").setOrigin(0.5, 1);

    for (let index = 0; index < this.emitter.particles.length; index += 1) {
      this.sparkImages.push(
        this.add.image(-10, -10, "spark").setVisible(false).setBlendMode(Phaser.BlendModes.ADD),
      );
    }
  }

  private createActors(): void {
    this.heroShadow = this.add.ellipse(94, FLOOR_Y + 2, 20, 5, 0x050608, 0.72);
    this.hero = this.add.image(94, FLOOR_Y, "hero").setOrigin(0.5, 1);

    this.slimeShadow = this.add.ellipse(225, FLOOR_Y + 2, 24, 5, 0x050608, 0.68);
    this.slime = this.add.image(225, FLOOR_Y, "slime-0").setOrigin(0.5, 1);
  }

  private createAtmosphere(): void {
    const motes = this.add.graphics();
    const positions = [
      [121, 58],
      [184, 92],
      [144, 105],
      [203, 51],
      [111, 83],
      [249, 72],
      [72, 111],
    ];
    for (const [x, y] of positions) {
      motes.fillStyle(0xc08b57, 0.24).fillRect(x ?? 0, y ?? 0, 1, 1);
    }
  }

  private animateHero(): void {
    const bob = quantizedWave(this.elapsedMs, 1240, 2, -0.35);
    this.hero.y = FLOOR_Y + bob;
    this.heroShadow.scaleX = 1 - Math.abs(bob) * 0.06;
    this.heroShadow.alpha = 0.72 - Math.abs(bob) * 0.07;

    const phase = (this.elapsedMs % 1240) / 1240;
    const squash = phase > 0.42 && phase < 0.58 ? 0.96 : 1;
    this.hero.setScale(2 - squash, squash);
  }

  private animateSlime(): void {
    const cycle = this.elapsedMs % 1500;
    const frame = cycle < 150 ? 1 : cycle < 360 ? 2 : cycle > 1190 && cycle < 1320 ? 3 : 0;
    this.slime.setTexture(`slime-${frame}`);

    const hop = Math.max(0, quantizedWave(this.elapsedMs, 1500, 3, -0.8));
    this.slime.y = FLOOR_Y - hop;
    this.slimeShadow.scaleX = 1 - hop * 0.045;
    this.slimeShadow.alpha = 0.68 - hop * 0.055;
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
