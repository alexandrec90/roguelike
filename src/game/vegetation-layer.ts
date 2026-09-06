/**
 * Runtime presentation for the ground cover in `vegetation.ts`.
 *
 * **Grass only.** The trees moved to `scenery-layer.ts` when the volumetric
 * crown became the direction: an SDF body evaluated by the shader is not a pixel
 * cloud stroked into a `Graphics`, and the two do not belong in one layer just
 * because both are plants. What is left is the half that genuinely is ground.
 *
 * Grass is a property of the ground, so it is drawn on the local grid like the
 * ground is - one tuft per cell that samples as grass, seeded from the *planet*
 * point that cell is reading rather than from the cell's screen position, so a
 * tuft keeps its shape as it scrolls past instead of re-rolling itself every
 * step. It is drawn on the zero-phase grid and moved by the scroll, so it
 * travels with the ground to the pixel; nothing here re-derives where the world
 * has got to.
 */

import Phaser from "phaser";

import {
  localFoot,
  localRow,
  scrollOffset,
  type CameraFrame,
  type LocalBounds,
} from "./camera";
import { drawCloud } from "./draw-cloud";
import { fromLocal, type PlanetPose } from "./planet";
import { RANK, TILE_WIDTH } from "./projection";
import { terrainAt } from "./terrain";
import { grassTuftCloud } from "./vegetation";

function tuftSeed(x: number, y: number): number {
  let h = Math.imul(Math.round(x) + 1, 0x9e37) ^ Math.imul(Math.round(y) + 1, 0x85eb);
  h ^= h >>> 13;
  return h >>> 0;
}

/** One depth-sorted graphics object per screen row. */
export class VegetationLayer {
  private scene!: Phaser.Scene;
  private grassRows: Phaser.GameObjects.Graphics[] = [];
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  create(scene: Phaser.Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    this.layout(frame, bounds);
  }

  /** Re-row after a resize changed how much playfield the window shows. */
  layout(frame: CameraFrame, bounds: LocalBounds): void {
    for (const row of this.grassRows) {
      row.destroy();
    }
    this.bounds = bounds;
    const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
    this.grassRows = Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_unused, index) =>
      this.scene.add
        .graphics()
        .setDepth(
          Math.round(localRow(flat, { x: 0, y: bounds.minY + index })) * TILE_WIDTH + RANK.grass,
        ),
    );
  }

  animate(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    this.drawGrass(frame, pose, elapsedMs);
  }

  /**
   * A tuft per grass cell, drawn on the zero-phase grid and slid by the scroll.
   *
   * The whole row moves as one `setPosition`, so a stride costs one write per
   * row rather than one per tuft - and, more to the point, no tuft can round the
   * scroll differently from the ground tile it is standing on.
   */
  private drawGrass(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
    const offset = scrollOffset(frame);

    for (let index = 0; index < this.grassRows.length; index += 1) {
      const gfx = this.grassRows[index];
      if (gfx === undefined) {
        continue;
      }
      const localY = this.bounds.minY + index;
      gfx.clear().setPosition(offset.x, offset.y);
      for (let localX = this.bounds.minX; localX <= this.bounds.maxX; localX += 1) {
        const planet = fromLocal(pose, { x: localX, y: localY });
        if (terrainAt(planet) !== "grass") {
          continue;
        }
        const foot = localFoot(flat, { x: localX, y: localY });
        const seed = tuftSeed(planet.x, planet.y);
        drawCloud(gfx, grassTuftCloud(elapsedMs, seed, foot.x, foot.y), foot.x, foot.y);
      }
    }
  }
}
