/**
 * The playfield, scrolling and turning under a grid that never moves.
 *
 * The whole layer is built on the split `camera.ts` describes. Art is laid out
 * once on the zero-phase grid and thereafter only ever *moved by a container
 * position*; what each cell shows is re-sampled only when a step completes and
 * the pose the world is read from advances. So a frame of walking costs about
 * twenty container writes rather than four hundred sprite writes, and a step
 * costs one sweep of the grid.
 *
 *     per frame   : containers <- scrollOffset(frame)          (smooth, cheap)
 *     per step    : every cell <- terrainAt(fromLocal(pose))   (the world turns)
 *
 * Containers also buy the depth sorting for nothing. The ground is one container
 * behind everything, and standing rock gets one container per *screen* row, so a
 * block keeps sorting against the hero on the scene's shared
 * `row * TILE_WIDTH + rank` key without every block owning a depth of its own.
 * Screen rows are the right key because the grid is bolted to the screen: only
 * the phase slides things inside a row, never between rows.
 *
 * A rock cell is three pieces of art, and the reason is in `projection.ts`: the
 * cap art at ground level so nothing shows through, the same cap lifted by
 * `WALL_RISE` so the block reads as standing, and a front face - but only where
 * the cell in front is not also rock, or a flat shelf grows a course of mortar
 * across its middle.
 *
 * The cap has the same edge rule pointing the other way. `WALL_TOP` carries a
 * lit back lip, which is a catch-light on the step behind it; inside a mass
 * there is no step, so a cell with rock behind it gets `WALL_SHELF` instead and
 * the whole outcrop ends up with one rim at the back and one face at the front
 * rather than a lit line every twelve pixels.
 */

import Phaser from "phaser";

import {
  localOrigin,
  localRow,
  scrollOffset,
  type CameraFrame,
  type LocalBounds,
} from "./camera";
import { fromLocal, type PlanetPose } from "./planet";
import { TILE_WIDTH, wallCapY, wallFaceY } from "./projection";
import { terrainAt, type Terrain } from "./terrain";
import { installPixelTexture } from "./textures";
import { DIRT_PATH, GRASS, WALL_FACE, WALL_SHELF, WALL_TOP } from "./tiles";

/** Behind everything that stands on it. */
const GROUND_DEPTH = -1000;
const RANK_CAP = 0;

const GROUND_TEXTURE: Readonly<Record<Terrain, string>> = {
  grass: "ground-grass",
  dirt: "ground-dirt",
  rock: "wall-top",
};

/** One grid cell's three sprites, pre-positioned on the zero-phase grid. */
interface CellArt {
  readonly localX: number;
  readonly localY: number;
  readonly tile: Phaser.GameObjects.Image;
  readonly cap: Phaser.GameObjects.Image;
  readonly face: Phaser.GameObjects.Image;
}

export class GroundLayer {
  private scene!: Phaser.Scene;
  private cells: CellArt[] = [];
  private ground!: Phaser.GameObjects.Container;
  /** One per screen row, keyed by `row - bounds.minRow`. */
  private rockRows: Phaser.GameObjects.Container[] = [];
  private minRow = 0;
  private sampled: PlanetPose | undefined;

  create(scene: Phaser.Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    installPixelTexture(scene.textures, "ground-grass", GRASS);
    installPixelTexture(scene.textures, "ground-dirt", DIRT_PATH);
    installPixelTexture(scene.textures, "wall-top", WALL_TOP);
    installPixelTexture(scene.textures, "wall-shelf", WALL_SHELF);
    installPixelTexture(scene.textures, "wall-face", WALL_FACE);
    this.ground = scene.add.container(0, 0).setDepth(GROUND_DEPTH);
    this.layout(frame, bounds);
  }

  /**
   * (Re)build the pools for a grid of this size.
   *
   * Called again on every resize, because the window decides how many rows
   * survive the cover crop and therefore how much grid there is to fill.
   */
  layout(frame: CameraFrame, bounds: LocalBounds): void {
    this.destroyPools();
    const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
    this.minRow = bounds.minY;
    this.rockRows = Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_unused, index) =>
      this.scene.add
        .container(0, 0)
        .setDepth(this.screenRow(frame, bounds.minY + index) * TILE_WIDTH + RANK_CAP),
    );

    for (let localY = bounds.maxY; localY >= bounds.minY; localY -= 1) {
      for (let localX = bounds.minX; localX <= bounds.maxX; localX += 1) {
        this.cells.push(this.buildCell(flat, localX, localY));
      }
    }
    this.sampled = undefined;
  }

  /**
   * One frame. The scroll always; the sampling only when the world has turned
   * or moved on to the next cell.
   */
  draw(frame: CameraFrame, pose: PlanetPose): void {
    if (this.sampled !== pose) {
      this.resample(pose);
      this.sampled = pose;
    }
    const offset = scrollOffset(frame);
    this.ground.setPosition(offset.x, offset.y);
    for (const row of this.rockRows) {
      row.setPosition(offset.x, offset.y);
    }
  }

  private buildCell(flat: CameraFrame, localX: number, localY: number): CellArt {
    const origin = localOrigin(flat, { x: localX, y: localY });
    const tile = this.scene.add.image(origin.x, origin.y, "ground-grass").setOrigin(0, 0);
    const cap = this.scene.add
      .image(origin.x, wallCapY(origin.y), "wall-top")
      .setOrigin(0, 0)
      .setVisible(false);
    const face = this.scene.add
      .image(origin.x, wallFaceY(origin.y), "wall-face")
      .setOrigin(0, 0)
      .setVisible(false);

    this.ground.add(tile);
    const row = this.rockRows[localY - this.minRow];
    row?.add(cap);
    row?.add(face);
    return { localX, localY, tile, cap, face };
  }

  /**
   * Read the planet through the frame, one cell at a time.
   *
   * `fromLocal` is the rotation, and it is applied per cell rather than to the
   * grid: the grid stays axis-aligned and only what lands in each cell changes,
   * which is the entire reason a camera may turn in a game with this pixel
   * contract.
   */
  private resample(pose: PlanetPose): void {
    for (const cell of this.cells) {
      const terrain = terrainAt(fromLocal(pose, { x: cell.localX, y: cell.localY }));
      cell.tile.setTexture(GROUND_TEXTURE[terrain]);
      const rock = terrain === "rock";
      cell.cap.setVisible(rock);
      if (rock) {
        // The lit lip belongs on the far edge of the mass and nowhere inside
        // it, exactly as the face belongs on the near edge and nowhere behind.
        const behind = terrainAt(fromLocal(pose, { x: cell.localX, y: cell.localY + 1 }));
        cell.cap.setTexture(behind === "rock" ? "wall-shelf" : "wall-top");
      }
      cell.face.setVisible(
        rock && terrainAt(fromLocal(pose, { x: cell.localX, y: cell.localY - 1 })) !== "rock",
      );
    }
  }

  /** Screen row of a local depth, on the zero-phase grid. */
  private screenRow(frame: CameraFrame, localY: number): number {
    return Math.round(localRow({ ...frame, phaseX: 0, phaseY: 0 }, { x: 0, y: localY }));
  }

  private destroyPools(): void {
    for (const cell of this.cells) {
      cell.tile.destroy();
      cell.cap.destroy();
      cell.face.destroy();
    }
    this.cells = [];
    for (const row of this.rockRows) {
      row.destroy();
    }
    this.rockRows = [];
  }
}
