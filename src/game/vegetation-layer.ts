/**
 * Runtime presentation for the pure vegetation models in `vegetation.ts`.
 *
 * Two kinds of thing, and the round world treats them differently on purpose:
 *
 * - **Grass** is a property of the ground, so it is drawn on the local grid like
 *   the ground is - one tuft per cell that samples as grass, seeded from the
 *   *planet* point that cell is reading rather than from the cell's screen
 *   position, so a tuft keeps its shape as it scrolls past instead of
 *   re-rolling itself every step.
 * - **A tree** is a thing with an identity and a place, so it is a point feature
 *   with planet coordinates (`terrain.ts`), drawn at its exact local position
 *   rather than snapped to a cell. It may be, precisely because it is one sprite
 *   with a foot and not a tile that has to meet its neighbours.
 *
 * Both are drawn on the zero-phase grid and moved by the scroll, so they travel
 * with the ground to the pixel; nothing here re-derives where the world has got
 * to.
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
import { fromLocal, toLocal, type PlanetPose } from "./planet";
import { TILE_WIDTH } from "./projection";
import { terrainAt, treesNear } from "./terrain";
import { grassTuftCloud, treeCloud } from "./vegetation";

const RANK_GRASS = 3;
const RANK_TREE = 7;

/** Trees that can be on screen at once. Density puts about twenty in reach. */
const TREE_POOL = 32;

function tuftSeed(x: number, y: number): number {
  let h = Math.imul(Math.round(x) + 1, 0x9e37) ^ Math.imul(Math.round(y) + 1, 0x85eb);
  h ^= h >>> 13;
  return h >>> 0;
}

/** One depth-sorted graphics object per screen row, plus a pool for the trees. */
export class VegetationLayer {
  private scene!: Phaser.Scene;
  private grassRows: Phaser.GameObjects.Graphics[] = [];
  private trees: Phaser.GameObjects.Graphics[] = [];
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  create(scene: Phaser.Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    this.trees = Array.from({ length: TREE_POOL }, () => scene.add.graphics());
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
          Math.round(localRow(flat, { x: 0, y: bounds.minY + index })) * TILE_WIDTH + RANK_GRASS,
        ),
    );
  }

  animate(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    this.drawGrass(frame, pose, elapsedMs);
    this.drawTrees(frame, pose, elapsedMs);
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

  /**
   * Every tree in reach, at its exact local position.
   *
   * Depth is taken from where it actually stands rather than from a row index,
   * because it does not stand on a row: a tree three-quarters of the way between
   * two of them has to sort as three-quarters, or it swaps in front of the hero
   * a whole step early.
   */
  private drawTrees(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    const reach = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxY - this.bounds.minY);
    const features = treesNear(pose, reach);
    let drawn = 0;

    for (const feature of features) {
      const gfx = this.trees[drawn];
      if (gfx === undefined) {
        break;
      }
      const local = toLocal(pose, feature);
      if (local.y < this.bounds.minY - 1 || local.y > this.bounds.maxY + 1) {
        continue;
      }
      const foot = localFoot(frame, local);
      gfx
        .clear()
        .setVisible(true)
        .setDepth(Math.round(localRow(frame, local)) * TILE_WIDTH + RANK_TREE);
      drawCloud(gfx, treeCloud(elapsedMs, feature.seed, foot.x, foot.y), foot.x, foot.y);
      drawn += 1;
    }

    for (let index = drawn; index < this.trees.length; index += 1) {
      this.trees[index]?.clear().setVisible(false);
    }
  }
}
