import { describe, expect, it } from "vitest";

import { planetLakes } from "../../game/lakes";
import { PLANET_TILES } from "../../game/planet";
import { waterLevel } from "../../game/water/puddle-field";
import { WEATHER_PRESETS } from "../../game/water/schedule";
import { RippleRing } from "./ripples";
import { RAIN_FRAGMENT } from "./rain-pass";
import { REFLECTION_SCALE } from "./reflection";
import { stillSky } from "./sky-light";
import { WORLD_FRAGMENT, WORLD_VERTEX } from "./shaders";
import { MAX_RIPPLES, WATER_GLSL } from "./water-glsl";
import { CLOCK_WRAP_S, shaderSeconds, WetWorld } from "./wet-world";

const lake = planetLakes()[0]!;
const IN_WATER = { x: lake.x, y: lake.y, turn: 0 };

/** A point well clear of any water on a bone-dry day. */
function dryPoint(world: WetWorld): { x: number; y: number; turn: number } {
  for (let y = 0.5; y < PLANET_TILES; y += 3) {
    for (let x = 0.5; x < PLANET_TILES; x += 3) {
      if (!world.isWet({ x, y }) && !world.isWet({ x: x + 0.5, y })) {
        return { x, y, turn: 0 };
      }
    }
  }
  throw new Error("the planet is all water");
}

function rings(world: WetWorld): number {
  let count = 0;
  for (let i = 3; i < world.ripples.slots.length; i += 4) {
    count += (world.ripples.slots[i] ?? 0) > 0 ? 1 : 0;
  }
  return count;
}

describe("the wet world", () => {
  it("opens soaked under a pinned downpour, and dry under a clear sky", () => {
    expect(new WetWorld(WEATHER_PRESETS.storm).wetness).toBe(1);
    expect(new WetWorld(WEATHER_PRESETS.clear).wetness).toBe(0);
    expect(new WetWorld(undefined).weather.rain).toBe(0);
  });

  it("soaks under rain and hands the shader the level that wetness sets", () => {
    const world = new WetWorld(WEATHER_PRESETS.rain);
    const before = world.wetness;
    world.step(0, 1000, { pose: IN_WATER, walked: 0 }, []);
    expect(world.wetness).toBeGreaterThanOrEqual(before);
    const water = world.water({ x: 3, y: 4 }, 1500);
    expect(water.level).toBe(waterLevel(world.wetness));
    expect(water.rain).toBe(WEATHER_PRESETS.rain.rain);
    expect(water.hero).toEqual([3, 4]);
    expect(water.seconds).toBe(1.5);
  });

  it("rings a footstep in water, and none on dry ground", () => {
    const wet = new WetWorld(WEATHER_PRESETS.clear);
    wet.step(0, 16, { pose: IN_WATER, walked: 0 }, []);
    wet.step(16, 16, { pose: IN_WATER, walked: 1.2 }, []);
    expect(rings(wet)).toBeGreaterThan(0);

    const dry = new WetWorld(WEATHER_PRESETS.clear);
    const ground = dryPoint(dry);
    dry.step(0, 16, { pose: ground, walked: 0 }, []);
    dry.step(16, 16, { pose: ground, walked: 1.2 }, []);
    expect(rings(dry)).toBe(0);
  });

  it("rings a slime that lands in water, and not one that lands on grass", () => {
    const world = new WetWorld(WEATHER_PRESETS.clear);
    const ground = dryPoint(world);
    world.step(0, 16, { pose: ground, walked: 0 }, [ground]);
    expect(rings(world)).toBe(0);
    world.step(16, 16, { pose: ground, walked: 0 }, [IN_WATER]);
    expect(rings(world)).toBe(1);
  });

  it("keeps the shader's clock small enough for a float all session", () => {
    expect(shaderSeconds(2500)).toBe(2.5);
    expect(shaderSeconds((CLOCK_WRAP_S + 3) * 1000)).toBeCloseTo(3, 9);
  });
});

describe("the ripple ring", () => {
  it("overwrites the oldest once every slot is used", () => {
    const ring = new RippleRing();
    for (let i = 0; i <= MAX_RIPPLES; i += 1) {
      ring.add({ x: i, y: 0 }, i, 1);
    }
    expect(ring.slots).toHaveLength(MAX_RIPPLES * 4);
    expect(ring.slots[0]).toBe(MAX_RIPPLES);
    expect(ring.slots[4]).toBe(1);
  });
});

describe("the water and rain shaders", () => {
  it("read the puddle field and the mirror, and hand the ripple array its size", () => {
    expect(WATER_GLSL).toContain(`uniform vec4 u_ripples[${MAX_RIPPLES}]`);
    expect(WORLD_FRAGMENT).toContain("puddleAt(v_planet)");
    expect(WORLD_FRAGMENT).toContain("texture(u_reflect");
    // Height mirrored after the sway has bent it, so a reflection leans with its plant.
    expect(WORLD_VERTEX).toContain("float height = a_pos.z + sway.z;");
    expect(WORLD_VERTEX).toContain("height * u_mirror");
  });

  it("never let the mirror draw the ground or what has sunk past the horizon", () => {
    expect(WORLD_FRAGMENT).toMatch(/u_mirror < 0\.0 && v_rows > ROLL_ROWS/);
    expect(WORLD_FRAGMENT).toMatch(/lies && \(v_rows > ROLL_ROWS \|\| u_mirror < 0\.0\)/);
  });

  it("rain is one pass of hashes, and the mirror a quarter of the pixels", () => {
    expect(RAIN_FRAGMENT).toContain("hash(index");
    expect(REFLECTION_SCALE).toBe(0.5);
  });

  it("still water shows the upper sky, leaning toward the horizon's colour", () => {
    expect(stillSky({ skyTop: "#000000", skyHorizon: "#ffffff" })[0]).toBeCloseTo(0.35, 9);
  });
});
