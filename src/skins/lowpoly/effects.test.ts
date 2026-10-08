import { describe, expect, it } from "vitest";

import { effectSwitches, type EffectId } from "../../game/effects";
import { DEFAULT_SCENE_OPTIONS } from "../../game/scene-options";
import {
  ALL_FEATURES,
  featuresKey,
  shaderFeatures,
  type DrawableHandle,
  type FrameScene,
  type FrameUniforms,
  type LowpolyBackend,
  type ShaderFeatures,
} from "./backend";
import { LowpolyGame } from "./lowpoly-game";
import { VERTEX_BYTES } from "./mesh";
import { worldFragment, worldVertex } from "./shaders";
import { STILL_WIND } from "./sway";
import { worldWgsl } from "./webgpu/wgsl-world";

/** A backend that draws nothing and keeps the last frame it was asked for. */
class Recorder implements LowpolyBackend {
  readonly kind = "webgl";
  last: { frame: FrameUniforms; scene: FrameScene } | undefined;
  features: ShaderFeatures | undefined;

  setFeatures(features: ShaderFeatures): void {
    this.features = features;
  }

  createDrawable(): DrawableHandle {
    return { count: 0 };
  }

  update(drawable: DrawableHandle, bytes: Uint8Array): void {
    drawable.count = bytes.byteLength / VERTEX_BYTES;
  }

  render(frame: FrameUniforms, scene: FrameScene): void {
    this.last = { frame, scene };
  }
}

/** One frame of a storm with `off` switched off; no chunk is built, so only the actors are drawn. */
function frameWith(off: readonly EffectId[]): { frame: FrameUniforms; scene: FrameScene } {
  const backend = new Recorder();
  const game = new LowpolyGame(backend, { ...DEFAULT_SCENE_OPTIONS, weather: "storm", effects: effectSwitches(off) });
  game.step(16);
  game.draw(1280, 720);
  return backend.last!;
}

describe("the low-poly frame with an effect off", () => {
  const all = frameWith([]);

  it("draws nothing into the mirror without reflections", () => {
    expect(all.scene.mirrored.length).toBeGreaterThan(0);
    expect(frameWith(["reflections"]).scene.mirrored).toEqual([]);
  });

  it("hands the backend no rain to lay over the frame", () => {
    expect(all.scene.rain.strength).toBeGreaterThan(0);
    expect(frameWith(["rain"]).scene.rain.strength).toBe(0);
  });

  it("builds no shadow under the hero", () => {
    const heroSheer = (scene: FrameScene): number => scene.sheers.at(-1)!.drawable.count;
    expect(heroSheer(all.scene)).toBeGreaterThan(0);
    expect(heroSheer(frameWith(["shadows"]).scene)).toBe(0);
  });

  it("follows a switch flipped between two frames of one running game", () => {
    const backend = new Recorder();
    const effects = effectSwitches([]);
    const game = new LowpolyGame(backend, { ...DEFAULT_SCENE_OPTIONS, weather: "storm", effects });
    game.step(16);
    game.draw(1280, 720);
    expect(backend.last!.scene.rain.strength).toBeGreaterThan(0);
    expect(backend.features).toEqual(ALL_FEATURES);
    effects.set("rain", false);
    effects.set("sway", false);
    game.step(16);
    game.draw(1280, 720);
    expect(backend.last!.scene.rain.strength).toBe(0);
    expect(backend.features).toEqual({ ...ALL_FEATURES, sway: false });
    effects.set("rain", true);
    game.step(16);
    game.draw(1280, 720);
    expect(backend.last!.scene.rain.strength).toBeGreaterThan(0);
  });

  it("works out neither the wind nor the pushes without sway", () => {
    expect(all.frame.sway.pushes.some((value) => value !== 0)).toBe(true);
    const still = frameWith(["sway"]).frame.sway;
    expect(still.wind).toEqual(STILL_WIND);
    expect(still.pushes.every((value) => value === 0)).toBe(true);
  });
});

describe("the shaders with an effect off", () => {
  it("are built from the switches", () => {
    expect(shaderFeatures(effectSwitches([]))).toEqual(ALL_FEATURES);
    expect(shaderFeatures(effectSwitches(["sway", "ripples"]))).toEqual({ sway: false, ripples: false });
  });

  it("file each build under its own key, so a backend compiles a variant once", () => {
    const keys = [true, false].flatMap((sway) => [true, false].map((ripples) => featuresKey({ sway, ripples })));
    expect(new Set(keys).size).toBe(4);
    expect(featuresKey({ sway: true, ripples: false })).toBe(featuresKey({ ripples: false, sway: true }));
  });

  it("leave the sway out of both vertex stages", () => {
    const still = { ...ALL_FEATURES, sway: false };
    expect(worldVertex(ALL_FEATURES)).toContain("pushLean(foot)");
    expect(worldVertex(still)).not.toContain("pushLean(");
    expect(worldVertex(still)).toContain("vec3 sway = swayOffset(kind");
    expect(worldWgsl(false)).toContain("pushLean(foot)");
    expect(worldWgsl(false, still)).not.toContain("pushLean(");
  });

  it("leave the rings out of the water", () => {
    const calm = { ...ALL_FEATURES, ripples: false };
    expect(worldFragment(true)).toContain("rainSlope(planet) * 0.6 + stepSlope(planet)");
    expect(worldFragment(true, calm)).not.toContain("rainSlope(planet) * 0.6");
    expect(worldFragment(true, calm)).toContain("vec2 slope = vec2(0.0);");
    expect(worldWgsl(true)).toContain("let wave = waveSlope(planet);");
    expect(worldWgsl(true, calm)).not.toContain("waveSlope(planet);");
  });
});
