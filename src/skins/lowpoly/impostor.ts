/**
 * Impostors: a ball drawn as one quad that faces the camera, the sphere worked
 * out per pixel in the shader (`impostor-glsl.ts`, `webgpu/wgsl-impostor.ts`).
 *
 * A faceted ball is dozens of triangles and still reads as facets; an impostor
 * is two triangles and is round at any size, lit from a true normal, and can
 * billow - its outline is a noise field in the shader, not geometry. So it is
 * what this skin draws soft things with: volcano smoke, the clouds, and (with
 * `?leaves=impostor`) the crowns of the trees. `?volume=1` raymarches the smoke
 * and the clouds through a density field instead of shading a surface.
 *
 * One vertex is `IMPOSTOR_BYTES`, interleaved, six to a ball:
 *
 * | Field  | Type        | A ball on the planet                         | A cloud puff in the sky          |
 * | ------ | ----------- | -------------------------------------------- | -------------------------------- |
 * | centre | 3 × float32 | tiles from the draw's origin, z up           | logical px x, y; its base line y |
 * | foot   | 2 × float32 | the body's foot, as `mesh.ts`' anchor        | its radii, px                    |
 * | radius | float32     | tiles                                        | 0                                |
 * | colour | 4 × uint8   | rgb, and opacity                             | rgb (the lit tone), and opacity  |
 * | info   | 4 × uint8   | kind (`Kind`), seed, age, corner             | the same                         |
 *
 * The foot does for a ball what the anchor does for a mesh: a tree's crown and
 * a plume's puffs are placed, shrunk and sunk on the lip about one foot, so
 * they never shear from the trunk or the vent they belong to.
 */

import { TILE_DEPTH, WALL_RISE } from "../../game/projection";
import { Kind, type Rgb, type Vec3 } from "./mesh";

export const IMPOSTOR_BYTES = 32;

/**
 * How far past its radius a ball's quad reaches: room for the billows the
 * shader pushes out of the outline. The shaders keep every lump inside it.
 */
export const QUAD_REACH = 1.35;

/**
 * Pixels up the screen per tile along the screen's up axis: the length of
 * (`TILE_DEPTH`, `WALL_RISE`), the one direction of the planet that rises
 * straight up the screen. A ball of radius r is `r × TILE_WIDTH` across and
 * `r × SCREEN_RISE` tall - an ellipse, as this projection makes every ball.
 */
export const SCREEN_RISE = Math.hypot(TILE_DEPTH, WALL_RISE);

/**
 * The screen's up axis and the way toward the viewer, as local directions (x
 * right, y ahead, z up): with x they are the frame a ball's per-pixel normal is
 * built in, so it lights in the same local frame as every mesh face.
 */
export const SCREEN_UP: Vec3 = [0, TILE_DEPTH / SCREEN_RISE, WALL_RISE / SCREEN_RISE];
export const TOWARD_VIEWER: Vec3 = [0, -WALL_RISE / SCREEN_RISE, TILE_DEPTH / SCREEN_RISE];

/** Vertices per ball: two triangles. */
export const BALL_VERTICES = 6;

/** The corners of a quad in the order its two triangles take them; bit 0 is right, bit 1 is up. */
const CORNERS = [0, 1, 3, 0, 3, 2] as const;

/** A ball standing on the planet. */
export interface Ball {
  readonly centre: Vec3;
  readonly foot: readonly [number, number];
  /** Tiles. */
  readonly radius: number;
  readonly colour: Rgb;
  readonly kind: Kind;
  /** 0..1. */
  readonly seed: number;
  /** 0..1: how far through its life (smoke). */
  readonly age?: number;
  /** 0..1. */
  readonly alpha?: number;
}

/** A cloud puff in the sky, in logical pixels: an ellipse cut flat at its base. */
export interface SkyPuff {
  readonly x: number;
  readonly y: number;
  /** The scanline it is cut flat at, below its centre. */
  readonly base: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly colour: Rgb;
  readonly seed: number;
  readonly alpha?: number;
}

export class ImpostorBuilder {
  private buffer = new ArrayBuffer(IMPOSTOR_BYTES * BALL_VERTICES * 32);
  private floats = new Float32Array(this.buffer);
  private bytes = new Uint8Array(this.buffer);
  private count = 0;

  /** Balls made so far. */
  get balls(): number {
    return this.count / BALL_VERTICES;
  }

  ball(ball: Ball): void {
    this.put(ball.centre, ball.foot, ball.radius, ball.colour, [ball.kind, ball.seed, ball.age ?? 0, ball.alpha ?? 1]);
  }

  skyPuff(puff: SkyPuff): void {
    this.put([puff.x, puff.y, puff.base], [puff.radiusX, puff.radiusY], 0, puff.colour, [Kind.cloud, puff.seed, 0, puff.alpha ?? 1]);
  }

  /** Exactly the vertices made, as one upload. */
  bytesView(): Uint8Array {
    return this.bytes.subarray(0, this.count * IMPOSTOR_BYTES);
  }

  /** Start again, keeping the storage: the smoke and the clouds are rebuilt every frame. */
  reset(): void {
    this.count = 0;
  }

  private put(centre: Vec3, foot: readonly [number, number], radius: number, colour: Rgb, info: readonly [Kind, number, number, number]): void {
    this.reserve(BALL_VERTICES);
    const [kind, seed, age, alpha] = info;
    for (const corner of CORNERS) {
      const base = this.count * IMPOSTOR_BYTES;
      const f = base / 4;
      this.floats[f] = centre[0];
      this.floats[f + 1] = centre[1];
      this.floats[f + 2] = centre[2];
      this.floats[f + 3] = foot[0];
      this.floats[f + 4] = foot[1];
      this.floats[f + 5] = radius;
      this.bytes[base + 24] = toByte(colour[0]);
      this.bytes[base + 25] = toByte(colour[1]);
      this.bytes[base + 26] = toByte(colour[2]);
      this.bytes[base + 27] = toByte(alpha);
      this.bytes[base + 28] = kind;
      this.bytes[base + 29] = toByte(seed);
      this.bytes[base + 30] = toByte(age);
      this.bytes[base + 31] = corner;
      this.count += 1;
    }
  }

  private reserve(vertices: number): void {
    const needed = (this.count + vertices) * IMPOSTOR_BYTES;
    if (needed <= this.buffer.byteLength) {
      return;
    }
    let size = this.buffer.byteLength * 2;
    while (size < needed) {
      size *= 2;
    }
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(this.bytes.subarray(0, this.count * IMPOSTOR_BYTES));
    this.buffer = grown;
    this.floats = new Float32Array(grown);
    this.bytes = new Uint8Array(grown);
  }
}

function toByte(unit: number): number {
  return Math.round(Math.min(Math.max(unit, 0), 1) * 255);
}
