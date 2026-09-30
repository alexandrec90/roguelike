import { describe, expect, it } from "vitest";

import { liveCount } from "../fx/particles";
import { INK_COLORS } from "../ink";
import {
  CAMPFIRE_LIGHT_RADIUS,
  campfireCloud,
  campfireFlame,
  campfireGround,
  campfireLight,
  createCampfire,
  FLAME_BASE_Y,
  stepCampfire,
} from "./campfire";
import { buildCampfireParts, charCloud } from "./campfire-parts";

function run(ms: number, wind = 0.3): ReturnType<typeof createCampfire> {
  const fire = createCampfire(5);
  for (let spent = 0; spent < ms; spent += 16) {
    stepCampfire(fire, 16, { wind });
  }
  return fire;
}

describe("the static parts", () => {
  it("builds stones on both sides of the pit, logs, and a charred, partly live end", () => {
    const parts = buildCampfireParts(5);
    expect(parts.back.length).toBeGreaterThan(10);
    expect(parts.front.length).toBeGreaterThan(10);
    expect(parts.logs.length).toBeGreaterThan(10);
    expect(parts.frontLog.length).toBeGreaterThan(5);
    expect(parts.char.some((pixel) => pixel.live)).toBe(true);
    expect(parts.char.some((pixel) => !pixel.live)).toBe(true);
    expect(parts.back.every((pixel) => pixel.ink.startsWith("stone-"))).toBe(true);
  });

  it("is the same for the same seed", () => {
    expect(buildCampfireParts(9)).toEqual(buildCampfireParts(9));
  });

  it("dims its char with the fire's strength", () => {
    const { char } = buildCampfireParts(5);
    const glowing = (strength: number): number =>
      charCloud(char, 0, strength).filter((pixel) => pixel.ink === "fire-4" || pixel.ink === "fire-5").length;
    expect(glowing(1)).toBeGreaterThan(glowing(0.1));
    expect(charCloud(char, 0, 0).every((pixel) => !pixel.ink.startsWith("fire-") || pixel.ink === "fire-1")).toBe(true);
  });
});

describe("burning", () => {
  it("is deterministic", () => {
    expect(campfireCloud(run(1200), 1200)).toEqual(campfireCloud(run(1200), 1200));
  });

  it("sheds embers and smoke, within their caps", () => {
    const fire = run(3000);
    expect(liveCount(fire.embers)).toBeGreaterThan(3);
    expect(liveCount(fire.embers)).toBeLessThanOrEqual(fire.embers.particles.length);
    expect(liveCount(fire.smoke)).toBeGreaterThan(3);
    const cloud = campfireCloud(fire, 3000);
    expect(cloud.some((pixel) => pixel.ink.startsWith("smoke-"))).toBe(true);
    expect(cloud.some((pixel) => pixel.ink === "fire-6" || pixel.ink === "fire-5")).toBe(true);
  });

  it("stands its flame on the logs, foot-anchored on the pit", () => {
    const flame = campfireFlame(run(800));
    expect(flame.length).toBeGreaterThan(20);
    expect(Math.max(...flame.map((pixel) => pixel.y))).toBe(FLAME_BASE_Y);
  });

  it("bends its smoke downwind", () => {
    const meanX = (wind: number): number => {
      const puffs = run(4000, wind).smoke.particles.filter((particle) => particle.active);
      return puffs.reduce((sum, particle) => sum + particle.x, 0) / puffs.length;
    };
    expect(meanX(1)).toBeGreaterThan(meanX(-1) + 4);
  });
});

describe("its light and its ground", () => {
  it("lights a warm pool of the agreed reach, above its foot", () => {
    const light = campfireLight(run(600), 600, 100, 90);
    expect(light.radius).toBe(CAMPFIRE_LIGHT_RADIUS);
    expect(light.color).toBe(INK_COLORS["fire-4"]);
    expect(light.y).toBeLessThan(90);
    expect(light.intensity).toBeGreaterThan(0.5);
    expect(light.intensity).toBeLessThanOrEqual(1.5);
  });

  it("lays an ash bed in the pit", () => {
    const ground = campfireGround(run(100), 100);
    const pit = ground.filter((pixel) => Math.abs(pixel.x) <= 3 && Math.abs(pixel.y) <= 1);
    expect(pit.length).toBeGreaterThan(10);
    expect(pit.filter((pixel) => pixel.ink.startsWith("earth-")).length).toBeGreaterThan(pit.length / 2);
  });
});
