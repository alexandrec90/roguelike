import Phaser from "phaser";

import { assetFrame, findAsset, textureKey, type AssetEntry } from "../game/asset-registry";
import { integerScale } from "../game/integer-scale";
import { installAssetTextures, TILE_PREVIEW_COLUMNS, TILE_PREVIEW_ROWS } from "../game/textures";
import { filmstripCells, splitPanes, type Rect } from "./lab-layout";
import { LabPane } from "./lab-pane";
import { normalizeLabState, type LabState } from "./lab-state";
import { frameIndexAt, timeForFrame } from "./lab-timeline";

/** The lab renders at the same logical size as the game. Anything else would lie. */
export const LAB_SIZE = { width: 320, height: 180 } as const;

const STAGE: Rect = { x: 4, y: 4, width: 312, height: 122 };
const PANE_GUTTER = 8;
const PANE_MARGIN = 8;
const STRIP: Rect = { x: 4, y: 132, width: 312, height: 44 };
const STRIP_GAP = 3;
const STRIP_POOL = 16;
const CHROME = 0x0e1015;
const CELL_GROUND = 0x16181f;
const CELL_ACTIVE = 0xe8c07a;

/**
 * The asset lab.
 *
 * Everything it shows comes from `LabState`, and every change goes through
 * `setState`. There is no hidden animation state to drift out of step with the
 * controls, which is what lets a URL reopen an exact view — the thing that makes
 * a screenshot comparable with the one taken before the change.
 */
export class LabScene extends Phaser.Scene {
  /** Called when playback advances the frame, so the chrome can follow along. */
  onFrameChange: ((frame: number) => void) | null = null;

  private state: LabState = normalizeLabState();
  private panes: LabPane[] = [];
  private stripGraphics!: Phaser.GameObjects.Graphics;
  private stripImages: Phaser.GameObjects.Image[] = [];
  private elapsedMs = 0;

  constructor() {
    super("asset-lab");
  }

  create(): void {
    installAssetTextures(this.textures);
    this.cameras.main.setBackgroundColor(CHROME);

    const [left, right] = splitPanes(STAGE, PANE_GUTTER);
    this.panes = [new LabPane(this, left, 0), new LabPane(this, right, 1)];

    this.stripGraphics = this.add.graphics();
    for (let index = 0; index < STRIP_POOL; index += 1) {
      this.stripImages.push(
        this.add.image(-16, -16, "__DEFAULT").setOrigin(0, 0).setVisible(false),
      );
    }

    // `render`, not `applyAll`: the opening state can already be a paused
    // effect at t=2400, and an emitter that is merely built sits at t=0. A URL
    // that reopens a capture has to replay to it here as well as on a change.
    this.render();
  }

  update(_time: number, delta: number): void {
    if (!this.state.playing) {
      return;
    }

    this.elapsedMs += delta;
    const entry = this.currentEntry();
    if (entry.effect !== undefined) {
      for (const pane of this.panes) {
        pane.update(delta);
      }
      return;
    }

    const frame = frameIndexAt(this.elapsedMs, entry.frames.length, entry.frameDurationMs);
    if (frame === this.state.frame) {
      return;
    }
    this.state = { ...this.state, frame };
    this.applyAll();
    this.onFrameChange?.(frame);
  }

  getState(): LabState {
    return this.state;
  }

  setState(next: LabState): void {
    // Reachable before `create` runs: the page parses its URL and hands the
    // opening view over while Phaser is still booting. Store it; `create` draws it.
    if (this.panes.length === 0) {
      this.state = next;
      return;
    }

    const entry = findAsset(next.assetId) ?? this.currentEntry();
    this.state = next;
    this.elapsedMs = next.playing ? timeForFrame(next.frame, entry.frameDurationMs) : next.timeMs;
    this.render();
  }

  /** Draw the current state, replaying anything time-dependent when paused. */
  private render(): void {
    this.applyAll();
    if (this.state.playing) {
      return;
    }
    for (const pane of this.panes) {
      pane.seek(this.state.timeMs);
    }
  }

  private currentEntry(): AssetEntry {
    const entry = findAsset(this.state.assetId);
    if (entry === undefined) {
      throw new Error(`The lab was pointed at an unknown asset '${this.state.assetId}'`);
    }
    return entry;
  }

  /**
   * The zoom the art is actually drawn at, which is the requested zoom capped
   * by what fits. The page reports this rather than the request: an inspector
   * that says "8x" while drawing 3x is worse than one that says nothing.
   */
  effectiveZoom(): number {
    return this.stageZoom(this.currentEntry());
  }

  private applyAll(): void {
    const entry = this.currentEntry();
    const zoom = this.stageZoom(entry);

    for (const pane of this.panes) {
      pane.apply(entry, this.state, zoom);
    }
    this.drawFilmstrip(entry);
  }

  /** Largest whole zoom at which the art still fits a pane, never above the request. */
  private stageZoom(entry: AssetEntry): number {
    const source = assetFrame(entry, this.state.frame, this.state.variantId);
    const tiled = entry.category === "tile" && this.state.tiled;
    const width = (source.rows[0]?.length ?? 1) * (tiled ? TILE_PREVIEW_COLUMNS : 1);
    const height = source.rows.length * (tiled ? TILE_PREVIEW_ROWS : 1);
    const pane = splitPanes(STAGE, PANE_GUTTER)[0];

    return integerScale(pane.width - PANE_MARGIN, pane.height - PANE_MARGIN, width, height, {
      maxFactor: this.state.zoom,
    }).factor;
  }

  private drawFilmstrip(entry: AssetEntry): void {
    const source = assetFrame(entry, 0, this.state.variantId);
    const width = source.rows[0]?.length ?? 1;
    const height = source.rows.length;
    const scale = integerScale(46, STRIP.height - 2, width, height, { maxFactor: 4 }).factor;
    const cells = filmstripCells({
      count: Math.min(entry.frames.length, STRIP_POOL),
      cellWidth: width * scale + 2,
      cellHeight: height * scale + 2,
      gap: STRIP_GAP,
      maxWidth: STRIP.width,
      originX: STRIP.x,
      originY: STRIP.y,
    });

    this.stripGraphics.clear();
    this.stripImages.forEach((image) => image.setVisible(false));

    cells.forEach((cell, index) => {
      this.stripGraphics.fillStyle(CELL_GROUND, 1).fillRect(cell.x, cell.y, cell.width, cell.height);
      if (index === this.state.frame) {
        this.stripGraphics.lineStyle(1, CELL_ACTIVE, 0.9);
        this.stripGraphics.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
      }

      const image = this.stripImages[index];
      image
        ?.setTexture(textureKey(entry.id, this.state.variantId, index))
        .setPosition(cell.x + 1, cell.y + 1)
        .setScale(scale)
        .setVisible(true);
    });
  }
}
