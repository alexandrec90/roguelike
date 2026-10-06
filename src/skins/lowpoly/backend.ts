/**
 * What the low-poly skin asks of a graphics API, and which one it gets.
 *
 * The frame loop (`lowpoly-game.ts`) describes a frame - the uniforms, the
 * solid and sheer draws, the rain - and a backend renders it. Two backends:
 *
 * | Backend | Module | Water |
 * | --- | --- | --- |
 * | WebGPU (preferred) | `webgpu/webgpu-renderer.ts` | a wave simulation in a compute shader: rings spread, cross and bounce off the shore |
 * | WebGL2 (fallback) | `renderer.ts` | procedural rings, each a function of time |
 *
 * Both draw the same geometry through the same projection; only the water's
 * motion differs, because only WebGPU has compute. `?gpu=webgl` or
 * `?gpu=webgpu` forces one, for comparing them side by side.
 */

import type { Atmosphere } from "../../game/atmosphere";
import type { LowpolyCutaway } from "./cutaway";
import type { LowpolyView } from "./placement";
import type { SwayState } from "./sway";

/** A buffer of `mesh.ts` vertices on the GPU. */
export interface DrawableHandle {
  count: number;
}

/** One draw: a buffer, where its origin is from the hero, and the turn it is drawn at. */
export interface DrawCall {
  readonly drawable: DrawableHandle;
  /** Planet tiles from the hero to the buffer's origin. */
  readonly offset: readonly [number, number];
  /** The world's turn, or 0 for something built in the local frame. */
  readonly turn: number;
}

/** The water's state this frame, as the shaders read it. */
export interface WaterState {
  /** The hero's planet point: what a water pixel's planet point is measured from. */
  readonly hero: readonly [number, number];
  /** `waterLevel(wetness)`. */
  readonly level: number;
  readonly wetness: number;
  readonly rain: number;
  /** The shaders' clock, seconds (`shaderSeconds`). */
  readonly seconds: number;
  /** `RippleRing.slots`: footsteps and landings, as rings or as impulses. */
  readonly ripples: Float32Array;
}

export interface RainState {
  readonly strength: number;
  readonly seconds: number;
  /** Logical pixels across per pixel down. */
  readonly slant: number;
  /** 0..1, how bright a streak is: dimmer at night. */
  readonly light: number;
}

export interface FrameUniforms {
  readonly view: LowpolyView;
  readonly atmosphere: Atmosphere;
  readonly shake: { readonly x: number; readonly y: number };
  readonly water: WaterState;
  /** How far gone, 0..1 (`trip.ts`): 0 draws the skin as it was. Its clock is `water.seconds`. */
  readonly trip: number;
  /** Which of the trip's extra terms run, as `TRIP_FX` bits (`?fx=`). */
  readonly fx: number;
  /** The wind and the pushes that lean grass and foliage (`sway.ts`). */
  readonly sway: SwayState;
  /** The drawing buffer, device pixels. */
  readonly width: number;
  readonly height: number;
  /** The window round the hero, shake included; absent when no land stands over him. */
  readonly cutaway?: LowpolyCutaway;
}

/**
 * A whole frame: the ground (drawn once, never mirrored - the mirror *is* the
 * water lying on it), what stands (drawn twice, once mirrored), what is sheer,
 * and the rain.
 */
export interface FrameScene {
  readonly grounds: readonly DrawCall[];
  readonly solids: readonly DrawCall[];
  /**
   * The landforms: solid, and drawn as the solids are - except on a frame with
   * a `cutaway`, when they draw with the shader that can discard and lose the
   * early depth test for it.
   */
  readonly lands: readonly DrawCall[];
  /** The solids near enough that their reflection can land in water on screen (`MIRROR_ROWS`). */
  readonly mirrored: readonly DrawCall[];
  readonly sheers: readonly DrawCall[];
  /**
   * The trip's `sky`: the field's ground and what stands on it, drawn again
   * upside down about the horizon line before the world itself. Empty unless on.
   */
  readonly overhead: { readonly grounds: readonly DrawCall[]; readonly solids: readonly DrawCall[] };
  readonly rain: RainState;
}

export interface LowpolyBackend {
  readonly kind: GpuKind;
  /** A buffer for geometry, filled now (static) or every frame (`update`). */
  createDrawable(bytes?: Uint8Array): DrawableHandle;
  update(drawable: DrawableHandle, bytes: Uint8Array): void;
  render(frame: FrameUniforms, scene: FrameScene): void;
}

export type GpuKind = "webgpu" | "webgl";

/** `?gpu=` - a backend forced, or `auto` to take WebGPU wherever the browser has it. */
export type GpuChoice = GpuKind | "auto";

/**
 * `?msaa=` - samples per pixel on screen: 4 by default, smoothing every faceted
 * edge, or 1 to turn it off. Multisampling is paid in memory traffic on every
 * full-screen layer, which an integrated GPU sharing system memory feels most.
 */
export function parseMsaa(raw: string | null): 1 | 4 {
  return raw?.trim() === "1" ? 1 : 4;
}

export function parseGpu(raw: string | null): GpuChoice {
  const value = raw?.trim().toLowerCase();
  return value === "webgpu" || value === "webgl" ? value : "auto";
}

/**
 * Which backends to try, in order. WebGPU is preferred because only it can
 * simulate the water; anything that stops it - no `navigator.gpu`, no adapter,
 * a device or pipeline that fails - falls back to WebGL2 rather than leaving
 * the page black, even when WebGPU was asked for by name.
 */
export function backendOrder(choice: GpuChoice, hasWebGpu: boolean): readonly GpuKind[] {
  return choice === "webgl" || !hasWebGpu ? ["webgl"] : ["webgpu", "webgl"];
}
