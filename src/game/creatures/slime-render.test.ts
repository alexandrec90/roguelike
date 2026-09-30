import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import { createSlime, DYING_MS, EMERGE_MS, MELT_MS } from "./slime-brain";
import { breath, gaze, leanOf, slimeFrame, slimeShadow, type SlimeRenderEnv } from "./slime-render";

const ENV: SlimeRenderEnv = { light: { x: -0.6, y: -0.8 }, elapsedMs: 1000, hero: { x: 3, y: 0 } };

function slime(mode: Parameters<typeof createSlime>[4] = {}) {
  return createSlime(1, { x: 10, y: 10 }, 77, "green", mode);
}

describe("a slime frame", () => {
  it("stands on its foot with a shadow under it", () => {
    const frame = slimeFrame(slime(), ENV);
    expect(cloudBounds(frame.body)?.bottom).toBe(0);
    expect(frame.shadow.length).toBeGreaterThan(10);
    expect(frame.shadow.every((pixel) => pixel.ink === "shadow" || pixel.ink === "shadow-soft")).toBe(true);
  });

  it("lifts its body, not its shadow, and the shadow shrinks as it rises", () => {
    const grounded = slimeFrame(slime(), ENV);
    const flying = slime();
    flying.lift = 8;
    const aloft = slimeFrame(flying, ENV);
    expect(cloudBounds(aloft.body)?.bottom).toBe(-8);
    expect(aloft.shadow.length).toBeLessThan(grounded.shadow.length);
  });

  it("is deterministic", () => {
    expect(slimeFrame(slime(), ENV)).toEqual(slimeFrame(slime(), ENV));
  });

  it("melts into a low puddle, then dries away completely", () => {
    const dying = slime({ mode: "dying" });
    dying.modeMs = MELT_MS;
    const puddle = slimeFrame(dying, ENV);
    expect(cloudBounds(puddle.body)?.top ?? -99).toBeGreaterThanOrEqual(-1);
    expect(puddle.body.some((pixel) => pixel.ink === "void")).toBe(false);
    expect(puddle.shadow).toHaveLength(0);
    dying.modeMs = DYING_MS;
    expect(slimeFrame(dying, ENV).body).toHaveLength(0);
  });

  it("rises out of a puddle when it emerges", () => {
    const rising = slime({ mode: "emerge" });
    expect(cloudBounds(slimeFrame(rising, ENV).body)?.top ?? -99).toBeGreaterThanOrEqual(-1);
    rising.modeMs = EMERGE_MS;
    expect(cloudBounds(slimeFrame(rising, ENV).body)?.top ?? 0).toBeLessThan(-6);
  });

  it("drops the eyes on the far horizon, where they would be noise", () => {
    const frame = slimeFrame(slime(), { ...ENV, scale: 0.4 });
    expect(frame.body.some((pixel) => pixel.ink === "void")).toBe(false);
  });
});

describe("the terms", () => {
  it("breathe only while idle", () => {
    const idle = slime();
    const values = [0, 300, 600, 900].map((t) => breath(idle, t));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.02);
    expect(breath(slime({ mode: "hop" }), 300)).toBe(0);
  });

  it("look at the hero once aware of him", () => {
    const aware = slime();
    aware.aware = true;
    aware.local = { x: 0, y: 0 };
    expect(gaze(aware, { ...ENV, hero: { x: 3, y: 0 } }).x).toBeGreaterThan(0.9);
    expect(gaze(aware, { ...ENV, hero: { x: -3, y: 0 } }).x).toBeLessThan(-0.9);
  });

  it("lean a per-slime way", () => {
    expect([-1, 0, 1]).toContain(leanOf(123));
  });

  it("cast a shadow that shifts with the sun", () => {
    const plain = slimeShadow(0, 0, 1, 0);
    const shifted = slimeShadow(0, 0, 1, 2);
    expect(shifted.map((p) => p.x - 2)).toEqual(plain.map((p) => p.x));
  });
});
