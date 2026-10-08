import { describe, expect, it } from "vitest";

import { createSlime, DYING_MS, MELT_MS, type Slime } from "../../game/creatures/slime-brain";
import type { PlanetPoint } from "../../game/planet";
import { Kind, MeshBuilder, VERTEX_BYTES } from "./mesh";
import { LOWPOLY } from "./palette";
import { TOWARD_VIEWER } from "./placement";
import { eyeOpen, SKIN_ALPHA, skinPoint, slimeBody, slimeGaze, slimeMesh, viewInPlanet, type SlimeLook } from "./slime-mesh";

const HERO: PlanetPoint = { x: 100, y: 100 };
/** Two tiles ahead of the hero: in front of him on screen, its face toward the camera. */
const AHEAD: PlanetPoint = { x: 100, y: 102 };
const LOOK: SlimeLook = { elapsedMs: 500, turn: 0, gaze: -Math.PI / 2 };

interface Vertex {
  readonly pos: readonly number[];
  readonly normal: readonly number[];
  readonly kind: number;
  readonly colour: readonly number[];
}

function vertices(b: MeshBuilder): Vertex[] {
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return Array.from({ length: b.vertexCount }, (_, i) => {
    const at = i * VERTEX_BYTES;
    return {
      pos: [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)],
      normal: [view.getInt8(at + 20) / 127, view.getInt8(at + 21) / 127, view.getInt8(at + 22) / 127],
      kind: view.getUint8(at + 23),
      colour: [view.getUint8(at + 24), view.getUint8(at + 25), view.getUint8(at + 26), view.getUint8(at + 27)],
    };
  });
}

function build(slime: Slime, look: SlimeLook = LOOK): { solid: Vertex[]; sheer: Vertex[] } {
  const solid = new MeshBuilder();
  const sheer = new MeshBuilder();
  slimeMesh(solid, sheer, slime, HERO, look);
  return { solid: vertices(solid), sheer: vertices(sheer) };
}

const byte = (unit: number): number => Math.round(unit * 255);
const isEye = (v: Vertex): boolean => [0, 1, 2].every((k) => v.colour[k] === byte(LOWPOLY.slimeEye[k]!));

