import Phaser from "phaser";

import { assetFrame, textureKey, type AssetEntry } from "../game/asset-registry";
import {
  createEmitter,
  particleAlpha,
  resetEmitter,
  stepEmitter,
  type EmitterState,
} from "../game/spark-emitter";
import { contentBounds } from "../game/sprite-ops";
import { TILE_PREVIEW_COLUMNS, TILE_PREVIEW_ROWS, TILE_PREVIEW_SUFFIX } from "../game/textures";
import { centerRect, type Rect } from "./lab-layout";
import type { BackgroundMode, LabState } from "./lab-state";

/** Ground colours per mode, as [left pane, right pane]. */
const GROUNDS: Record<BackgroundMode, readonly [number, number]> = {
  duo: [0x0b0d12, 0xd9d3c4],
  contrast: [0x000000, 0xffffff],
  checker: [0x1a0a1a, 0x1a0a1a],
};

const CHECKER_ACCENT = 0xff00ff;
const CHECKER_CELL = 4;
const GRID_COLOR = 0xffffff;
const BOUNDS_COLOR = 0x4ade80;
const EFFECT_CAPACITY = 16;
/** Fixed slice used when seeking an effect, so a seek reproduces exactly. */
const SEEK_SLICE_MS = 16;
const MAX_SEEK_STEPS = 600;

/** Where and how large the art sits inside a pane, in logical pixels. */
interface Placement {
  readonly rect: Rect;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly zoom: number;
  readonly tiled: boolean;
}

/**
 * One inspection pane: a ground, the art on it, and the guides over it.
 *
 * The lab always shows two of these side by side. That is the point — a sprite
 * that reads on charcoal and vanishes on bone is a sprite you find out about in
 * a screenshot rather than in a level, and only if both grounds are on screen
 * at the same moment.
 */
export class LabPane {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly particles: Phaser.GameObjects.Image[] = [];
  private emitter: EmitterState | null = null;
  private emitterZoom = 1;

  constructor(
    scene: Phaser.Scene,
    private readonly rect: Rect,
    private readonly side: 0 | 1,
  ) {
    this.background = scene.add.graphics();
    this.sprite = scene.add.image(rect.x, rect.y, "__DEFAULT").setOrigin(0, 0).setVisible(false);
    this.overlay = scene.add.graphics();

    for (let index = 0; index < EFFECT_CAPACITY; index += 1) {
      this.particles.push(
        scene.add
          .image(-8, -8, "__DEFAULT")
          .setOrigin(0, 0)
          .setVisible(false)
          .setBlendMode(Phaser.BlendModes.ADD),
      );
    }
  }

  /** Redraw everything that depends on state. Cheap enough to call on every change. */
  apply(entry: AssetEntry, state: LabState, zoom: number): void {
    this.drawGround(state.background);

    const source = assetFrame(entry, state.frame, state.variantId);
    const tiled = entry.category === "tile" && state.tiled;
    const frameWidth = source.rows[0]?.length ?? 0;
    const frameHeight = source.rows.length;
    const columns = tiled ? TILE_PREVIEW_COLUMNS : 1;
    const rows = tiled ? TILE_PREVIEW_ROWS : 1;
    const placement: Placement = {
      rect: centerRect(frameWidth * columns * zoom, frameHeight * rows * zoom, this.rect),
      frameWidth,
      frameHeight,
      zoom,
      tiled,
    };

    if (entry.effect === undefined) {
      this.showSprite(entry, state, placement);
    } else {
      this.showEffect(entry, state, zoom);
    }
    this.drawGuides(entry, state, placement);
  }

  /** Advance anything that moves on its own. Only effects do. */
  update(deltaMs: number): void {
    if (this.emitter === null) {
      return;
    }
    stepEmitter(this.emitter, deltaMs);
    this.drawParticles();
  }

  /**
   * Re-run an effect from its seed up to `timeMs`.
   *
   * Stepping in fixed slices rather than one long delta is what makes a paused
   * capture at t=2400 the same pixels every time, on any machine.
   */
  seek(timeMs: number): void {
    if (this.emitter === null) {
      return;
    }
    resetEmitter(this.emitter);
    const steps = Math.min(Math.floor(Math.max(timeMs, 0) / SEEK_SLICE_MS), MAX_SEEK_STEPS);
    for (let index = 0; index < steps; index += 1) {
      stepEmitter(this.emitter, SEEK_SLICE_MS);
    }
    this.drawParticles();
  }

