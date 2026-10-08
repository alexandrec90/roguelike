/**
 * The wave simulation on the GPU: `waves.ts`'s step as a compute shader, run a
 * fixed number of times a second over a 512 × 512 planet-fixed grid round the
 * hero, ping-ponging between two buffers.
 *
 * Disturbances: every step, each water cell may be struck by a raindrop (a
 * seeded hash of the planet cell and the step, so it is the same storm on every
 * run); on a frame's first step, the footsteps and landings `WetWorld` recorded
 * since the last frame push the surface down where they land. The wave equation
 * does the rest - the rings, their crossing, and their bounce off the shore.
 */

import type { WaterState } from "../backend";
import { BufferUsage, ShaderStage } from "./gpu-flags";
import { MAX_RIPPLES } from "../water-glsl";
import {
  DROP_CHANCE,
  DROP_KICK,
  MAX_WAVE_STEPS,
  PLANET_CELLS,
  WAVE_DAMP,
  WAVE_K,
  WAVE_N,
  WAVE_RES,
  WAVE_STEP_S,
  heroCellOf,
} from "./waves";

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** Bytes between per-step uniform slots: WebGPU's dynamic-offset alignment. */
const STEP_STRIDE = 512;

/** Floats in `Step`: three `vec4f`, then `MAX_RIPPLES` impulses. */
const STEP_FLOATS = (3 + MAX_RIPPLES) * 4;

/** How hard a footstep pushes the surface down, and over how wide a patch, tiles. */
const IMPULSE_PUSH = 0.22;
const IMPULSE_RADIUS = 0.07;

export const WAVE_WGSL = `
struct Step {
  hero: vec4f,     // hero cell x, y; the last step's hero cell x, y
  params: vec4f,   // water level, drop chance, step number, impulses this step (1 or 0)
  extra: vec4f,    // impulse count
  impulses: array<vec4f, ${MAX_RIPPLES}>, // planet x, y, -, strength
};

@group(0) @binding(0) var<uniform> sim: Step;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(3) var waterMask: texture_2d<f32>;
@group(0) @binding(4) var maskSampler: sampler;

const N = ${WAVE_N}i;
const PLANET_CELLS = ${PLANET_CELLS}i;
const RES = ${f(WAVE_RES)};
const LAP = ${f(PLANET_CELLS / WAVE_RES)};
const K = ${WAVE_K};
const DAMP = ${WAVE_DAMP};
const DROP_KICK = ${f(DROP_KICK)};
const PUSH = ${IMPULSE_PUSH};
const RADIUS = ${IMPULSE_RADIUS};

fn windowCell(index: vec2i, hero: vec2i) -> vec2i {
  return hero + ((((index - hero) % N) + N + N / 2) % N) - N / 2;
}

fn at(i: i32, j: i32) -> f32 {
  let w = ((vec2i(i, j) % N) + N) % N;
  return src[w.y * N + w.x].x;
}

fn hash(x: u32, y: u32, z: u32) -> f32 {
  var h = (x * 1597334673u) ^ (y * 3812015801u) ^ (z * 2798796415u);
  h ^= h >> 15u;
  h *= 2246822519u;
  h ^= h >> 13u;
  h *= 3266489917u;
  h ^= h >> 16u;
  return f32(h) / 4294967295.0;
}

@compute @workgroup_size(8, 8)
fn stepWaves(@builtin(global_invocation_id) id: vec3u) {
  let i = i32(id.x);
  let j = i32(id.y);
  if (i >= N || j >= N) {
    return;
  }
  let index = j * N + i;
  let cell = windowCell(vec2i(i, j), vec2i(sim.hero.xy));
  if (any(cell != windowCell(vec2i(i, j), vec2i(sim.hero.zw)))) {
    dst[index] = vec2f(0.0);
    return;
  }
  let planet = (vec2f(cell) + 0.5) / RES;
  let mask = textureSampleLevel(waterMask, maskSampler, planet / LAP, 0.0);
  if (!(mask.r > sim.params.x || mask.g > 0.5)) {
    dst[index] = vec2f(0.0);
    return;
  }
  let here = src[index];
  let laplacian = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1) - 4.0 * here.x;
  var next = (2.0 * here.x - here.y + K * laplacian) * DAMP;
  // A drop presses a little dimple, not one cell: a one-cell kick is grid-scale
  // noise the scheme cannot carry away, where a dimple spreads as a ring.
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let wrapped = (((cell + vec2i(di, dj)) % PLANET_CELLS) + PLANET_CELLS) % PLANET_CELLS;
      if (hash(u32(wrapped.x), u32(wrapped.y), u32(sim.params.z)) < sim.params.y) {
        next -= DROP_KICK * exp2(-f32(di * di + dj * dj));
      }
    }
  }
  if (sim.params.w > 0.5) {
    for (var k = 0; k < i32(sim.extra.x); k++) {
      let impulse = sim.impulses[k];
      var d = planet - impulse.xy;
      d -= LAP * floor(d / LAP + 0.5);
      next -= impulse.w * PUSH * exp(-dot(d, d) / (RADIUS * RADIUS));
    }
  }
  dst[index] = vec2f(next, here.x);
}
`;

