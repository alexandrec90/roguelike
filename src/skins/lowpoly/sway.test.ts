import { describe, expect, it } from "vitest";

import { BURST_MS, type Burst } from "../../game/encounter-sim";
import { createSlime } from "../../game/creatures/slime-brain";
import { launchFireball } from "../../game/fire/fireball";
import { PLANET_TILES } from "../../game/planet";
import { ATTACK_MS, createPlayer, type PlayerState } from "../../game/player";
import { gustAt } from "../../game/wind";
import { Kind } from "./mesh";
import { WORLD_VERTEX } from "./shaders";
import { MAX_LEAN, MAX_PUSHES, pushLean, SWAY_GLSL, SWAY_WGSL, SWAYERS, swayOffset, windAtPlanet, windUniform, type SwayState } from "./sway";
import { pushesOf } from "./sway-pushes";
import { worldWgsl } from "./webgpu/wgsl-world";

const GRASS_FLEX = SWAYERS[Kind.grass]!.flex;

const HERO = { x: 100, y: 60 };
const still: SwayState["wind"] = [0, 0, 0, 0];
const none = new Float32Array(MAX_PUSHES * 4);
const player: PlayerState = createPlayer({ ...HERO, turn: 0 });

/** One push at planet offset (x, y) from the hero. */
function pushAt(x: number, y: number, front: number, strength: number): Float32Array {
  const pushes = new Float32Array(MAX_PUSHES * 4);
  pushes.set([x, y, front, strength], 0);
  return pushes;
}

describe("the wind the plants lean in", () => {
  it("is the shared gust envelope times the weather's wind, with phases kept small for the shader", () => {
    const wind = windUniform(3_600_000, 1.4);
    expect(wind[2]).toBeCloseTo(gustAt(3_600_000) * 1.4, 9);
    for (const phase of [wind[0], wind[1]]) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
    }
    expect(windUniform(5000, 0)[2]).toBe(0);
  });

  it("has no seam where the planet wraps", () => {
    const wind = windUniform(12_345, 1);
    for (const point of [{ x: 3.25, y: 17.5 }, { x: 200, y: 0.5 }]) {
      const wrapped = { x: point.x + PLANET_TILES, y: point.y - PLANET_TILES };
      expect(windAtPlanet(wind, wrapped)).toBeCloseTo(windAtPlanet(wind, point), 6);
    }
  });

  it("travels: the same point blows differently a moment later, and neighbouring points differ", () => {
    const now = windUniform(1000, 1);
    const later = windUniform(1400, 1);
    expect(windAtPlanet(now, HERO)).not.toBeCloseTo(windAtPlanet(later, HERO), 3);
    expect(windAtPlanet(now, HERO)).not.toBeCloseTo(windAtPlanet(now, { x: HERO.x + 3, y: HERO.y }), 3);
  });

  it("blows across the screen, so a strafe that turns the world does not turn the wind", () => {
    const wind: SwayState["wind"] = [Math.PI / 2, 0, 1, 0];
    const facing = swayOffset(Kind.grass, { wind, pushes: none }, [0, 0], HERO, 0.4, 0);
    const turned = swayOffset(Kind.grass, { wind, pushes: none }, [0, 0], HERO, 0.4, 1.1);
    expect(facing[0]).not.toBe(0);
    expect(facing[1]).toBe(0);
    expect(turned[0]).toBeCloseTo(facing[0], 9);
  });
});

