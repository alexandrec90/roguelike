import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import { createSlime } from "./creatures/slime-brain";
import { slimeFrame } from "./creatures/slime-render";
import {
  ALL_EFFECTS,
  EFFECTS,
  effectsFor,
  effectSwitches,
  formatEffectsOff,
  parseEffectsOff,
  type EffectId,
} from "./effects";
import { createCampfire, stepCampfire } from "./fire/campfire";
import { DecalLayer } from "./fire/decal-layer";
import { horizonLayout } from "./horizon";
import { HeroLook } from "./hero/hero-look";
import { SWING } from "./models";
import { createBuffer } from "./pixel-buffer";
import { createPlayer } from "./player";
import { readSceneOptions } from "./scene-options";
import { SkyPainter } from "./sky-paint";
import { WaterLayer } from "./water-layer";

const root = resolve(import.meta.dirname, "../..");

/** Every non-test TypeScript file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** The effect ids a tree of source asks about with `on("…")`. */
function switchesRead(dir: string): Set<string> {
  const read = new Set<string>();
  for (const file of sources(dir)) {
    for (const match of readFileSync(resolve(root, file), "utf8").matchAll(/\bon\("([a-z-]+)"\)/g)) {
      read.add(match[1]!);
    }
  }
  return read;
}

const idsFor = (skin: "pixel" | "lowpoly"): Set<string> => new Set(effectsFor(skin).map((effect) => effect.id));

describe("the effect table", () => {
  it("names each effect once, for at least one skin, with a label and a line on what it is", () => {
    expect(new Set(EFFECTS.map((effect) => effect.id)).size).toBe(EFFECTS.length);
    for (const effect of EFFECTS) {
      expect(effect.skins.length, effect.id).toBeGreaterThan(0);
      expect(effect.label.length, effect.id).toBeGreaterThan(0);
      expect(effect.what.length, effect.id).toBeGreaterThan(0);
    }
  });

  // Both directions: a row no skin reads is a switch that does nothing, and a
  // switch read under a skin the row does not list is one the panel never offers.
  it("lists for the pixel skin exactly the switches its layers read", () => {
    expect(switchesRead("src/game")).toEqual(idsFor("pixel"));
  });

  it("lists for the low-poly skin exactly the switches it reads", () => {
    expect(switchesRead("src/skins/lowpoly")).toEqual(idsFor("lowpoly"));
  });
});

