import { describe, expect, it } from "vitest";

import type { PlanetPoint } from "../planet";
import {
  chooseHop,
  createSlime,
  DYING_MS,
  EMERGE_MS,
  HURT_MS,
  KEEP_DISTANCE,
  stepSlime,
  type BrainWorld,
  type Slime,
} from "./slime-brain";
import { HOP_MAX, HOP_TOTAL_MS } from "./slime-motion";
import { planetDistance } from "./slime-spawn";

const OPEN = (): boolean => false;
const START: PlanetPoint = { x: 50, y: 50 };

function world(hero: PlanetPoint, blocked: BrainWorld["blocked"] = OPEN, others: Slime[] = []): BrainWorld {
  return { hero, blocked, others };
}

function run(slime: Slime, w: BrainWorld, ms: number, step = 16): { landings: number } {
  let landings = 0;
  for (let t = 0; t < ms; t += step) {
    if (stepSlime(slime, w, step).landed) {
      landings += 1;
    }
  }
  return { landings };
}

describe("a slime left alone", () => {
  it("sits, then hops, and lands", () => {
    const slime = createSlime(1, START, 99, "green");
    const { landings } = run(slime, world({ x: 90, y: 90 }), 6000);
    expect(landings).toBeGreaterThan(0);
    expect(slime.aware).toBe(false);
  });

  it("stays leashed near where it was spawned", () => {
    const slime = createSlime(1, START, 7, "green");
    for (let t = 0; t < 60000; t += 16) {
      stepSlime(slime, world({ x: 90, y: 90 }), 16);
      expect(planetDistance(slime.at, START)).toBeLessThan(3 + HOP_MAX + 0.01);
    }
  });

  it("lives the same life for the same seed", () => {
    const a = createSlime(1, START, 42, "green");
    const b = createSlime(1, START, 42, "green");
    run(a, world({ x: 90, y: 90 }), 5000);
    run(b, world({ x: 90, y: 90 }), 5000);
    expect(a.at).toEqual(b.at);
    expect(a.squash).toEqual(b.squash);
  });
});

describe("a slime that has seen the hero", () => {
  it("hops toward him and then keeps a small distance", () => {
    const hero = { x: START.x + 4, y: START.y };
    const slime = createSlime(1, START, 5, "green");
    run(slime, world(hero), 8000);
    expect(slime.aware).toBe(true);
    const distance = planetDistance(slime.at, hero);
    expect(distance).toBeLessThan(KEEP_DISTANCE + 0.9);
    expect(distance).toBeGreaterThan(0.4);
  });

  it("lifts off the ground only during the flight of a hop", () => {
    const slime = createSlime(1, START, 5, "green");
    slime.waitMs = 0;
    const w = world({ x: START.x + 4, y: START.y });
    stepSlime(slime, w, 16);
    expect(slime.mode).toBe("hop");
    let highest = 0;
    for (let t = 0; t < HOP_TOTAL_MS; t += 16) {
      stepSlime(slime, w, 16);
      highest = Math.max(highest, slime.lift);
    }
    expect(highest).toBeGreaterThan(4);
    expect(slime.lift).toBe(0);
  });
});

describe("hop choice", () => {
  it("never lands on rock or crosses it", () => {
    const rock = (point: PlanetPoint): boolean => point.x > START.x + 0.3;
    const slime = createSlime(1, START, 3, "green");
    for (let t = 0; t < 30000; t += 16) {
      stepSlime(slime, world({ x: START.x + 5, y: START.y }, rock), 16);
      expect(rock(slime.at)).toBe(false);
    }
  });

  it("gives up rather than hopping into a wall on every side", () => {
    const slime = createSlime(1, START, 3, "green");
    expect(chooseHop(slime, world({ x: 60, y: 60 }, () => true))).toBeNull();
  });

  it("will not land on top of another slime", () => {
    const slime = createSlime(1, START, 3, "green");
    slime.aware = true;
    const hero = { x: START.x + 1.9, y: START.y };
    const blocker = createSlime(2, { x: START.x + 0.8, y: START.y }, 4, "green");
    const target = chooseHop(slime, world(hero, OPEN, [slime, blocker]));
    expect(target).not.toBeNull();
    if (target !== null) {
      expect(planetDistance(target, blocker.at)).toBeGreaterThanOrEqual(0.75);
    }
  });
});

describe("modes over time", () => {
  it("rises from emerge to idle", () => {
    const slime = createSlime(1, START, 3, "green", { mode: "emerge" });
    run(slime, world({ x: 90, y: 90 }), EMERGE_MS + 32);
    expect(slime.mode).not.toBe("emerge");
  });

  it("recovers from a hurt", () => {
    const slime = createSlime(1, START, 3, "green", { mode: "hurt" });
    run(slime, world({ x: 90, y: 90 }), HURT_MS + 32);
    expect(slime.mode).not.toBe("hurt");
  });

  it("reports itself gone once the puddle has dried", () => {
    const slime = createSlime(1, START, 3, "green", { mode: "dying" });
    let gone = false;
    for (let t = 0; t <= DYING_MS + 32 && !gone; t += 16) {
      gone = stepSlime(slime, world({ x: 90, y: 90 }), 16).gone;
    }
    expect(gone).toBe(true);
  });

  it("slides under knockback but stops dead at rock", () => {
    const slime = createSlime(1, START, 3, "green", { mode: "hurt" });
    slime.knockX = 4;
    const rock = (point: PlanetPoint): boolean => point.x > START.x + 0.2;
    run(slime, world({ x: 90, y: 90 }, rock), 300);
    expect(slime.at.x).toBeLessThanOrEqual(START.x + 0.2);
    expect(slime.knockX).toBe(0);
  });

  it("runs slow while chilled", () => {
    const quick = createSlime(1, START, 3, "green", { mode: "hop" });
    const slow = createSlime(1, START, 3, "green", { mode: "hop" });
    quick.hopTo = slow.hopTo = { x: START.x + 1, y: START.y };
    slow.chillMs = 5000;
    run(quick, world({ x: 90, y: 90 }), 400);
    run(slow, world({ x: 90, y: 90 }), 400);
    expect(slow.modeMs).toBeLessThan(quick.modeMs);
  });
});
