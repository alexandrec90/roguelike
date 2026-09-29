import { describe, expect, it } from "vitest";

import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { demoTerrain, syntheticSample } from "./field-preview";
import { FACE_TOP, planGround, rowSignature } from "./ground-plan";
import { cellTerrain, ROCK } from "./ground-sample";
import { unpackGroundKey } from "./ground-tiles";
import { ROCK_EAST, ROCK_NORTH, ROCK_SOUTH, ROCK_WEST, unpackCapKey, unpackFaceKey } from "./rock-tiles";

const sample = syntheticSample(14, 9, demoTerrain);
const plan = planGround(sample);

describe("the ground plan", () => {
  it("covers the grid exactly once with ground tiles", () => {
    expect(plan.width).toBe(14 * TILE_WIDTH);
    expect(plan.height).toBe(9 * TILE_DEPTH);
    expect(plan.ground).toHaveLength(14 * 9);
    const spots = new Set(plan.ground.map((cell) => `${cell.x},${cell.y}`));
    expect(spots.size).toBe(14 * 9);
    for (const cell of plan.ground) {
      expect(cell.x % TILE_WIDTH).toBe(0);
      expect(cell.y % TILE_DEPTH).toBe(0);
    }
  });

  it("stands a cap on every rock cell, and a face only where the ground in front is open", () => {
    let caps = 0;
    for (const row of plan.rockRows) {
      caps += row.caps.length;
      for (const face of row.faces) {
        const x = face.x / TILE_WIDTH;
        expect(face.y).toBe(FACE_TOP);
        expect(cellTerrain(sample, x, row.localY)).toBe(ROCK);
        expect(cellTerrain(sample, x, row.localY - 1)).not.toBe(ROCK);
      }
    }
    let rock = 0;
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 14; x += 1) {
        rock += cellTerrain(sample, x, y) === ROCK ? 1 : 0;
      }
    }
    expect(rock).toBeGreaterThan(3);
    expect(caps).toBe(rock);
  });

  it("tells each cap which of its neighbours are rock", () => {
    for (const row of plan.rockRows) {
      for (const cap of row.caps) {
        const x = cap.x / TILE_WIDTH;
        const { rock } = unpackCapKey(cap.key);
        expect((rock & ROCK_NORTH) !== 0).toBe(cellTerrain(sample, x, row.localY + 1) === ROCK);
        expect((rock & ROCK_SOUTH) !== 0).toBe(cellTerrain(sample, x, row.localY - 1) === ROCK);
        if (x > 0 && x < 13) {
          expect((rock & ROCK_EAST) !== 0).toBe(cellTerrain(sample, x + 1, row.localY) === ROCK);
          expect((rock & ROCK_WEST) !== 0).toBe(cellTerrain(sample, x - 1, row.localY) === ROCK);
        }
      }
      for (const face of row.faces) {
        const x = face.x / TILE_WIDTH;
        if (x > 0 && x < 13) {
          expect(unpackFaceKey(face.key).openLeft).toBe(cellTerrain(sample, x - 1, row.localY) !== ROCK);
        }
      }
    }
  });

  it("marks path nodes and the contact shadow in front of rock", () => {
    const pathKeys = plan.ground.filter((cell) => unpackGroundKey(cell.key).dirt !== 0);
    expect(pathKeys.length).toBeGreaterThan(9);
    const shaded = plan.ground.filter((cell) => unpackGroundKey(cell.key).shade !== 0);
    expect(shaded.length).toBeGreaterThan(0);
    for (const cell of shaded) {
      const x = cell.x / TILE_WIDTH;
      const y = 8 - cell.y / TILE_DEPTH;
      expect(cellTerrain(sample, x, y)).not.toBe(ROCK);
    }
  });

  it("signs a row by its content, so an unchanged row is not re-uploaded", () => {
    const again = planGround(sample);
    plan.rockRows.forEach((row, index) => {
      expect(rowSignature(again.rockRows[index]!)).toBe(rowSignature(row));
    });
    const withRock = plan.rockRows.filter((row) => row.caps.length > 0).map(rowSignature);
    expect(new Set(withRock).size).toBe(withRock.length);
  });
});
