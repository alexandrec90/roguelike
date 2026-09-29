/**
 * The wiring for `roll-ground.ts`: one canvas texture over the roll, repainted
 * every frame.
 *
 * It sits at the horizon band's depth, over the tile rows that hang above
 * `groundTop` and under everything standing, exactly where the flat haze stripes
 * it replaces used to be (`sky-layer.ts` explains why that depth). Terrain is
 * cached per local cell for as long as the ground pose holds, because the lip
 * reads the same few hundred cells on every frame of a stride and the pose only
 * changes once a step.
 *
 * Only the tufts on the first few rows past the seam sway. Beyond `LIVE_ROWS`
 * a row is a scanline or two tall and a blade's two pixels of lean cannot be
 * seen, while a scanline there crosses a hundred cells - so those tufts are
 * held still and built once per planet point rather than once per frame.
 */

import Phaser from "phaser";

import type { CameraFrame } from "./camera";
import { fromLocal, type PlanetPose } from "./planet";
import type { PixelCloud } from "./ink";
import { HORIZON_DEPTH, TILE_DEPTH, TILE_WIDTH } from "./projection";
import { rollGroundPixels } from "./roll-ground";
import { terrainAt, type Terrain } from "./terrain";
import { grassTuftCloud, tuftSeed } from "./vegetation";

const TEXTURE_KEY = "roll-ground";

/** Rows past the seam over which the lip's grass still sways with the field's. */
const LIVE_ROWS = 3;

/** Held tufts kept before the cache starts again; a few screens of lip. */
const STILL_TUFT_LIMIT = 8192;

export class RollGroundLayer {
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private width = 0;
  private cache = new Map<number, { readonly terrain: Terrain; readonly seed: number }>();
  private cachedPose: PlanetPose | undefined;
  private stillTufts = new Map<number, PixelCloud>();

  create(scene: Phaser.Scene, frame: CameraFrame, width: number): void {
    this.width = width;
    if (frame.rollHeight <= 0) {
      return;
    }
    if (scene.textures.exists(TEXTURE_KEY)) {
      scene.textures.remove(TEXTURE_KEY);
    }
    this.texture = scene.textures.createCanvas(TEXTURE_KEY, width, frame.rollHeight);
    scene.add
      .image(0, frame.groundTop - frame.rollHeight, TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDepth(HORIZON_DEPTH);
  }

  /**
   * Repaint. Every frame, because the tufts on the lip sway in the same wind as
   * the ones on the field; a tuft that froze as it crossed the seam would be the
   * seam.
   */
  draw(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    if (this.texture === null) {
      return;
    }
    if (pose !== this.cachedPose) {
      this.cache.clear();
      this.cachedPose = pose;
    }

    const rgba = rollGroundPixels(frame, this.width, {
      terrain: (cellX, cellY) => this.terrain(pose, cellX, cellY),
      tuft: (cellX, cellY) => this.tuft(frame, pose, elapsedMs, cellX, cellY),
    });
    const context = this.texture.getContext();
    const image = context.createImageData(this.width, frame.rollHeight);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
    this.texture.refresh();
  }

  /**
   * The tuft the vegetation layer would draw in this cell: seeded from the
   * planet point, and swayed by the wind sampled where the cell's foot sits on
   * the zero-phase grid - the same two inputs, so the same blades.
   */
  private tuft(
    frame: CameraFrame,
    pose: PlanetPose,
    elapsedMs: number,
    cellX: number,
    cellY: number,
  ): PixelCloud | null {
    const cell = this.cell(pose, cellX, cellY);
    if (cell.terrain !== "grass") {
      return null;
    }
    const seam = (frame.footY + frame.phaseY * TILE_DEPTH - frame.groundTop) / TILE_DEPTH;
    if (cellY - seam <= LIVE_ROWS) {
      const footX = frame.footX + cellX * TILE_WIDTH;
      const footY = frame.footY - cellY * TILE_DEPTH;
      return grassTuftCloud(elapsedMs, cell.seed, footX, footY);
    }
    let still = this.stillTufts.get(cell.seed);
    if (still === undefined) {
      if (this.stillTufts.size >= STILL_TUFT_LIMIT) {
        this.stillTufts.clear();
      }
      still = grassTuftCloud(0, cell.seed);
      this.stillTufts.set(cell.seed, still);
    }
    return still;
  }

  private terrain(pose: PlanetPose, cellX: number, cellY: number): Terrain {
    return this.cell(pose, cellX, cellY).terrain;
  }

  /** What a local cell reads off the planet under this pose: its terrain and its tuft's seed. */
  private cell(pose: PlanetPose, cellX: number, cellY: number): { readonly terrain: Terrain; readonly seed: number } {
    const key = (cellX + 2048) * 4096 + (cellY + 2048);
    let cell = this.cache.get(key);
    if (cell === undefined) {
      const planet = fromLocal(pose, { x: cellX, y: cellY });
      cell = { terrain: terrainAt(planet), seed: tuftSeed(planet.x, planet.y) };
      this.cache.set(key, cell);
    }
    return cell;
  }
}