describe("a swaying vertex", () => {
  const breeze: SwayState = { wind: [Math.PI / 2, 0, 1, 0], pushes: pushAt(0, 0, 0, 0.9) };

  it("moves only grass and foliage: a rock, the ground and the hero stay where they are", () => {
    for (const kind of [Kind.body, Kind.ground, Kind.shadow, Kind.water, Kind.glow]) {
      expect(swayOffset(kind, breeze, [0.3, 0], HERO, 1, 0)).toEqual([0, 0, 0]);
    }
  });

  it("keeps every root where it grew: only what stands above the ground bends", () => {
    for (const kind of [Kind.grass, Kind.foliage]) {
      const [x, y, z] = swayOffset(kind, breeze, [0.3, 0.2], HERO, 0, 0);
      expect(Math.hypot(x, y, z)).toBe(0);
    }
  });

  it("bends a blade further at its tip than halfway up", () => {
    const tip = swayOffset(Kind.grass, breeze, [0.5, 0], HERO, 0.4, 0);
    const mid = swayOffset(Kind.grass, breeze, [0.5, 0], HERO, 0.2, 0);
    expect(Math.abs(tip[0])).toBeGreaterThan(Math.abs(mid[0]));
  });

  it("is still with no wind and nothing near", () => {
    expect(Math.hypot(...swayOffset(Kind.grass, { wind: still, pushes: none }, [2, 2], HERO, 0.4, 0))).toBe(0);
  });
});

describe("a push", () => {
  it("parts the grass away from whatever walks through it", () => {
    const pushes = pushAt(0, 0, 0, 0.9);
    const east = swayOffset(Kind.grass, { wind: still, pushes }, [0.4, 0], HERO, 0.4, 0);
    const behind = swayOffset(Kind.grass, { wind: still, pushes }, [0, -0.4], HERO, 0.4, 0);
    expect(east[0]).toBeGreaterThan(0);
    expect(behind[1]).toBeLessThan(0);
    // Bowed over, a blade is shorter.
    expect(east[2]).toBeLessThan(0);
  });

  it("leans in the turned world's frame: planet east is ahead after a quarter turn", () => {
    const pushes = pushAt(0, 0, 0, 0.9);
    const [x, y] = swayOffset(Kind.grass, { wind: still, pushes }, [0.4, 0], HERO, 0.4, Math.PI / 2);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeGreaterThan(0);
  });

  it("is felt on its front, and not far off it: a nova's ring flattens the grass it is crossing", () => {
    const ring = pushAt(0, 0, 2, 2.6);
    const [onFront] = pushLean(ring, [2, 0]);
    const [inside] = pushLean(ring, [0.5, 0]);
    const [beyond] = pushLean(ring, [4, 0]);
    expect(onFront).toBeGreaterThan(Math.abs(inside) * 5);
    expect(onFront).toBeGreaterThan(Math.abs(beyond) * 5);
  });

  it("barely leans what stands dead under its centre, so a tuft at a body's feet never flips side to side", () => {
    const [x, y] = pushLean(pushAt(0, 0, 0, 0.9), [0.001, 0]);
    expect(Math.hypot(x, y)).toBeLessThan(0.02);
  });

  it("moves a tree less than grass, for the same bend", () => {
    const pushes = pushAt(0, 0, 0, 0.9);
    const lean = pushLean(pushes, [0.4, 0])[0];
    const grass = swayOffset(Kind.grass, { wind: still, pushes }, [0.4, 0], HERO, 0.4, 0)[0];
    const tree = swayOffset(Kind.foliage, { wind: still, pushes }, [0.4, 0], HERO, 0.4, 0)[0];
    expect(grass / 0.4 / GRASS_FLEX).toBeCloseTo(lean, 6);
    expect(tree).toBeGreaterThan(0);
    expect(tree).toBeLessThan(grass);
    // A mushroom sits between: it nods from a passing foot, it does not lie flat.
    const sprig = swayOffset(Kind.sprig, { wind: still, pushes }, [0.4, 0], HERO, 0.4, 0)[0];
    expect(sprig).toBeGreaterThan(tree);
    expect(sprig).toBeLessThan(grass);
  });

  it("writes the same table into both shading languages", () => {
    for (const [kind, row] of Object.entries(SWAYERS)) {
      const values = [row!.flex, row!.crown, row!.push, row!.droop].map((v) => (Number.isInteger(v) ? `${v}.0` : `${v}`)).join(", ");
      expect(SWAY_GLSL).toContain(`if (kind == ${kind}) { return vec4(${values}); }`);
      expect(SWAY_WGSL).toContain(`if (kind == ${kind}u) { return vec4f(${values}); }`);
    }
  });

  it("never lays a plant past `MAX_LEAN`, however much pushes at once", () => {
    const pushes = new Float32Array(MAX_PUSHES * 4);
    for (let slot = 0; slot < MAX_PUSHES; slot += 1) {
      pushes.set([0, 0, 0.5, 50], slot * 4);
    }
    const [x, y] = swayOffset(Kind.grass, { wind: [Math.PI / 2, 0, 3, 0], pushes }, [0.5, 0.1], HERO, 1, 0.3);
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(MAX_LEAN * GRASS_FLEX + 1e-9);
  });
});

