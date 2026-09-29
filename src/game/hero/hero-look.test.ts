import { describe, expect, it } from "vitest";

import { CAST, SWING } from "../models";
import { createPlayer, type PlayerState } from "../player";
import { heroFigure, layeredPose } from "./hero-figure";
import { HeroLook, tracksOf } from "./hero-look";

const STAND = createPlayer({ x: 0, y: 0, turn: 0 });
const SUN = { light: { x: -0.6, y: -0.8 }, elevation: 0.6 };

function run(player: (ms: number) => PlayerState, frames: number, seed = 7) {
  const look = new HeroLook(seed);
  let last = look.frame({ player: player(0), elapsedMs: 0, deltaMs: 16, sun: SUN });
  for (let frame = 1; frame < frames; frame += 1) {
    last = look.frame({ player: player(frame * 16), elapsedMs: frame * 16, deltaMs: 16, sun: SUN });
  }
  return { look, last };
}

describe("tracksOf", () => {
  it("walks only while stepping, and casts only during the clip, not its cooldown", () => {
    expect(tracksOf(STAND, 100)).toMatchObject({ walkMs: undefined, castMs: undefined, swingMs: undefined });
    expect(tracksOf({ ...STAND, castMs: 100 }, 0).castMs).toBe(100);
    expect(tracksOf({ ...STAND, castMs: CAST.durationMs + 50 }, 0).castMs).toBeUndefined();
    expect(tracksOf({ ...STAND, motion: "step", gait: { forward: 1, strafe: 0 } }, 0).walkMs).toBeDefined();
  });
});

describe("layeredPose", () => {
  it("lets the swing own the sword arm over a cast", () => {
    const both = layeredPose({ idleMs: 0, castMs: 385, swingMs: 234 });
    const swingOnly = layeredPose({ idleMs: 0, swingMs: 234 });
    expect(both.bones["arm-r"]).toEqual(swingOnly.bones["arm-r"]);
    expect(both.bones["arm-l"]).not.toEqual(swingOnly.bones["arm-l"]);
  });
});

describe("HeroLook", () => {
  it("hands back the bare figure separately from the scene around it", () => {
    const { last } = run(() => STAND, 1);
    expect(last.figure.length).toBeGreaterThan(100);
    expect(last.scene.length).toBeGreaterThanOrEqual(last.figure.length);
    expect(last.shadow.length).toBeGreaterThan(0);
    expect(last.blade).toBeDefined();
  });

  it("adds flames only while the blade burns", () => {
    const cold = run(() => STAND, 20).last;
    const hot = run(() => ({ ...STAND, enchanted: true }), 20).last;
    expect(cold.scene.some((p) => p.ink.startsWith("fire"))).toBe(false);
    expect(hot.scene.filter((p) => p.ink.startsWith("fire")).length).toBeGreaterThan(20);
  });

  it("adds a trail mid-swing", () => {
    const standing = run(() => STAND, 1).last;
    const swinging = run(() => ({ ...STAND, attackMs: Math.round(SWING.durationMs * 0.45) }), 1).last;
    expect(swinging.scene.length - swinging.figure.length).toBeGreaterThan(standing.scene.length - standing.figure.length + 10);
  });

  it("lights the world only while the blade burns", () => {
    const { look } = run(() => ({ ...STAND, enchanted: true }), 3);
    expect(look.light({ ...STAND, enchanted: true }, 160, 100, 48)).toBeDefined();
    expect(look.light(STAND, 160, 100, 48)).toBeUndefined();
  });

  it("is deterministic for the same seed and the same frames", () => {
    const burning = (ms: number) => ({ ...STAND, enchanted: true, attackMs: ms % SWING.durationMs });
    expect(run(burning, 30, 3).last.scene).toEqual(run(burning, 30, 3).last.scene);
  });

  it("draws the same body the lab does", () => {
    const { last } = run(() => STAND, 1);
    const lab = heroFigure(layeredPose(tracksOf(STAND, 0)), { light: { ...SUN.light, ambient: 0.24 } }).cloud;
    // The scarf's tail hangs behind him from the front, so the two agree bar
    // the few pixels where it peeks past his outline.
    const key = (p: { x: number; y: number; ink: string }) => `${p.x},${p.y},${p.ink}`;
    const labKeys = new Set(lab.map(key));
    expect(last.figure.filter((p) => !labKeys.has(key(p))).length).toBeLessThan(12);
  });
});
