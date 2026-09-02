/** Runtime presentation for the pure vegetation models in `vegetation.ts`. */

import Phaser from "phaser";

import { drawCloud } from "./draw-cloud";
import { cellFoot, terrainAt, TREE_SITES, type TreeSite } from "./field";
import { TILE_WIDTH } from "./projection";
import { grassTuftCloud, treeCloud } from "./vegetation";

const RANK_GRASS = 3;
const RANK_TREE = 7;

interface DrawnTree {
  readonly site: TreeSite;
  readonly gfx: Phaser.GameObjects.Graphics;
}

/** One depth-sorted graphics object per field row, plus one per tree. */
export class VegetationLayer {
  private grassRows: Phaser.GameObjects.Graphics[] = [];
  private trees: DrawnTree[] = [];
  private groundTop = 0;
  private columns = 0;
  private rows = 0;

  create(scene: Phaser.Scene, groundTop: number, columns: number, rows: number): void {
    this.groundTop = groundTop;
    this.columns = columns;
    this.rows = rows;
    this.grassRows = Array.from({ length: rows }, (_, row) =>
      scene.add.graphics().setDepth(row * TILE_WIDTH + RANK_GRASS),
    );
    this.trees = TREE_SITES.filter((site) => site.row < rows).map((site) => ({
      site,
      gfx: scene.add.graphics().setDepth(site.row * TILE_WIDTH + RANK_TREE),
    }));
  }

  animate(elapsedMs: number): void {
    this.drawGrass(elapsedMs);
    for (const { site, gfx } of this.trees) {
      const foot = cellFoot(site.column, site.row, this.groundTop);
      gfx.clear();
      drawCloud(
        gfx,
        treeCloud(elapsedMs, site.seed, foot.x, foot.y),
        foot.x + (site.offsetX ?? 0),
        foot.y,
      );
    }
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