describe("the instructions", () => {
  // `CLAUDE.md` tells an agent every effect is a switch; this keeps it pointed at the real ones.
  it("send an agent adding an effect to this table and its switch", () => {
    const claude = readFileSync(resolve(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain("`src/game/effects.ts`'s `EFFECTS`");
    expect(claude).toContain("`?off=rain,shake`");
    expect(claude).toContain("`ShaderFeatures`");
    const effects = readFileSync(resolve(root, ".claude/rules/procedural-effects.md"), "utf8");
    expect(effects).toContain('`effects.on("<id>")`');
    expect(parseEffectsOff("rain,shake").off).toEqual(["rain", "shake"]);
  });
});

describe("parseEffectsOff", () => {
  it("turns nothing off with no list", () => {
    expect(parseEffectsOff(null).off).toEqual([]);
    expect(parseEffectsOff("").off).toEqual([]);
    for (const effect of EFFECTS) {
      expect(ALL_EFFECTS.on(effect.id)).toBe(true);
    }
  });

  it("reads a list in any case and spacing, in the table's order", () => {
    const switches = parseEffectsOff(" SHAKE, rain ,Lights");
    expect(switches.off).toEqual(["lights", "rain", "shake"]);
    expect(switches.on("rain")).toBe(false);
    expect(switches.on("ripples")).toBe(true);
  });

  it("drops an id it does not know rather than failing the load", () => {
    expect(parseEffectsOff("rain,bloom,,").off).toEqual(["rain"]);
  });

  it("is read by the scene options from `?off=`", () => {
    expect(readSceneOptions(new URLSearchParams("off=rain,grass")).effects.off).toEqual(["rain", "grass"]);
    expect(readSceneOptions(new URLSearchParams("")).effects).toEqual(ALL_EFFECTS);
  });
});

describe("EffectSwitches", () => {
  it("flips one switch in place, leaving the rest", () => {
    const switches = effectSwitches(["shake"]);
    switches.set("rain", false);
    expect(switches.off).toEqual(["rain", "shake"]);
    switches.set("shake", true);
    expect(switches.on("shake")).toBe(true);
    expect(switches.off).toEqual(["rain"]);
  });

  it("compares by which effects are off", () => {
    const switches = effectSwitches([]);
    switches.set("rain", false);
    expect(switches).toEqual(effectSwitches(["rain"]));
    switches.set("rain", true);
    expect(switches).toEqual(ALL_EFFECTS);
  });
});

describe("formatEffectsOff", () => {
  it("writes the table's order with no repeats, and nothing when none is off", () => {
    expect(formatEffectsOff(["shake", "rain", "shake"])).toBe("rain,shake");
    expect(formatEffectsOff([])).toBe("");
  });

  it("round-trips through the parser", () => {
    const ids: EffectId[] = ["motes", "stars", "trail"];
    expect(parseEffectsOff(formatEffectsOff(ids)).off).toEqual(effectSwitches(ids).off);
  });
});

describe("effectsFor", () => {
  it("offers each skin only what it draws", () => {
    expect(idsFor("lowpoly").has("reflections")).toBe(true);
    expect(idsFor("lowpoly").has("grass")).toBe(false);
    expect(idsFor("pixel").has("grass")).toBe(true);
  });
});

// An effect that is off does no work: each of these is the place its work starts.
describe("a switched-off effect", () => {
  const SUN = { light: { x: -0.6, y: -0.8 }, elevation: 0.6 };
  const NONE = { scarf: false, trail: false, particles: false, shadow: false };

  it("leaves the hero's scarf, trail, sparks and shadow out of his frame", () => {
    const player = { ...createPlayer({ x: 0, y: 0, turn: 0 }), enchanted: true, attackMs: Math.round(SWING.durationMs * 0.45) };
    const bare = new HeroLook(7, NONE);
    const dressed = new HeroLook(7);
    let plain = bare.frame({ player, elapsedMs: 0, deltaMs: 16, sun: SUN });
    let full = dressed.frame({ player, elapsedMs: 0, deltaMs: 16, sun: SUN });
    for (let frame = 1; frame < 10; frame += 1) {
      plain = bare.frame({ player, elapsedMs: frame * 16, deltaMs: 16, sun: SUN });
      full = dressed.frame({ player, elapsedMs: frame * 16, deltaMs: 16, sun: SUN });
    }
    expect(plain.shadow).toEqual([]);
    expect(full.shadow.length).toBeGreaterThan(0);
    // Nothing but the figure: no trail behind or before it, no flames over it.
    expect(plain.scene).toEqual(plain.figure);
    expect(full.scene.length).toBeGreaterThan(full.figure.length + 10);
  });

  it("drops the hero's flames the frame particles go off mid-run, and hangs the scarf afresh when it comes back", () => {
    const player = { ...createPlayer({ x: 0, y: 0, turn: 0 }), enchanted: true };
    const shows = { scarf: true, trail: true, particles: true, shadow: true };
    const look = new HeroLook(7, shows);
    let ms = 0;
    const frame = (): ReturnType<HeroLook["frame"]> => look.frame({ player, elapsedMs: (ms += 16), deltaMs: 16, sun: SUN });
    for (let step = 0; step < 20; step += 1) {
      frame();
    }
    const burning = frame();
    expect(burning.scene.length).toBeGreaterThan(burning.figure.length + 20);
    shows.particles = false;
    shows.scarf = false;
    // Not swinging, so with no particles there is nothing round him but him.
    const bare = frame();
    expect(bare.scene).toEqual(bare.figure);
    shows.particles = true;
    shows.scarf = true;
    // Hung afresh from his neck: the first frame back already wears it.
    const scarved = frame();
    const scarfless = new HeroLook(7, { ...shows, scarf: false }).frame({ player, elapsedMs: ms, deltaMs: 16, sun: SUN });
    expect(scarved.figure).not.toEqual(scarfless.figure);
  });

  it("casts no slime shadow", () => {
    const slime = createSlime(1, { x: 10, y: 10 }, 77, "green");
    const env = { light: SUN.light, elapsedMs: 0, hero: { x: 2, y: 0 } };
    expect(slimeFrame(slime, env).shadow.length).toBeGreaterThan(0);
    expect(slimeFrame(slime, { ...env, shadow: false }).shadow).toEqual([]);
  });

  it("emits no ember and no smoke from the campfire", () => {
    const fire = createCampfire(3);
    const quiet = createCampfire(3);
    for (let frame = 0; frame < 60; frame += 1) {
      stepCampfire(fire, 16, { wind: 0.2 });
      stepCampfire(quiet, 16, { wind: 0.2, particles: false });
    }
    const live = (pool: typeof fire.embers): number => pool.particles.filter((particle) => particle.active).length;
    expect(live(fire.embers) + live(fire.smoke)).toBeGreaterThan(0);
    expect(live(quiet.embers) + live(quiet.smoke)).toBe(0);
  });

  it("stamps no mark on the ground", () => {
    const marks = new DecalLayer();
    const none = new DecalLayer(effectSwitches(["decals"]));
    marks.stamp({ x: 3, y: 4 }, "scorch", 9);
    none.stamp({ x: 3, y: 4 }, "scorch", 9);
    expect(marks.field.decals).toHaveLength(1);
    expect(none.field.decals).toHaveLength(0);
  });

  it("opens no ring on the water, before it even asks whether there is water", () => {
    // Uncreated: a layer that asked its mask would throw.
    const still = new WaterLayer(effectSwitches(["ripples"]));
    const frame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 120, phaseX: 0, phaseY: 0 };
    expect(still.ring({ x: 160, y: 120 }, frame, 600, 6)).toBe(false);
  });

  it("paints a sky without clouds or stars that never changes with the clock", () => {
    const layout = horizonLayout(180, 0.22);
    const paint = (hours: number, ms: number, shows?: { clouds: boolean; stars: boolean }): Uint8ClampedArray => {
      const buffer = createBuffer(320, layout.skyHeight);
      new SkyPainter(buffer, layout, false, shows).paint(atmosphereAt(hours, 0.4), 0, ms, ms / 100);
      return buffer.data;
    };
    const bare = { clouds: false, stars: false };
    expect(paint(13, 0, bare)).not.toEqual(paint(13, 0));
    expect(paint(23, 0, bare)).not.toEqual(paint(23, 0));
    // Nothing left in it drifts or twinkles, so the layer never needs to repaint it for the time.
    expect(paint(23, 0, bare)).toEqual(paint(23, 4321, bare));
  });
});
