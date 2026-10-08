import { describe, expect, it } from "vitest";

import {
  bufferIndex,
  cellRecycled,
  heroCellOf,
  PLANET_CELLS,
  stepWaveGrid,
  WAVE_K,
  WAVE_N,
  WAVE_RES,
  windowCell,
} from "./waves";

const N = 32;

/** Run `steps` from a single raised cell in the middle; return the final grid. */
function ring(steps: number, wet: (i: number, j: number) => boolean = () => true): Float32Array {
  let a = new Float32Array(N * N * 2);
  let b = new Float32Array(N * N * 2);
  a[(16 * N + 16) * 2] = 1;
  for (let step = 0; step < steps; step += 1) {
    stepWaveGrid(a, b, N, wet);
    [a, b] = [b, a];
  }
  return a;
}

const height = (grid: Float32Array, i: number, j: number): number => grid[(j * N + i) * 2] ?? 0;

describe("the wave grid", () => {
  it("is stable: the scheme's coefficient is well inside the limit", () => {
    expect(WAVE_K).toBeLessThan(0.5);
    expect(PLANET_CELLS % WAVE_N).toBe(0);
  });

  it("spreads a disturbance as a ring, the same every way, and lets it die down", () => {
    const grid = ring(200);
    expect(height(grid, 20, 16)).toBeCloseTo(height(grid, 12, 16), 6);
    expect(height(grid, 16, 20)).toBeCloseTo(height(grid, 16, 12), 6);
    expect(height(grid, 20, 16)).not.toBe(0);
    const energy = (g: Float32Array): number => g.reduce((sum, value, index) => (index % 2 === 0 ? sum + value * value : sum), 0);
    expect(energy(ring(800))).toBeLessThan(energy(ring(100)));
  });

  it("holds dry ground still, so a ring stops at the shore", () => {
    const shore = (i: number): boolean => i < 20;
    const grid = ring(400, shore);
    for (let j = 0; j < N; j += 1) {
      expect(height(grid, 25, j)).toBe(0);
    }
    expect(height(grid, 18, 16)).not.toBe(0);
  });
});

describe("the toroidal window", () => {
  it("maps each buffer index to the planet cell of that index nearest the hero", () => {
    const hero = 1000;
    for (const index of [0, 7, 255, 256, 511]) {
      const cell = windowCell(index, hero);
      expect(bufferIndex(cell)).toBe(index);
      expect(Math.abs(cell - hero)).toBeLessThanOrEqual(WAVE_N / 2);
    }
  });

  it("recycles only the cells the hero's step brought in at the far side", () => {
    const before = 1000;
    const after = 1001;
    let recycled = 0;
    for (let index = 0; index < WAVE_N; index += 1) {
      recycled += cellRecycled(index, after, before) ? 1 : 0;
    }
    expect(recycled).toBe(1);
    expect(cellRecycled(bufferIndex(before - WAVE_N / 2), after, before)).toBe(true);
    expect(cellRecycled(bufferIndex(after), after, before)).toBe(false);
  });

  it("finds the hero's cell on the planet, wrapped", () => {
    expect(heroCellOf(1.5)).toBe(1.5 * WAVE_RES);
    expect(heroCellOf(-1 / WAVE_RES)).toBe(PLANET_CELLS - 1);
    expect(heroCellOf(256)).toBe(0);
  });
});
