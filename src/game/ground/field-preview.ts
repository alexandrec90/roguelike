/**
 * A patch of meadow composed exactly as the game composes it, for the lab.
 *
 * Single tiles cannot show the two things that matter most about the ground:
 * that neighbours meet without a seam, and that a path winds instead of
 * stepping. So the lab also gets a whole field - a synthetic lattice with a
 * meandering path - run through the same `planGround`, the same tiles and the
 * same tuft placement as the layers, and stamped in the same painter's order
 * (ground, then each row's grass far to near).
 */

import type { LocalBounds } from "../camera";
import { familyRamp, type Family } from "../palette";
import type { InkId } from "../ink";
import type { PlanetPose } from "../planet";
import { WALL_RISE } from "../projection";
import { windAt } from "../wind";
import { planGround } from "./ground-plan";
import { DIRT, GRASS, planetHash, type GroundSample, type TerrainCode } from "./ground-sample";
import { groundTile, unpackGroundKey } from "./ground-tiles";
import { createGrid, gridAt, setGrid, stampGrid, type InkGrid } from "./ink-grid";
import { placeTufts, windBetween, windGrid } from "./tuft-placement";
import { bendFrame, TUFT_SHAPES, tuftCloud } from "./tufts";

/** Scanlines of room over the far row, for its tallest blades; the frame the lab has always shown. */
const HEADROOM = WALL_RISE;

/** A field of `columns` x `rows` cells whose terrain is `terrain(x, y)` in local tiles. */
export function syntheticSample(
  columns: number,
  rows: number,
  terrain: (x: number, y: number) => TerrainCode,
): GroundSample {
  const bounds: LocalBounds = { minX: 0, maxX: columns - 1, minY: 0, maxY: rows - 1 };
  const latticeWidth = columns * 2 + 1;
  const latticeHeight = rows * 2 + 1;
  const size = latticeWidth * latticeHeight;
  const sample = {
    pose: { x: 0, y: 0, turn: 0 } as PlanetPose,
    bounds,
    columns,
    rows,
    latticeWidth,
    latticeHeight,
    terrain: new Uint8Array(size),
    hashes: new Uint32Array(size),
    planetX: new Float32Array(size),
    planetY: new Float32Array(size),
  };
  for (let b = 0; b < latticeHeight; b += 1) {
    for (let a = 0; a < latticeWidth; a += 1) {
      const x = -0.5 + a / 2;
      const y = b / 2;
      const index = b * latticeWidth + a;
      sample.terrain[index] = terrain(x, y);
      sample.hashes[index] = planetHash(x + 40, y + 40);
      sample.planetX[index] = x + 40;
      sample.planetY[index] = y + 40;
    }
  }
  return sample;
}

/** The demo field: a path that meanders down the patch. */
export function demoTerrain(x: number, y: number): TerrainCode {
  const pathCentre = 3.2 + 1.8 * Math.sin(y / 1.7) + 0.6 * Math.sin(y * 1.3);
  return Math.abs(x - pathCentre) < 0.62 ? DIRT : GRASS;
}

/** A shadow pixel over a ramp ink is that ink one step down its own ramp. */
function shaded(under: InkId | null): InkId | null {
  if (under === null) {
    return null;
  }
  const cut = under.lastIndexOf("-");
  const family = under.slice(0, cut) as Family;
  const index = Number(under.slice(cut + 1));
  if (!Number.isInteger(index) || index <= 0) {
    return under;
  }
  return (familyRamp(family)[index - 1] as InkId | undefined) ?? under;
}

/**
 * Compose the field at a moment of wind. The grid is `HEADROOM` taller than
 * the ground, at the top, so the far row's grass has room to rise.
 */
export function composeField(sample: GroundSample, elapsedMs: number): InkGrid {
  const plan = planGround(sample);
  const grid = createGrid(plan.width, plan.height + HEADROOM);
  for (const cell of plan.ground) {
    stampGrid(grid, groundTile(unpackGroundKey(cell.key)), cell.x, cell.y + HEADROOM);
  }
  const wind = windGrid(sample);
  wind.value.forEach((_value, index) => {
    wind.value[index] = windAt(elapsedMs, wind.x[index] ?? 0, wind.y[index] ?? 0);
  });
  const tufts = placeTufts(sample);
  for (let localY = sample.bounds.maxY; localY >= sample.bounds.minY; localY -= 1) {
    for (const tuft of tufts) {
      if (tuft.localY !== localY) {
        continue;
      }
      const bend = windBetween(wind, tuft.windU, tuft.windV) * 4 * tuft.flex;
      const shape = TUFT_SHAPES[tuft.shape];
      if (shape === undefined) {
        continue;
      }
      for (const pixel of tuftCloud(shape, bendFrame(bend))) {
        const x = tuft.x + pixel.x;
        const y = tuft.y + HEADROOM + pixel.y;
        const ink = pixel.ink === "shadow-soft" ? shaded(gridAt(grid, x, y)) : pixel.ink;
        setGrid(grid, x, y, ink);
      }
    }
  }
  return grid;
}
