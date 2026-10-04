/**
 * Every render pipeline the WebGPU backend draws with, and the bind group
 * layouts they share. Built once.
 *
 * | Pipeline | Target | Depth | Blend |
 * | --- | --- | --- | --- |
 * | `worldMirror` | the reflection, single-sampled | written | none |
 * | `worldGround` | the screen, 4× MSAA; the land too, on a frame with a window round the hero | written | none |
 * | `worldSolid` | the screen, without discard | written, tested early | none |
 * | `worldSheer` | the screen | tested, not written | alpha |
 * | `sky`, `rain` | the screen | ignored | none / alpha |
 */

import { VERTEX_BYTES } from "../mesh";
import { ShaderStage } from "./gpu-flags";
import { RAIN_WGSL, SKY_WGSL } from "./wgsl-passes";
import { worldWgsl } from "./wgsl-world";

/** Samples per pixel on screen by default: low poly is all edges, and four smooths them. `?msaa=1` turns it off. */
export const DEFAULT_SAMPLES = 4;

export const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

/** The reflection's colour format. */
export const MIRROR_FORMAT: GPUTextureFormat = "rgba8unorm";

export interface Pipelines {
  readonly worldLayout: GPUBindGroupLayout;
  readonly passesLayout: GPUBindGroupLayout;
  readonly worldMirror: GPURenderPipeline;
  readonly worldGround: GPURenderPipeline;
  readonly worldSolid: GPURenderPipeline;
  readonly worldSheer: GPURenderPipeline;
  readonly sky: GPURenderPipeline;
  readonly rain: GPURenderPipeline;
}

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },
    { shaderLocation: 1, offset: 12, format: "float32x2" },
    { shaderLocation: 2, offset: 20, format: "snorm8x4" },
    { shaderLocation: 3, offset: 24, format: "unorm8x4" },
  ],
};

const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

export function createPipelines(device: GPUDevice, screenFormat: GPUTextureFormat, samples: number): Pipelines {
  const fragmentAndVertex = ShaderStage.VERTEX | ShaderStage.FRAGMENT;
  const worldLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: fragmentAndVertex, buffer: { type: "uniform" } },
      { binding: 1, visibility: ShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: ShaderStage.FRAGMENT, sampler: {} },
      { binding: 4, visibility: ShaderStage.FRAGMENT, texture: {} },
      { binding: 5, visibility: ShaderStage.FRAGMENT, sampler: {} },
      { binding: 6, visibility: ShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const passesLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: fragmentAndVertex, buffer: { type: "uniform" } }],
  });
  // Two builds of one shader: only what never needs to discard keeps the early depth test.
  const clipping = device.createShaderModule({ code: worldWgsl(true) });
  const standing = device.createShaderModule({ code: worldWgsl(false) });
  const worldPipeline = device.createPipelineLayout({ bindGroupLayouts: [worldLayout] });
  const worldWith = (world: GPUShaderModule, format: GPUTextureFormat, samples: number, sheer: boolean): GPURenderPipeline =>
    device.createRenderPipeline({
      layout: worldPipeline,
      vertex: { module: world, entryPoint: "vertexMain", buffers: [VERTEX_LAYOUT] },
      fragment: { module: world, entryPoint: "fragmentMain", targets: [{ format, blend: sheer ? ALPHA_BLEND : undefined }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: !sheer, depthCompare: sheer ? "less-equal" : "less" },
      multisample: { count: samples },
    });
  const passesPipeline = device.createPipelineLayout({ bindGroupLayouts: [passesLayout] });
  const screenPass = (code: string, entryPoint: string, blend: boolean): GPURenderPipeline => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: passesPipeline,
      vertex: { module, entryPoint: "screenVertex" },
      fragment: { module, entryPoint, targets: [{ format: screenFormat, blend: blend ? ALPHA_BLEND : undefined }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: "always" },
      multisample: { count: samples },
    });
  };
  return {
    worldLayout,
    passesLayout,
    worldMirror: worldWith(clipping, MIRROR_FORMAT, 1, false),
    worldGround: worldWith(clipping, screenFormat, samples, false),
    worldSolid: worldWith(standing, screenFormat, samples, false),
    worldSheer: worldWith(clipping, screenFormat, samples, true),
    sky: screenPass(SKY_WGSL, "skyFragment", false),
    rain: screenPass(RAIN_WGSL, "rainFragment", true),
  };
}
