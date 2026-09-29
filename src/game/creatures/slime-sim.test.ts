import { describe, expect, it } from "vitest";

import type { Strike } from "../combat";
import { fromLocal, type PlanetPose } from "../planet";
import { HURT_MS, SLIME_HP } from "./slime-brain";
import { planetDistance } from "./slime-spawn";
import {
  createSlimeSim,
  DESPAWN_REACH,
  MAX_SLIMES,
  nearestSlime,
  occupiedNear,
  RESPAWN_MS,
  spawnSlime,
  stepSlimes,
  type SlimeEvents,
  type SlimeSim,
} from "./slime-sim";

const OPEN = (): boolean => false;
const POSE: PlanetPose = { x: 100, y: 100, turn: 0 };
const HERO = { x: 0, y: 0 };

/** A sim with no dens stocking themselves, and one slime a tile to the hero's right. */
function lone(pose: PlanetPose = POSE): { sim: SlimeSim; id: number } {
  const sim = createSlimeSim({ blocked: OPEN });
  sim.sweepMs = Number.POSITIVE_INFINITY;
  const slime = spawnSlime(sim, fromLocal(pose, { x: 1, y: 0 }), { seed: 9, variant: "green" });
  slime.waitMs = Number.POSITIVE_INFINITY;
  return { sim, id: slime.id };
}

function step(sim: SlimeSim, strikes: Strike[] = [], deltaMs = 16, pose = POSE): SlimeEvents {
  return stepSlimes(sim, { pose, hero: HERO, strikes, deltaMs });
}

const SWORD: Strike = { at: { x: 0.6, y: 0 }, radius: 0.8, damage: 1, element: "steel", push: { x: 4, y: 0 } };

describe("the population", () => {
  it("stocks the dens near the hero, never past the cap", () => {
    const sim = createSlimeSim({ blocked: OPEN });
    for (let frame = 0; frame < 30; frame += 1) {
      step(sim);
    }
    expect(sim.slimes.length).toBeGreaterThan(0);
    expect(sim.slimes.length).toBeLessThanOrEqual(MAX_SLIMES);
  });

  it("lets far slimes go when the hero walks away", () => {
    const sim = createSlimeSim({ blocked: OPEN });
    step(sim);
    const far: PlanetPose = { x: POSE.x + DESPAWN_REACH * 3, y: POSE.y, turn: 0 };
    for (let frame = 0; frame < 30; frame += 1) {
      step(sim, [], 16, far);
    }
    const hero = fromLocal(far, HERO);
    for (const slime of sim.slimes) {
      expect(planetDistance(slime.at, hero)).toBeLessThanOrEqual(DESPAWN_REACH + 1);
    }
  });

  it("is deterministic: the same frames make the same world", () => {
    const run = (): string => {
      const sim = createSlimeSim({ blocked: OPEN });
      for (let frame = 0; frame < 400; frame += 1) {
        step(sim, frame === 200 ? [{ ...SWORD, radius: 6 }] : []);
      }
      return JSON.stringify(sim.slimes.map((slime) => [slime.id, slime.at, slime.mode, slime.hp]));
    };
    expect(run()).toBe(run());
  });

  it("restocks a den some seconds after its slime died", () => {
    const sim = createSlimeSim({ blocked: OPEN });
    step(sim);
    const victim = sim.slimes[0];
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    victim.hp = 1;
    const strike: Strike = { at: victim.local, radius: 0.3, damage: 5, element: "steel" };
    const events = step(sim, [strike]);
    expect(events.deaths.some((death) => death.id === victim.id)).toBe(true);
    for (let t = 0; t < RESPAWN_MS * 1.6; t += 50) {
      step(sim, [], 50);
    }
    const restocked = sim.slimes.find((slime) => slime.den === victim.den && slime.id !== victim.id);
    expect(restocked).toBeDefined();
  });
});