/** Steps to take for a frame of `seconds`, and the time carried to the next. */
export function stepsFor(carried: number, seconds: number): { steps: number; carried: number } {
  const total = carried + Math.max(seconds, 0);
  const steps = Math.min(Math.floor(total / WAVE_STEP_S), MAX_WAVE_STEPS);
  const left = total - steps * WAVE_STEP_S;
  // Past the cap, drop the backlog: a long frame must not leave a debt that runs the sim flat out.
  return { steps, carried: steps === MAX_WAVE_STEPS ? Math.min(left, WAVE_STEP_S) : left };
}

/**
 * Footsteps and landings born since the last frame: a slot whose birth time is
 * new. `seen` holds each slot's last birth and is updated in place.
 */
export function freshImpulses(ripples: Float32Array, seen: Float32Array): number[][] {
  const fresh: number[][] = [];
  for (let slot = 0; slot < ripples.length / 4; slot += 1) {
    const birth = ripples[slot * 4 + 2] ?? 0;
    const strength = ripples[slot * 4 + 3] ?? 0;
    if (strength > 0 && birth !== seen[slot]) {
      fresh.push([ripples[slot * 4] ?? 0, ripples[slot * 4 + 1] ?? 0, 0, strength]);
    }
    seen[slot] = birth;
  }
  return fresh;
}

export class WaveSim {
  private readonly buffers: [GPUBuffer, GPUBuffer];
  private readonly steps: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  /** `groups[k]` reads buffer k and writes the other. */
  private readonly groups: [GPUBindGroup, GPUBindGroup];
  private latestIndex: 0 | 1 = 0;
  private carried = 0;
  private stepNumber = 0;
  private hero: [number, number] | undefined;
  private readonly seen = new Float32Array(MAX_RIPPLES).fill(-1);
  private readonly slot = new Float32Array(STEP_FLOATS);

  constructor(
    private readonly device: GPUDevice,
    mask: GPUTextureView,
    sampler: GPUSampler,
  ) {
    const size = WAVE_N * WAVE_N * 8;
    const make = (): GPUBuffer => device.createBuffer({ size, usage: BufferUsage.STORAGE });
    this.buffers = [make(), make()];
    this.steps = device.createBuffer({ size: STEP_STRIDE * MAX_WAVE_STEPS, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: ShaderStage.COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: STEP_FLOATS * 4 } },
        { binding: 1, visibility: ShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: ShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: ShaderStage.COMPUTE, texture: {} },
        { binding: 4, visibility: ShaderStage.COMPUTE, sampler: {} },
      ],
    });
    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: WAVE_WGSL }), entryPoint: "stepWaves" },
    });
    const group = (from: GPUBuffer, to: GPUBuffer): GPUBindGroup =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.steps, size: STEP_FLOATS * 4 } },
          { binding: 1, resource: { buffer: from } },
          { binding: 2, resource: { buffer: to } },
          { binding: 3, resource: mask },
          { binding: 4, resource: sampler },
        ],
      });
    this.groups = [group(this.buffers[0], this.buffers[1]), group(this.buffers[1], this.buffers[0])];
  }

  /** Both height buffers: the renderer keeps a bind group reading each. */
  heightBuffers(): readonly [GPUBuffer, GPUBuffer] {
    return this.buffers;
  }

  /** Which of `heightBuffers` holds the latest heights, 0 or 1. */
  latestSlot(): 0 | 1 {
    return this.latestIndex;
  }

  /** Step the water for a frame of `seconds`, recording the dispatches into `encoder`; true when it stepped. */
  encode(encoder: GPUCommandEncoder, seconds: number, water: WaterState): boolean {
    const plan = stepsFor(this.carried, seconds);
    this.carried = plan.carried;
    const hero: [number, number] = [heroCellOf(water.hero[0]), heroCellOf(water.hero[1])];
    const impulses = freshImpulses(water.ripples, this.seen);
    if (plan.steps === 0) {
      // Too short a frame to step - keep its impulses for the next one that does.
      this.unsee(impulses, water.ripples);
      return false;
    }
    const previous = this.hero ?? hero;
    for (let index = 0; index < plan.steps; index += 1) {
      this.slot.fill(0);
      this.slot.set([hero[0], hero[1], index === 0 ? previous[0] : hero[0], index === 0 ? previous[1] : hero[1]], 0);
      this.slot.set([water.level, water.rain * DROP_CHANCE, this.stepNumber, index === 0 ? 1 : 0], 4);
      this.slot.set([impulses.length, 0, 0, 0], 8);
      impulses.forEach((impulse, k) => this.slot.set(impulse, 12 + k * 4));
      this.device.queue.writeBuffer(this.steps, index * STEP_STRIDE, this.slot);
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.groups[this.latestIndex], [index * STEP_STRIDE]);
      pass.dispatchWorkgroups(WAVE_N / 8, WAVE_N / 8);
      pass.end();
      this.latestIndex = this.latestIndex === 0 ? 1 : 0;
      this.stepNumber += 1;
    }
    this.hero = hero;
    return true;
  }

  /** Forget that these slots were seen, so the next stepping frame applies them. */
  private unsee(impulses: readonly number[][], ripples: Float32Array): void {
    if (impulses.length === 0) {
      return;
    }
    for (let slot = 0; slot < MAX_RIPPLES; slot += 1) {
      if ((ripples[slot * 4 + 3] ?? 0) > 0 && impulses.some((impulse) => impulse[0] === ripples[slot * 4] && impulse[1] === ripples[slot * 4 + 1])) {
        this.seen[slot] = -1;
      }
    }
  }
}
