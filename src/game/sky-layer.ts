/**
 * The band above the horizon, and the 360 degrees of it you cannot see at once.
 *
 * Everything up here lives at a *bearing* rather than at a screen x, and
 * `panorama.ts` converts. That single change is what makes the planet read as
 * round: strafe and the ridge and the stars slide together by the same whole
 * number of pixels, keep sliding as you keep walking, and come back round to
 * where they started after one lap of the sideways circle.
 *
 * It is also the only part of the world that shows the turn *continuously*. The
 * ground is a grid and turns in whole tiles once a step (`terrain.ts` says why);
 * the sky has no grid, no foreshortening and no seams to keep square, so it gets
 * the exact angle every frame. The two are reconciled by distance - nobody can
 * measure a boulder against a mountain - and the smooth half is the half the eye
 * actually reads.
 *
 * What is *not* up here any more is anything a player could walk to. The pines
 * and towers that used to stand on the horizon line at a bearing were a painted
 * backdrop - approach one and it never got closer. The horizon is real now: a
 * tree on it is a feature of the planet that `scenery-layer.ts` places on the
 * roll by distance, and it grows and comes down onto the field as the hero
 * walks toward it. The ridge stays, because a mountain range far past the
 * horizon is the one thing that genuinely does sit at a bearing.
 *
 * The layers, back to front:
 *
 *     sky bands + roll       opaque; over the ground, under everything standing
 *     stars                  scroll with the bearing
 *     far ridge              seamless noise profile, scrolls
 *     near ridge             the same, darker and shorter
 */

import Phaser from "phaser";

import { hexToInt } from "./color";
import {
  horizonLayout,
  rollBands,
  rollColors,
  skyBands,
  starField,
  type HorizonLayout,
  type Star,
} from "./horizon";
import { bearingOffset, landmarkX, panoramaColumn, panoramaRidge, PANORAMA_WIDTH } from "./panorama";
import { HORIZON_DEPTH } from "./projection";

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55, color: "#0d1830" } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26, color: "#08101e" } as const;

/**
 * The band draws **over the ground and under everything that stands on it**.
 *
 * Over the ground, because the tile grid is cut to cover the render target with
 * a cell of margin on every side (`visibleLocal`), and a cell is anchored by its
 * *foot*, so the topmost row necessarily hangs above `groundTop` - and it has
 * to, or the far edge of the field tears open a tile-high gap every time a
 * stride scrolls it down. Painting the horizon on top of the tiles is what turns
 * that overhang into what it should be: ground that has gone over the hill.
 * Puddles lie on the ground and go under with it.
 *
 * Under everything standing, because a horizon is at eye level and a tree on
 * the far row of a flat field keeps its crown against the sky. An earlier
 * version painted the band over the whole world, and every tree on the far
 * rows was cropped at the horizon line as if the sky were a wall. Bodies on the
 * roll itself sort by their affine row, which keeps decreasing with distance
 * (`camera.ts`): `ROLL_ROWS` past a field some twenty rows deep is about
 * seventy rows, or -1120 - so the constant is the one place the roll's depth
 * budget is spent, and `rootedDepth` puts grass past the seam beneath it.
 */
const BAND_DEPTH = HORIZON_DEPTH;

const STAR_BRIGHT = "#f2f7ff";
const STAR_DIM = "#5e7ea6";

interface Ridge {
  readonly profile: readonly number[];
  readonly color: number;
}

export class SkyLayer {
  private width = 0;
  private layout: HorizonLayout = horizonLayout(180);
  private stars: readonly Star[] = [];
  private ridges: Ridge[] = [];

  private starGfx!: Phaser.GameObjects.Graphics;
  private ridgeGfx!: Phaser.GameObjects.Graphics;

  create(scene: Phaser.Scene, layout: HorizonLayout, width: number): void {
    this.layout = layout;
    this.width = width;

    const bands = scene.add.graphics().setDepth(BAND_DEPTH);
    for (const band of skyBands(layout.skyHeight)) {
      bands.fillStyle(hexToInt(band.color)).fillRect(0, band.y, width, band.height);
    }
    for (const band of rollColors(rollBands(layout.rollHeight))) {
      bands.fillStyle(hexToInt(band.color)).fillRect(0, layout.horizonY + band.y, width, band.height);
    }

    this.starGfx = scene.add.graphics().setDepth(BAND_DEPTH + 1);
    this.ridgeGfx = scene.add.graphics().setDepth(BAND_DEPTH + 2);
    this.stars = starField(PANORAMA_WIDTH, layout.skyHeight);
    this.ridges = [RIDGE_FAR, RIDGE_NEAR].map((ridge) => ({
      profile: panoramaRidge({ ...ridge, maxHeight: layout.horizonY }),
      color: hexToInt(ridge.color),
    }));
  }

  /** One frame of horizon, for a heading. */
  animate(turn: number): void {
    const offset = bearingOffset(turn);
    this.drawStars(offset);
    this.drawRidges(offset);
  }

  private drawStars(offset: number): void {
    this.starGfx.clear();
    for (const star of this.stars) {
      const x = landmarkX(star.x, offset);
      if (x < 0 || x >= this.width) {
        continue;
      }
      this.starGfx.fillStyle(hexToInt(star.bright ? STAR_BRIGHT : STAR_DIM)).fillRect(x, star.y, 1, 1);
    }
  }

  private drawRidges(offset: number): void {
    this.ridgeGfx.clear();
    for (const ridge of this.ridges) {
      this.ridgeGfx.fillStyle(ridge.color);
      for (let x = 0; x < this.width; x += 1) {
        const height = ridge.profile[panoramaColumn(x, offset)] ?? 0;
        if (height > 0) {
          this.ridgeGfx.fillRect(x, this.layout.horizonY - height, 1, height);
        }
      }
    }
  }
}
