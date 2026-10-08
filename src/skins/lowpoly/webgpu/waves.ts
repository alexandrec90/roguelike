/**
 * Water that moves because it is simulated: the wave equation on a height grid.
 *
 * This is the CPU reference for the compute shader in `wave-sim.ts`, line for
 * line, and the place its numbers are tested. The GPU runs it; nothing in the
 * game runs this one except the tests.
 *
 * The grid is **planet-fixed and toroidal**: cell `(i, j)` of an `N × N` buffer
 * holds every planet cell whose index is `(i, j)` modulo `N`, and at any moment
 * means the one nearest the hero (`windowCell`). So the hero can walk forever
 * and the buffer never moves: cells he walks away from become the cells ahead
 * of him, cleared on the step they change meaning. `N` divides the planet's own
 * cell count, so the grid's wrap and the planet's agree.
 *
 * Each cell holds its height now and a step ago. A step is
 *
 *     next = (2·h − h_prev + k·(h_left + h_right + h_up + h_down − 4h)) · damp
 *
 * with `k = (speed · dt / dx)²`. Dry cells - grass, rock - are held at zero,
 * which is what makes a ring bounce off a puddle's shore rather than run on
 * across the field.
 */

import { PLANET_TILES } from "../../../game/planet";

/**
 * Grid cells per tile, each axis. A ring can be no thinner than a few cells, so
 * this is what decides whether a disturbance reads as a ring or as a blob: at 8
 * a footstep's wake was fat, smooth bulges - molten metal, not water.
 */
export const WAVE_RES = 16;

/**
 * Cells per side of the grid: 32 tiles of the planet, centred on the hero -
 * the whole flat field (`fieldRows`, ±10 tiles across), and the near lip.
 */
export const WAVE_N = 512;

/** Cells per side of the planet at this resolution - the grid divides it. */
export const PLANET_CELLS = PLANET_TILES * WAVE_RES;

/**
 * How fast a ring spreads, tiles a second. A slow ring reads as something
 * thicker than water - molten metal - and a quick one spreads thin before the
 * damping takes it, so a drop shows as a ring rather than as a dent.
 */
export const WAVE_SPEED = 1.6;

/** One step of the simulation, seconds: fixed, so a slow frame takes more steps rather than a bigger one. */
export const WAVE_STEP_S = 1 / 120;

/** Most steps a frame may take; a longer frame drops the rest rather than spiralling. */
export const MAX_WAVE_STEPS = 4;

/** Share of its height a wave keeps each step: shallow puddles calm fast. */
export const WAVE_DAMP = 0.995;

/** `(speed · dt / dx)²`: under 0.5 the scheme is stable, and it is far under. */
export const WAVE_K = (WAVE_SPEED * WAVE_STEP_S * WAVE_RES) ** 2;

/** Raindrops per tile of water per second at full rain. */
export const DROPS_PER_TILE_S = 1.5;

/** Chance a cell is struck by a drop in one step, at full rain. */
export const DROP_CHANCE = (DROPS_PER_TILE_S * WAVE_STEP_S) / (WAVE_RES * WAVE_RES);

/** How far a drop pushes its cell down; its neighbours go half as far, the corners a quarter. */
export const DROP_KICK = 0.25;

/** The planet cell, nearest the hero's cell, that buffer index `index` stands for this step. */
export function windowCell(index: number, heroCell: number, n: number = WAVE_N): number {
  const offset = ((((index - heroCell) % n) + n + n / 2) % n) - n / 2;
  return heroCell + offset;
}

/** A planet cell's buffer index. */
export function bufferIndex(cell: number, n: number = WAVE_N): number {
  return ((cell % n) + n) % n;
}

/** The hero's planet cell on one axis. */
export function heroCellOf(tiles: number): number {
  const cell = Math.floor(tiles * WAVE_RES);
  return ((cell % PLANET_CELLS) + PLANET_CELLS) % PLANET_CELLS;
}

/**
 * Whether buffer index `index` changed meaning between two hero cells - it has
 * just come into the window at the far side, and what it held belongs to a
 * place behind him. Such a cell starts again from still water.
 */
export function cellRecycled(index: number, heroCell: number, previousHeroCell: number, n: number = WAVE_N): boolean {
  return windowCell(index, heroCell, n) !== windowCell(index, previousHeroCell, n);
}

/**
 * One step of the wave equation over an `n × n` grid of interleaved
 * `(height, previous)` pairs, from `source` into `target`. `wet(i, j)` says
 * whether a cell holds water; one that does not is held at zero. Neighbours
 * wrap, as the buffer does.
 */
export function stepWaveGrid(
  source: Float32Array,
  target: Float32Array,
  n: number,
  wet: (i: number, j: number) => boolean,
): void {
  const at = (i: number, j: number): number => source[(bufferIndex(j, n) * n + bufferIndex(i, n)) * 2] ?? 0;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const cell = (j * n + i) * 2;
      const h = source[cell] ?? 0;
      const previous = source[cell + 1] ?? 0;
      const laplacian = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1) - 4 * h;
      const next = (2 * h - previous + WAVE_K * laplacian) * WAVE_DAMP;
      target[cell] = wet(i, j) ? next : 0;
      target[cell + 1] = wet(i, j) ? h : 0;
    }
  }
}
