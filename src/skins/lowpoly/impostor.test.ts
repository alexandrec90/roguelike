import { describe, expect, it } from "vitest";

import { TILE_DEPTH, WALL_RISE } from "../../game/projection";
import { CLOUD_DEPTH, IMPOSTOR_FRAGMENT, IMPOSTOR_VERTEX } from "./impostor-glsl";
import { BALL_VERTICES, IMPOSTOR_BYTES, ImpostorBuilder, QUAD_REACH, SCREEN_RISE, SCREEN_UP } from "./impostor";
import { Kind } from "./mesh";
import { TOWARD_VIEWER } from "./placement";
import { WORLD_FRAGMENT, WORLD_VERTEX } from "./shaders";
import { IMPOSTOR_WGSL } from "./webgpu/wgsl-impostor";

interface Corner {
  readonly centre: readonly number[];
  readonly foot: readonly number[];
  readonly radius: number;
  readonly colour: readonly number[];
  readonly info: readonly number[];
}

function corners(b: ImpostorBuilder): Corner[] {
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / IMPOSTOR_BYTES }, (_, i) => {
    const at = i * IMPOSTOR_BYTES;
    const f = (k: number): number => view.getFloat32(at + k * 4, true);
    const u = (k: number): number => view.getUint8(at + k);
    return { centre: [f(0), f(1), f(2)], foot: [f(3), f(4)], radius: f(5), colour: [u(24), u(25), u(26), u(27)], info: [u(28), u(29), u(30), u(31)] };
  });
}

describe("the impostor vertex", () => {
  it("is six corners a ball, two triangles covering the quad once", () => {
    const b = new ImpostorBuilder();
    b.ball({ centre: [1, 2, 3], foot: [1, 2], radius: 0.75, colour: [1, 0.5, 0], kind: Kind.foliage, seed: 0.5, age: 0.25, alpha: 0.8 });
    const made = corners(b);
    expect(b.balls).toBe(1);
    expect(made).toHaveLength(BALL_VERTICES);
    expect(made.map((c) => c.info[3])).toEqual([0, 1, 3, 0, 3, 2]);
    for (const corner of made) {
      expect(corner.centre).toEqual([1, 2, 3]);
      expect(corner.foot).toEqual([1, 2]);
      expect(corner.radius).toBe(0.75);
      expect(corner.colour).toEqual([255, 128, 0, 204]);
      expect(corner.info.slice(0, 3)).toEqual([Kind.foliage, 128, 64]);
    }
  });

  it("carries a cloud puff in screen pixels: centre, base line and radii", () => {
    const b = new ImpostorBuilder();
    b.skyPuff({ x: 40, y: 20, base: 24, radiusX: 9, radiusY: 5, colour: [1, 1, 1], seed: 0 });
    const [first] = corners(b);
    expect(first!.centre).toEqual([40, 20, 24]);
    expect(first!.foot).toEqual([9, 5]);
    expect(first!.radius).toBe(0);
    expect(first!.info[0]).toBe(Kind.cloud);
  });

  it("grows past its first buffer and starts again empty on reset, keeping its storage", () => {
    const b = new ImpostorBuilder();
    for (let i = 0; i < 500; i += 1) {
      b.ball({ centre: [i, 0, 0], foot: [i, 0], radius: 1, colour: [0, 0, 0], kind: Kind.smoke, seed: 0 });
    }
    expect(b.balls).toBe(500);
    expect(corners(b)[499 * BALL_VERTICES]!.centre[0]).toBe(499);
    b.reset();
    expect(b.balls).toBe(0);
    expect(b.bytesView().byteLength).toBe(0);
  });
});

describe("the screen's frame for a ball", () => {
  it("is the screen's up and the way to the viewer, both unit and square to each other and to x", () => {
    expect(SCREEN_RISE).toBe(Math.hypot(TILE_DEPTH, WALL_RISE));
    expect(Math.hypot(...SCREEN_UP)).toBeCloseTo(1, 12);
    expect(Math.hypot(...TOWARD_VIEWER)).toBeCloseTo(1, 12);
    expect(SCREEN_UP[0] * TOWARD_VIEWER[0] + SCREEN_UP[1] * TOWARD_VIEWER[1] + SCREEN_UP[2] * TOWARD_VIEWER[2]).toBeCloseTo(0, 12);
  });

  it("puts a step toward the viewer on the same pixel, and a step up the screen one SCREEN_RISE higher", () => {
    // Screen y rises by (ahead × TILE_DEPTH + up × WALL_RISE) per tile, as `placeVertex` places it.
    const rise = (v: readonly number[]): number => v[1]! * TILE_DEPTH + v[2]! * WALL_RISE;
    expect(rise(TOWARD_VIEWER)).toBeCloseTo(0, 12);
    expect(rise(SCREEN_UP)).toBeCloseTo(SCREEN_RISE, 12);
    // And toward the viewer is nearer: fewer rows ahead.
    expect(TOWARD_VIEWER[1]).toBeLessThan(0);
  });
});

describe("the impostor shaders", () => {
  it("are one description in two languages: the same reach, frame, kinds and cloud depth", () => {
    for (const source of [IMPOSTOR_VERTEX + IMPOSTOR_FRAGMENT, IMPOSTOR_WGSL]) {
      expect(source).toContain(String(QUAD_REACH));
      expect(source).toContain(String(SCREEN_RISE));
      expect(source).toContain(String(CLOUD_DEPTH));
      expect(source).toContain(String(TOWARD_VIEWER[1]));
    }
  });

  it("place a ball through the world's own projection, and write each pixel's depth", () => {
    expect(IMPOSTOR_VERTEX).toContain("place(foot, off, height * u_mirror)");
    expect(IMPOSTOR_WGSL).toContain("place(foot, off, height * mirror)");
    expect(IMPOSTOR_FRAGMENT).toContain("gl_FragDepth");
    expect(IMPOSTOR_WGSL).toContain("@builtin(frag_depth)");
  });

  it("march only smoke and clouds as volumes, never a crown", () => {
    expect(IMPOSTOR_FRAGMENT).toContain(`u_volume > 0.5 && v_kind != ${Kind.foliage}`);
    expect(IMPOSTOR_WGSL).toContain(`input.volume > 0.5 && input.kind != ${Kind.foliage}u`);
  });

  it("declare every uniform they share with the world as the world does, since `setWorld` fills both", () => {
    // A `uniform4f` on a `vec3` is a GL error that leaves the uniform at zero: a ball with no sun.
    const declared = (source: string): Map<string, string> =>
      new Map([...source.matchAll(/uniform\s+(\w+)\s+(u_\w+)/g)].map((m) => [m[2]!, m[1]!]));
    const world = declared(WORLD_VERTEX + WORLD_FRAGMENT);
    const balls = declared(IMPOSTOR_VERTEX + IMPOSTOR_FRAGMENT);
    const shared = [...balls.keys()].filter((name) => world.has(name));
    expect(shared).toContain("u_shading");
    for (const name of shared) {
      expect({ name, type: balls.get(name) }).toEqual({ name, type: world.get(name) });
    }
  });
});
