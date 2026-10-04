import { describe, expect, it } from "vitest";

import { planetLakes } from "./lakes";
import { terrainAt } from "./terrain";
import {
  BURN_MS,
  burningCells,
  createWildfire,
  douse,
  flameAt,
  ignite,
  MAX_BURNING,
  MAX_GENERATION,
  REGROW_MS,
  scorchAt,
  scorchedCells,
  stepWildfire,
  WILDFIRE_TICK_MS,
} from "./wildfire";

/** The centre of a grass cell whose whole neighbourhood is grass. */
function meadow(): { x: number; y: number } {
  for (let y = 100; y < 200; y += 1) {
    for (let x = 100; x < 200; x += 1) {
      let open = true;
      for (let dy = -6; dy <= 6 && open; dy += 1) {
        for (let dx = -6; dx <= 6 && open; dx += 1) {
          open = terrainAt({ x: x + dx + 0.5, y: y + dy + 0.5 }) === "grass";
        }
      }
      if (open) {
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  throw new Error("no meadow near the start");
}

const FIELD = meadow();

function run(fire: ReturnType<typeof createWildfire>, ms: number, rain = 0, wind = 0): void {
  for (let spent = 0; spent < ms; spent += 20) {
    stepWildfire(fire, 20, rain, wind);
  }
}

describe("wildfire", () => {
  it("catches in grass and nowhere else", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 0.6);
    expect(burningCells(fire).length).toBeGreaterThan(0);
    for (const cell of burningCells(fire)) {
      expect(terrainAt({ x: cell.x + 0.5, y: cell.y + 0.5 })).toBe("grass");
    }
  });

  it("never catches on a lake, whatever grass the path field says lies under it", () => {
    for (const lake of planetLakes().slice(0, 6)) {
      const fire = createWildfire();
      // A spark wide enough to reach every cell whose centre is in the water, and no farther.
      ignite(fire, lake, Math.max(lake.shore - 1, 0));
      expect(burningCells(fire)).toEqual([]);
    }
  });

  it("spreads, but only a few cells from its spark", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 0);
    run(fire, BURN_MS * 3);
    const cells = scorchedCells(fire);
    expect(cells.length).toBeGreaterThan(1);
    for (const cell of cells) {
      expect(cell.generation).toBeLessThanOrEqual(MAX_GENERATION);
      expect(Math.abs(cell.x + 0.5 - FIELD.x) + Math.abs(cell.y + 0.5 - FIELD.y)).toBeLessThanOrEqual(
        MAX_GENERATION + 0.01,
      );
    }
  });

  it("does not spread in rain, and burns out", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 0);
    run(fire, BURN_MS * 2, 1);
    expect(scorchedCells(fire)).toHaveLength(1);
    expect(burningCells(fire)).toHaveLength(0);
  });

  it("flares up and dies down, and leaves a scar that regrows", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 0);
    const [cell] = burningCells(fire);
    run(fire, WILDFIRE_TICK_MS * 4, 1);
    expect(flameAt(fire, cell!)).toBeGreaterThan(0.5);
    expect(scorchAt(fire, FIELD)).toBe(1);
    run(fire, BURN_MS, 1);
    expect(flameAt(fire, cell!)).toBe(0);
    expect(scorchAt(fire, FIELD)).toBeGreaterThan(0.8);
    run(fire, REGROW_MS + 1000, 1);
    expect(scorchAt(fire, FIELD)).toBe(0);
    expect(scorchedCells(fire)).toHaveLength(0);
  });

  it("never has more than the cap alight", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 5);
    run(fire, WILDFIRE_TICK_MS * 2);
    expect(burningCells(fire).length).toBeLessThanOrEqual(MAX_BURNING);
  });

  it("goes out where it is doused, and only there", () => {
    const fire = createWildfire();
    ignite(fire, FIELD, 1);
    ignite(fire, { x: FIELD.x + 5, y: FIELD.y }, 0);
    douse(fire, FIELD, 1.5);
    const alight = burningCells(fire);
    expect(alight).toHaveLength(1);
    expect(alight[0]!.x).toBe(Math.floor(FIELD.x + 5));
  });

  it("replays identically", () => {
    const one = createWildfire();
    const two = createWildfire();
    ignite(one, FIELD, 1);
    ignite(two, FIELD, 1);
    run(one, 2500, 0, 0.8);
    run(two, 2500, 0, 0.8);
    expect([...one.cells.keys()].sort()).toEqual([...two.cells.keys()].sort());
  });
});