  private showSprite(entry: AssetEntry, state: LabState, placement: Placement): void {
    const suffix = placement.tiled ? TILE_PREVIEW_SUFFIX : "";
    this.sprite
      .setTexture(textureKey(entry.id, state.variantId, state.frame, suffix))
      .setPosition(placement.rect.x, placement.rect.y)
      .setScale(placement.zoom)
      .setVisible(true);

    this.emitter = null;
    for (const image of this.particles) {
      image.setVisible(false);
    }
  }

  private showEffect(entry: AssetEntry, state: LabState, zoom: number): void {
    this.sprite.setVisible(false);

    const localWidth = Math.max(Math.floor(this.rect.width / zoom), 8);
    const localHeight = Math.max(Math.floor(this.rect.height / zoom), 8);
    this.emitterZoom = zoom;
    this.emitter = createEmitter({
      capacity: EFFECT_CAPACITY,
      originX: Math.floor(localWidth / 2),
      originY: Math.floor(localHeight * 0.72),
      spreadX: Math.max(2, Math.floor(localWidth / 12)),
    });

    const key = textureKey(entry.id, state.variantId, state.frame);
    for (const image of this.particles) {
      image.setTexture(key).setScale(zoom).setVisible(false);
    }
  }

  private drawParticles(): void {
    const emitter = this.emitter;
    if (emitter === null) {
      return;
    }

    emitter.particles.forEach((particle, index) => {
      const image = this.particles[index];
      if (image === undefined) {
        return;
      }
      if (!particle.active) {
        image.setVisible(false);
        return;
      }
      image
        .setPosition(
          this.rect.x + Math.round(particle.x) * this.emitterZoom,
          this.rect.y + Math.round(particle.y) * this.emitterZoom,
        )
        .setAlpha(particleAlpha(particle))
        .setVisible(true);
    });
  }

  private drawGround(mode: BackgroundMode): void {
    const [left, right] = GROUNDS[mode];
    const { x, y, width, height } = this.rect;

    this.background.clear();
    this.background.fillStyle(this.side === 0 ? left : right, 1).fillRect(x, y, width, height);
    if (mode === "checker") {
      this.paintChecker();
    }
    this.background.lineStyle(1, 0xffffff, 0.08);
    this.background.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  private paintChecker(): void {
    const { x, y, width, height } = this.rect;
    this.background.fillStyle(CHECKER_ACCENT, 0.45);

    for (let row = 0; row * CHECKER_CELL < height; row += 1) {
      for (let column = 0; column * CHECKER_CELL < width; column += 1) {
        if ((row + column) % 2 !== 0) {
          continue;
        }
        const cellX = column * CHECKER_CELL;
        const cellY = row * CHECKER_CELL;
        this.background.fillRect(
          x + cellX,
          y + cellY,
          Math.min(CHECKER_CELL, width - cellX),
          Math.min(CHECKER_CELL, height - cellY),
        );
      }
    }
  }

  private drawGuides(entry: AssetEntry, state: LabState, placement: Placement): void {
    this.overlay.clear();
    if (placement.frameWidth === 0) {
      return;
    }
    if (state.grid) {
      this.drawFrameGrid(placement);
    }
    if (state.bounds && !placement.tiled) {
      this.drawBounds(entry, state, placement);
    }
  }

  private drawFrameGrid(placement: Placement): void {
    const { rect, frameWidth, frameHeight, zoom, tiled } = placement;
    const columns = tiled ? TILE_PREVIEW_COLUMNS : 1;
    const rows = tiled ? TILE_PREVIEW_ROWS : 1;

    this.overlay.lineStyle(1, GRID_COLOR, 0.22);
    for (let column = 0; column <= columns; column += 1) {
      const x = rect.x + column * frameWidth * zoom;
      this.overlay.lineBetween(x, rect.y, x, rect.y + rect.height);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = rect.y + row * frameHeight * zoom;
      this.overlay.lineBetween(rect.x, y, rect.x + rect.width, y);
    }
  }

  private drawBounds(entry: AssetEntry, state: LabState, placement: Placement): void {
    const bounds = contentBounds(assetFrame(entry, state.frame, state.variantId));
    if (bounds.width === 0) {
      return;
    }

    const { rect, zoom } = placement;
    this.overlay.lineStyle(1, BOUNDS_COLOR, 0.75);
    this.overlay.strokeRect(
      rect.x + bounds.left * zoom + 0.5,
      rect.y + bounds.top * zoom + 0.5,
      bounds.width * zoom - 1,
      bounds.height * zoom - 1,
    );
  }
}
