/**
 * Runtime presentation for the ground cover in `vegetation.ts`.
 *
 * Grass only. The trees moved to `scenery-layer.ts` when the chestnut became
 * the direction: a volumetric SDF body rendered by the shader is not a pixel
 * cloud stroked into a `Graphics`, and the two do not belong in one layer just
 * because both are plants.
 */

import Phaser from "phaser";

import { drawCloud } from "./draw-cloud";
import { cellFoot, terrainAt } from "./field";
import { RANK, TILE_WIDTH } from "./projection";
import { grassTuftCloud } from "./vegetation";


/** One depth-sorted graphics object per field row. */
export class VegetationLayer {
  private grassRows: Phaser.GameObjects.Graphics[] = [];
  private groundTop = 0;
  private columns = 0;
  private rows = 0;

  create(scene: Phaser.Scene, groundTop: number, columns: number, rows: number): void {
    this.groundTop = groundTop;
    this.columns = columns;
    this.rows = rows;
    this.grassRows = Array.from({ length: rows }, (_, row) =>
      scene.add.graphics().setDepth(row * TILE_WIDTH + RANK.grass),
    );
  }

  animate(elapsedMs: number): void {
    this.drawGrass(elapsedMs);
  }

  private drawGrass(elapsedMs: number): void {
    for (let row = 0; row < this.rows; row += 1) {
      const gfx = this.grassRows[row];
      if (gfx === undefined) {
        continue;
      }
      gfx.clear();
      for (let column = 0; column < this.columns; column += 1) {
        if (terrainAt(column, row) !== "grass") {
          continue;
        }
        const foot = cellFoot(column, row, this.groundTop);
        const seed = Math.imul(row + 1, 0x9e37) ^ Math.imul(column + 1, 0x85eb);
        drawCloud(gfx, grassTuftCloud(elapsedMs, seed, foot.x, foot.y), foot.x, foot.y);
      }
    }
  }
}