describe("the frame's pushes", () => {
  const input = { player, live: HERO, slimes: [], fireballs: [], bursts: [] };

  it("always carry the hero, at his feet, and leave the other slots empty", () => {
    const pushes = pushesOf(input);
    expect(pushes).toHaveLength(MAX_PUSHES * 4);
    expect(pushes[0]).toBe(0);
    expect(pushes[1]).toBe(0);
    expect(pushes[3]).toBeGreaterThan(0);
    expect([...pushes.slice(4)].every((value) => value === 0)).toBe(true);
  });

  it("add a sweep racing out from him while he swings, gone when the blow is", () => {
    const early = pushesOf({ ...input, player: { ...player, attackMs: ATTACK_MS * 0.25 } });
    const late = pushesOf({ ...input, player: { ...player, attackMs: ATTACK_MS * 0.75 } });
    expect(early[7]).toBeGreaterThan(0);
    expect(late[6]).toBeGreaterThan(early[6]!);
    expect(pushesOf({ ...input, player: { ...player, attackMs: ATTACK_MS } })[7]).toBeCloseTo(0, 9);
  });

  it("measure a burst from the hero round the wrap, its ring growing as it fades", () => {
    const burst = (ageMs: number): Burst => ({ kind: "nova", at: { x: 1, y: HERO.y }, radius: 3, ageMs });
    const hero = { x: PLANET_TILES - 1, y: HERO.y };
    const young = pushesOf({ ...input, live: hero, bursts: [burst(BURST_MS.nova * 0.2)] });
    const old = pushesOf({ ...input, live: hero, bursts: [burst(BURST_MS.nova * 0.8)] });
    expect(young[4]).toBeCloseTo(2, 9);
    expect(old[6]).toBeGreaterThan(young[6]!);
    expect(old[7]).toBeLessThan(young[7]!);
  });

  it("follow a fireball in flight", () => {
    const ball = launchFireball({ x: HERO.x + 2, y: HERO.y }, { x: 1, y: 0 }, { ...HERO, turn: 0 }, 7);
    const pushes = pushesOf({ ...input, fireballs: [ball] });
    expect(pushes[4]).toBeCloseTo(2, 6);
    expect(pushes[7]).toBeGreaterThan(0);
  });

  it("give the slots that are left to the slimes nearest him, and none to a dying one", () => {
    const slimes = Array.from({ length: MAX_PUSHES + 3 }, (_, i) => createSlime(i, { x: HERO.x + 1 + i, y: HERO.y }, i, "green"));
    const pushes = pushesOf({ ...input, slimes: [createSlime(99, { x: HERO.x + 0.5, y: HERO.y }, 9, "green", { mode: "dying" }), ...slimes] });
    expect(pushes[4]).toBe(1);
    expect(pushes[(MAX_PUSHES - 1) * 4]).toBe(MAX_PUSHES - 1);
  });
});

describe("the sway in both shading languages", () => {
  it("bends the vertex before it is placed, in both backends", () => {
    expect(WORLD_VERTEX).toContain("vec3 swayOffset(int kind");
    expect(WORLD_VERTEX).toContain(`uniform vec4 u_pushes[${MAX_PUSHES}];`);
    expect(WORLD_VERTEX).toContain("turned(a_pos.xy - a_anchor) + sway.xy");
    const wgsl = worldWgsl(false);
    expect(wgsl).toContain("fn swayOffset(kind: u32");
    expect(wgsl).toContain(`pushes: array<vec4f, ${MAX_PUSHES}>`);
    expect(wgsl).toContain("turned(input.pos.xy - input.anchor, rot) + sway.xy");
  });
});
