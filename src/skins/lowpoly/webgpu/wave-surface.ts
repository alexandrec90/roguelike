/**
 * The simulated water as a texture the world shader can filter: height and
 * slope per cell, written once a frame from the latest heights.
 *
 * Reading the height buffer straight from the fragment shader took twenty
 * storage reads a water pixel (four bilinear samples for the slope, four reads
 * each, and one more for the height). Writing `(height, slope x, slope y)` into
 * a `rgba16float` texture here makes it one filtered, wrapping sample - the
 * grid's toroidal layout means `REPEAT` addressing is the wrap it already has -
 * and the world needs one bind group per pass rather than one per height buffer.
 * Measured on an Intel Gen 9 it saved nothing visible: the water's shading is
 * ~0.4 ms of a frame whose cost is fill. It is kept for the simpler wiring.
 */

import { ShaderStage, TextureUsage } from "./gpu-flags";
import { WAVE_N } from "./waves";

export const SURFACE_WGSL = `
@group(0) @binding(0) var<storage, read> heights: array<vec2f>;
@group(0) @binding(1) var surface: texture_storage_2d<rgba16float, write>;

const N = ${WAVE_N}i;

fn at(i: i32, j: i32) -> f32 {
  let w = ((vec2i(i, j) % N) + N) % N;
  return heights[w.y * N + w.x].x;
}

@compute @workgroup_size(8, 8)
fn writeSurface(@builtin(global_invocation_id) id: vec3u) {
  let i = i32(id.x);
  let j = i32(id.y);
  if (i >= N || j >= N) {
    return;
  }
  let dx = (at(i + 1, j) - at(i - 1, j)) * 0.5;
  let dy = (at(i, j + 1) - at(i, j - 1)) * 0.5;
  textureStore(surface, vec2i(i, j), vec4f(at(i, j), dx, dy, 0.0));
}
`;

export class WaveSurface {
  private readonly pipeline: GPUComputePipeline;
  private readonly groups: readonly [GPUBindGroup, GPUBindGroup];
  /** Height, slope x, slope y per cell: what the water shader samples. */
  readonly view: GPUTextureView;

  constructor(device: GPUDevice, heights: readonly [GPUBuffer, GPUBuffer]) {
    const texture = device.createTexture({
      size: [WAVE_N, WAVE_N],
      format: "rgba16float",
      usage: TextureUsage.STORAGE_BINDING | TextureUsage.TEXTURE_BINDING,
    });
    this.view = texture.createView();
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: ShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: ShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
      ],
    });
    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: SURFACE_WGSL }), entryPoint: "writeSurface" },
    });
    const group = (from: GPUBuffer): GPUBindGroup =>
      device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: from } }, { binding: 1, resource: this.view }] });
    this.groups = [group(heights[0]), group(heights[1])];
  }

  /** Write the surface from height buffer `slot`. */
  encode(encoder: GPUCommandEncoder, slot: 0 | 1): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups[slot]);
    pass.dispatchWorkgroups(WAVE_N / 8, WAVE_N / 8);
    pass.end();
  }
}