describe("a low-poly slime", () => {
  it("has small beads for eyes, not whites with pupils", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    const solid = build(slime).solid;
    const eyes = solid.filter(isEye);
    const xs = eyes.map((v) => v.pos[0]!);
    const zs = eyes.map((v) => v.pos[2]!);
    // Two eyes side by side, each well under a sixth of the body's width.
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.3);
    // No white of the eye: only the tiny catch-light is near white.
    expect(solid.filter((v) => v.kind !== Kind.glow).every((v) => Math.min(v.colour[0]!, v.colour[1]!, v.colour[2]!) < 200)).toBe(true);
  });

  it("is a sheer, glossy skin over a solid heart and eyes, the same every time", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    const one = build(slime);
    const skin = one.sheer.filter((v) => v.kind === Kind.liquid);
    expect(skin.length).toBeGreaterThan(0);
    expect(skin.every((v) => v.colour[3] === byte(SKIN_ALPHA))).toBe(true);
    expect(one.solid.some(isEye)).toBe(true);
    expect(one.solid.some((v) => v.kind === Kind.glow)).toBe(true);
    expect(build(slime)).toEqual(one);
  });

  it("makes only the half of its skin turned to the eye, whichever way the world is turned", () => {
    const slime = createSlime(1, AHEAD, 7, "frost");
    for (const turn of [0, 0.7, Math.PI]) {
      const view = viewInPlanet(turn);
      const skin = build(slime, { ...LOOK, turn }).sheer.filter((v) => v.kind === Kind.liquid);
      for (let i = 0; i < skin.length; i += 3) {
        const [a, b, c] = [skin[i]!, skin[i + 1]!, skin[i + 2]!];
        const u = [0, 1, 2].map((k) => b.pos[k]! - a.pos[k]!);
        const w = [0, 1, 2].map((k) => c.pos[k]! - a.pos[k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        const out = Math.sign(n[0]! * a.normal[0]! + n[1]! * a.normal[1]! + n[2]! * a.normal[2]!);
        expect(out * (n[0]! * view[0] + n[1]! * view[1] + n[2]! * view[2])).toBeGreaterThan(0);
      }
    }
  });

  it("sees the eye's direction in the planet frame as the turned world would", () => {
    viewInPlanet(0).forEach((component, axis) => expect(component).toBeCloseTo(TOWARD_VIEWER[axis]!, 12));
    const turn = 1.1;
    const [x, y, z] = viewInPlanet(turn);
    // planet -> local is a turn by `turn`, as the vertex shader does it.
    expect(x * Math.cos(turn) - y * Math.sin(turn)).toBeCloseTo(TOWARD_VIEWER[0], 9);
    expect(x * Math.sin(turn) + y * Math.cos(turn)).toBeCloseTo(TOWARD_VIEWER[1], 9);
    expect(z).toBe(TOWARD_VIEWER[2]);
  });

  it("puts its eyes on the side it is looking", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    for (const gaze of [-Math.PI / 2, 0, Math.PI]) {
      const eyes = build(slime, { ...LOOK, gaze }).solid.filter(isEye);
      const mx = eyes.reduce((sum, v) => sum + v.pos[0]!, 0) / eyes.length - 0;
      const my = eyes.reduce((sum, v) => sum + v.pos[1]!, 0) / eyes.length - 2;
      expect(mx * Math.cos(gaze) + my * Math.sin(gaze)).toBeGreaterThan(0.15);
    }
  });

  it("looks at the hero once it has noticed him, and the way it hopped before that", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    slime.hopFrom = { x: 100, y: 102 };
    slime.hopTo = { x: 101, y: 102 };
    expect(slimeGaze(slime, HERO)).toBeCloseTo(0, 9);
    slime.aware = true;
    expect(slimeGaze(slime, HERO)).toBeCloseTo(-Math.PI / 2, 9);
    const fresh = createSlime(2, AHEAD, 9, "green");
    expect(slimeGaze(fresh, HERO)).toBe(slimeGaze(createSlime(3, HERO, 9, "fire"), HERO));
  });

  it("sits its flat foot on the ground and carries it up with a hop", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    const body = slimeBody(slime, HERO, 0);
    expect(skinPoint(body, [0, 0, -1])[2]).toBeCloseTo(0, 9);
    expect(skinPoint(body, [0, 0, 1])[2]).toBeGreaterThan(0.35);
    // The waist is wider than the crown: a gumdrop, sagging.
    const waist = skinPoint(body, [1, 0, -0.2]);
    const crown = skinPoint(body, [Math.SQRT1_2, 0, Math.SQRT1_2]);
    expect(waist[0] / Math.sqrt(1 - 0.04)).toBeGreaterThan(crown[0] / Math.SQRT1_2);
    slime.lift = 16;
    expect(skinPoint(slimeBody(slime, HERO, 0), [0, 0, -1])[2]).toBeCloseTo(1, 9);
  });

  it("wobbles with time, and harder while its squash is still ringing", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    const side = [1, 0, 0] as const;
    expect(skinPoint(slimeBody(slime, HERO, 0), side)).not.toEqual(skinPoint(slimeBody(slime, HERO, 300), side));
    const calm = slimeBody(slime, HERO, 0).wobble;
    slime.squash.value = 0.3;
    expect(slimeBody(slime, HERO, 0).wobble).toBeGreaterThan(calm);
  });

  it("melts into a puddle with no face or heart, which then dries away", () => {
    const slime = createSlime(1, AHEAD, 7, "arcane", { mode: "dying" });
    slime.modeMs = MELT_MS;
    const melted = build(slime);
    expect(melted.solid).toHaveLength(0);
    expect(melted.sheer.some((v) => v.kind === Kind.liquid)).toBe(true);
    slime.modeMs = DYING_MS;
    expect(build(slime).sheer.some((v) => v.kind === Kind.liquid)).toBe(false);
  });

  it("rises out of a puddle of itself as it emerges", () => {
    const slime = createSlime(1, AHEAD, 7, "fire", { mode: "emerge" });
    expect(slimeBody(slime, HERO, 0).melt).toBe(1);
    expect(build(slime).solid).toHaveLength(0);
    slime.mode = "idle";
    expect(slimeBody(slime, HERO, 0).melt).toBe(0);
  });

  it("blinks now and then, and squints while hurt", () => {
    const slime = createSlime(1, AHEAD, 7, "green");
    const samples = Array.from({ length: 400 }, (_, i) => eyeOpen(slime, i * 25));
    expect(samples.filter((open) => open < 1).length).toBeGreaterThan(0);
    expect(samples.filter((open) => open === 1).length).toBeGreaterThan(samples.length * 0.9);
    slime.mode = "hurt";
    expect(eyeOpen(slime, 0)).toBeLessThan(0.5);
  });
});