describe("strikes", () => {
  it("hurt, flash and knock back a slime in reach, and report the hit where it was", () => {
    const { sim, id } = lone();
    const events = step(sim, [SWORD]);
    expect(events.hits).toHaveLength(1);
    const hit = events.hits[0];
    expect(hit?.id).toBe(id);
    expect(hit?.at.x).toBeCloseTo(1, 5);
    expect(hit?.killed).toBe(false);
    const slime = sim.slimes[0];
    expect(slime?.hp).toBe(SLIME_HP - 1);
    expect(slime?.mode).toBe("hurt");
    const before = slime?.local.x ?? 0;
    for (let frame = 0; frame < 10; frame += 1) {
      step(sim);
    }
    expect(sim.slimes[0]?.local.x ?? 0).toBeGreaterThan(before + 0.2);
  });

  it("miss a slime out of reach", () => {
    const { sim } = lone();
    expect(step(sim, [{ ...SWORD, at: { x: -3, y: 0 } }]).hits).toHaveLength(0);
  });

  it("cannot hit twice within the stun", () => {
    const { sim } = lone();
    step(sim, [SWORD]);
    expect(step(sim, [SWORD]).hits).toHaveLength(0);
    for (let t = 0; t < HURT_MS + 50; t += 16) {
      step(sim);
    }
    // It has slid out of the sword's reach; bring the blow to it.
    const at = sim.slimes[0]?.local ?? HERO;
    expect(step(sim, [{ ...SWORD, at }]).hits).toHaveLength(1);
  });

  it("kill at zero hit points, and report the death once", () => {
    const { sim, id } = lone();
    const events = step(sim, [{ ...SWORD, damage: SLIME_HP }]);
    expect(events.hits[0]?.killed).toBe(true);
    expect(events.deaths.map((death) => death.id)).toEqual([id]);
    expect(step(sim, [{ ...SWORD, damage: SLIME_HP }]).deaths).toHaveLength(0);
  });

  it("push in the local frame whichever way the hero faces", () => {
    const turned: PlanetPose = { ...POSE, turn: 1.1 };
    const { sim } = lone(turned);
    step(sim, [SWORD], 16, turned);
    for (let frame = 0; frame < 10; frame += 1) {
      step(sim, [], 16, turned);
    }
    const local = sim.slimes[0]?.local ?? HERO;
    expect(local.x).toBeGreaterThan(1.2);
    expect(Math.abs(local.y)).toBeLessThan(0.05);
  });

  it("do nothing to a fire slime made of fire, and double to it from frost", () => {
    const sim = createSlimeSim({ blocked: OPEN });
    sim.sweepMs = Number.POSITIVE_INFINITY;
    spawnSlime(sim, fromLocal(POSE, { x: 1, y: 0 }), { variant: "fire" });
    expect(step(sim, [{ ...SWORD, element: "fire" }]).hits[0]?.damage).toBe(0);
    for (let t = 0; t < HURT_MS + 50; t += 16) {
      step(sim);
    }
    const at = sim.slimes[0]?.local ?? HERO;
    expect(step(sim, [{ ...SWORD, at, element: "frost" }]).hits[0]?.damage).toBe(2);
  });
});

describe("queries", () => {
  it("find the slime nearest a point, and whether one is close", () => {
    const { sim, id } = lone();
    step(sim);
    expect(nearestSlime(sim, { x: 3, y: 0 })?.slime.id).toBe(id);
    expect(occupiedNear(sim, { x: 1.2, y: 0 }, 0.2)).toBe(true);
    expect(occupiedNear(sim, { x: 5, y: 5 }, 0.5)).toBe(false);
  });

  it("ignore a dying slime", () => {
    const { sim } = lone();
    step(sim, [{ ...SWORD, damage: SLIME_HP }]);
    expect(nearestSlime(sim, HERO)).toBeNull();
    expect(occupiedNear(sim, { x: 1, y: 0 }, 1)).toBe(false);
  });
});
