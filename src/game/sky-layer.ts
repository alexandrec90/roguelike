/**
 * The band above the horizon, and the 360 degrees of it you cannot see at once.
 *
 * Everything up here lives at a *bearing* rather than at a screen x, and
 * `panorama.ts` converts. That single change is what makes the planet read as
 * round: strafe and the ridge, the stars and every distant landmark slide
 * together by the same whole number of pixels, keep sliding as you keep
 * walking, and come back round to where they started after one lap of the
 * sideways circle.
 *
 * It is also the only part of the world that shows the turn *continuously*. The
 * ground is a grid and turns in whole tiles once a step (`terrain.ts` says why);
 * the sky has no grid, no foreshortening and no seams to keep square, so it gets
 * the exact angle every frame. The two are reconciled by distance - nobody can
 * measure a boulder against a mountain - and the smooth half is the half the eye
 * actually reads.
 *
 * The layers, back to front, all of them over the field:
 *
 *     sky bands + roll       opaque; this is what crops the world at the horizon
 *     stars                  scroll with the bearing
 *     far ridge              seamless noise profile, scrolls
 *     near ridge             the same, darker and shorter
 *     pines and towers       authored art standing on the horizon line
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
import {
  bearingOffset,
  landmarkRing,
  landmarkX,
  panoramaColumn,
  panoramaRidge,
  PANORAMA_WIDTH,
} from "./panorama";
import { FAR_PINE_FRAMES } from "./sprites";

const RIDGE_FAR = { seed: 7, base: 3, amplitude: 3, wavelength: 55, color: "#0d1830" } as const;
const RIDGE_NEAR = { seed: 21, base: 1, amplitude: 3, wavelength: 26, color: "#08101e" } as const;

/**
 * The band draws **over** the field, not behind it.
 *
 * That reads backwards and is not. The tile grid is cut to cover the render
 * target with a cell of margin on every side (`visibleLocal`), and a cell is
 * anchored by its *foot*, so the topmost row necessarily hangs above
 * `groundTop` - and it has to, or the far edge of the field tears open a
 * tile-high gap every time a stride scrolls it down. Painting the horizon on
 * top is what turns that overhang into what it should be: ground that has gone
 * over the hill. Anything else the field puts up there - a tall tree on the far
 * row, a rock cap - is beyond the horizon too, and is hidden for the same
 * reason.
 *
 * Above the whole world (the deepest world rank is about 300) and below the
 * weather, which falls in front of the sky and always did.
 */
const BAND_DEPTH = 1000;

/** Distant things, spread round the full turn rather than across one screen. */
const PINE_COUNT = 16;
const TOWER_COUNT = 3;

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
  private pineAt: readonly number[] = [];
  private towerAt: readonly number[] = [];

  private starGfx!: Phaser.GameObjects.Graphics;
  private ridgeGfx!: Phaser.GameObjects.Graphics;
  private pines: Phaser.GameObjects.Image[] = [];
  private towers: Phaser.GameObjects.Image[] = [];

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

    this.pineAt = landmarkRing(PINE_COUNT, 0x2f10);
    this.towerAt = landmarkRing(TOWER_COUNT, 0x51c3);
    this.pines = this.pineAt.map(() =>
      scene.add.image(0, layout.horizonY, "far-pine-0").setOrigin(0.5, 1).setDepth(BAND_DEPTH + 3),
    );
    this.towers = this.towerAt.map(() =>
      scene.add.image(0, layout.horizonY, "far-tower").setOrigin(0.5, 1).setDepth(BAND_DEPTH + 3),
    );
  }

  /** One frame of horizon, for a heading. */
  animate(turn: number, elapsedMs: number): void {
    const offset = bearingOffset(turn);
    this.drawStars(offset);
    this.drawRidges(offset);
    this.placeLandmarks(offset, elapsedMs);
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

  /**
   * Pines and towers, placed by bearing and hidden when they are behind you.
   *
   * The margin is generous on purpose: an image with a 0.5 origin is half off
   * the edge before it has left the screen, and a pine that vanishes a pixel
   * early reads as a pop rather than as a walk.
   */
  private placeLandmarks(offset: number, elapsedMs: number): void {
    const frameMs = 600;
    this.pines.forEach((pine, index) => {
      const x = landmarkX(this.pineAt[index] ?? 0, offset);
      const frame = Math.floor((elapsedMs + index * 900) / frameMs) % FAR_PINE_FRAMES.length;
      pine
        .setTexture(`far-pine-${frame}`)
        .setX(x)
        .setVisible(x > -24 && x < this.width + 24);
    });

    this.towers.forEach((tower, index) => {
      const x = landmarkX(this.towerAt[index] ?? 0, offset);
      tower.setX(x).setVisible(x > -32 && x < this.width + 32);
    });
  }
}
