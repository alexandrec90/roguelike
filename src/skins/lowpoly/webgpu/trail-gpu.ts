/**
 * The trip's `trails` on WebGPU: `trail-pass.ts`'s feedback, ported. After the
 * screen pass has resolved into the canvas, one more pass lays the kept last
 * frame over it - zoomed, spun and hue-turned a step - and then the canvas is
 * copied into the kept frame for next time. The canvas is configured with
 * `COPY_SRC` for that copy (`webgpu-renderer.ts`).
 */

import type { TrailFrame } from "../trip";
import { BufferUsage, ShaderStage, TextureUsage } from "./gpu-flags";

/** Floats in `Trail`: two `vec4f`. */
export const TRAIL_FLOATS = 8;

export const TRAIL_WGSL = `
struct Trail {
  warp: vec4f,    // keep, zoom, spin, hue: trailWarp
  centre: vec4f,  // the share of the screen the warp is about, from the top left; width / height
};

@group(0) @binding(0) var<uniform> trail: Trail;
@group(0) @binding(1) var lastFrame: texture_2d<f32>;
@group(0) @binding(2) var lastSampler: sampler;

@vertex
fn screenVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn trailFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(lastFrame));
  let aspect = vec2f(trail.centre.z, 1.0);
  var d = (position.xy / size - trail.centre.xy) * aspect;
  let c = cos(trail.warp.z);
  let s = sin(trail.warp.z);
  d = vec2f(d.x * c - d.y * s, d.x * s + d.y * c) * (1.0 - trail.warp.y);
  let last = textureSampleLevel(lastFrame, lastSampler, trail.centre.xy + d / aspect, 0.0).rgb;
  // hueTurn, as trip.ts writes it.
  let hc = cos(trail.warp.w);
  let hs = sin(trail.warp.w) * 0.5773502691896258;
  let grey = (last.r + last.g + last.b) / 3.0 * (1.0 - hc);
  let turned = last * hc + vec3f(last.b - last.g, last.r - last.b, last.g - last.r) * hs + grey;
  return vec4f(max(turned, vec3f(0.0)), trail.warp.x);
}
`;

/** `Trail`, in field order. */
export function packTrail(trail: TrailFrame, out: Float32Array = new Float32Array(TRAIL_FLOATS)): Float32Array {
  out.set([trail.keep, trail.zoom, trail.spin, trail.hue, trail.centre[0], trail.centre[1], trail.width / trail.height, 0]);
  return out;
}

export class TrailGpu {
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly uniforms: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly floats = new Float32Array(TRAIL_FLOATS);
  private last: GPUTexture | undefined;
  private group: GPUBindGroup | undefined;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: ShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: ShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    const module = device.createShaderModule({ code: TRAIL_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "screenVertex" },
      fragment: {
        module,
        entryPoint: "trailFragment",
        targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.uniforms = device.createBuffer({ size: TRAIL_FLOATS * 4, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  }

  /** Lay the kept frame over `canvas`, then keep `canvas`. The first frame at a size only keeps. */
  encode(encoder: GPUCommandEncoder, canvas: GPUTexture, trail: TrailFrame): void {
    const fresh = this.fit(canvas.width, canvas.height);
    if (!fresh && this.group !== undefined) {
      this.device.queue.writeBuffer(this.uniforms, 0, packTrail(trail, this.floats));
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: canvas.createView(), loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.group);
      pass.draw(3);
      pass.end();
    }
    encoder.copyTextureToTexture({ texture: canvas }, { texture: this.last! }, [canvas.width, canvas.height]);
  }

  /** Size the kept frame to the canvas; true when it was just remade and holds nothing yet. */
  private fit(width: number, height: number): boolean {
    if (this.last !== undefined && this.last.width === width && this.last.height === height) {
      return false;
    }
    this.last?.destroy();
    this.last = this.device.createTexture({ size: [width, height], format: this.format, usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST });
    this.group = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: this.last.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
    return true;
  }
}
