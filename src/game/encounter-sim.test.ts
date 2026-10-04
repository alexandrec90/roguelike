import { describe, expect, it } from "vitest";

import { spawnSlime } from "./creatures/slime-sim";
import { BURST_MS, EncounterSim } from "./encounter-sim";
import { HeroDriver } from "./hero/hero-driver";
import { pressKey, releaseKey } from "./controls";
import { dryGround } from "./lakes";
import { CAST } from "./models";
import { fromLocal } from "./planet";

const START = { ...dryGround({ x: 128, y: 128 }), turn: 0 };

/** Run `ms` of frames at 16 ms. */
function run(hero: HeroDriver, sim: EncounterSim, ms: number, at = 0): void {
  for (let t = 0; t < ms; t += 16) {
    hero.step(16);
    sim.step(hero, 16, at + t);
  }
}

describe("the hero as a simulation", () => {
  it("lands one strike per swing, at the contact beat, and hands it over once", () => {
    const hero = new HeroDriver(START);
    pressKey(hero.controls, "Space");
    releaseKey(hero.controls, "Space");
    let strikes = 0;
    for (let t = 0; t < 600; t += 16) {
      hero.step(16);
      strikes += hero.drainStrikes().length;
    }
    expect(strikes).toBe(1);
    expect(hero.drainStrikes()).toEqual([]);
  });

  it("walks the same pose a pixel scene would", () => {
    const hero = new HeroDriver(START);
    pressKey(hero.controls, "KeyW");
    for (let t = 0; t < 400; t += 16) {
      hero.step(16);
    }
    expect(hero.whereabouts().at.y).toBeGreaterThan(START.y + 1);
    expect(hero.whereabouts().turn).toBe(0);
  });
});

describe("the fight without pixels", () => {
  it("puts the hero's sword into a slime in front of him", () => {
    const hero = new HeroDriver(START);
    const sim = new EncounterSim();
    // He faces the viewer at the start: "in front" is a step behind the heading.
    const slime = spawnSlime(sim.slimes, fromLocal(START, { x: 0, y: -0.8 }), { mode: "idle" });
    pressKey(hero.controls, "Space");
    releaseKey(hero.controls, "Space");
    run(hero, sim, 600);
    expect(slime.hp).toBeLessThan(3);
    expect(sim.heroHits()).toBe(1);
  });

  it("sets off a frost nova where he stands, and lets it fade", () => {
    const hero = new HeroDriver(START);
    const sim = new EncounterSim();
    pressKey(hero.controls, "KeyE");
    releaseKey(hero.controls, "KeyE");
    let t = 0;
    while (sim.bursts.length === 0 && t < CAST.durationMs) {
      run(hero, sim, 16, t);
      t += 16;
    }
    expect(sim.bursts.map((burst) => burst.kind)).toEqual(["nova"]);
    run(hero, sim, BURST_MS.nova + 50, t);
    expect(sim.bursts).toEqual([]);
  });

  it("throws a fireball that flies, bursts and is gone", () => {
    const hero = new HeroDriver(START);
    const sim = new EncounterSim();
    pressKey(hero.controls, "KeyQ");
    releaseKey(hero.controls, "KeyQ");
    let flew = false;
    for (let t = 0; t < 3000; t += 16) {
      hero.step(16);
      sim.step(hero, 16, t);
      flew ||= sim.fireballs.length > 0;
    }
    expect(flew).toBe(true);
    expect(sim.fireballs).toEqual([]);
  });
});
