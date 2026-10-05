/**
 * The WebGPU backend: the same frame as the WebGL2 one, plus water that is
 * simulated rather than drawn.
 *
 * One command buffer a frame: the wave steps (compute, `wave-sim.ts`), the
 * mirror pass into the half-size reflection, then one 4× MSAA screen pass - sky,
 * solids, sheers, rain - resolved straight to the canvas. Per-draw data is a
 * storage array indexed by `firstInstance` (`uniform-pack.ts`), so the whole
 * frame is three uploads and one bind group per pass.
 *
 * `create` is the only way in, and it is async and may throw: an adapter or a
 * device can be refused, and a pipeline can fail validation. The caller
 * (`index.ts`) falls back to WebGL2 when it does.
 */

import type { DrawableHandle, DrawCall, FrameScene, FrameUniforms, LowpolyBackend } from "../backend";
import { VERTEX_BYTES } from "../mesh";
import { stillSky } from "../sky-light";
import { trailFrame, tripMirrorSky } from "../trip";
import { TrailGpu } from "./trail-gpu";
import { FIELD_SIZE } from "../../../game/water/puddle-field";
import { BufferUsage, TextureUsage } from "./gpu-flags";
import { createPipelines, type Pipelines } from "./pipelines";
import { GpuTargets } from "./targets";
import { DRAW_FLOATS, drawCount, FRAME_FLOATS, packDraws, packFrame, type DrawList } from "./uniform-pack";
import { waterTexels } from "../water-texels";
import { WaveSim } from "./wave-sim";
import { WaveSurface } from "./wave-surface";
import { packPasses, PASSES_FLOATS } from "./wgsl-passes";

interface GpuDrawable extends DrawableHandle {
  buffer: GPUBuffer | null;
  capacity: number;
}

/** Draws the per-draw array has room for before it is regrown. */
const INITIAL_DRAWS = 512;

/** A frame never steps the water by more than this, seconds: a stalled tab resumes calmly. */
const MAX_FRAME_S = 0.1;

export class WebGpuBackend implements LowpolyBackend {
  readonly kind = "webgpu";
  private readonly pipelines: Pipelines;
  private readonly targets: GpuTargets;
  private readonly waves: WaveSim;
  private readonly surface: WaveSurface;
  private readonly trail: TrailGpu;
  private readonly frameBuffer: GPUBuffer;
  private readonly passesBuffer: GPUBuffer;
  private readonly passesGroup: GPUBindGroup;
  private readonly mask: GPUTextureView;
  private readonly blank: GPUTextureView;
  private readonly repeat: GPUSampler;
  private readonly clamp: GPUSampler;
  private draws: GPUBuffer;
  private drawFloats = new Float32Array(INITIAL_DRAWS * DRAW_FLOATS);
  /** `[mirror pass, screen pass]`. */
  private groups: [GPUBindGroup, GPUBindGroup] | undefined;
  private readonly frameFloats = new Float32Array(FRAME_FLOATS);
  private readonly passesFloats = new Float32Array(PASSES_FLOATS);
  private lastSeconds: number | undefined;

  /** Ask the browser for a device and build everything, or throw so the caller can fall back. */
  static async create(canvas: HTMLCanvasElement, puddleField: Uint8Array, samples: number): Promise<WebGpuBackend> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "low-power" });
    if (adapter === null || adapter === undefined) {
      throw new Error("No WebGPU adapter");
    }
    const device = await adapter.requestDevice();
    // The DOM library has no `getContext("webgpu")` overload yet; this is the type the spec returns.
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (context === null) {
      throw new Error("No WebGPU canvas context");
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    // COPY_SRC so the trip's trails can keep the finished frame (`trail-gpu.ts`).
    context.configure({ device, format, alphaMode: "opaque", usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC });
    device.pushErrorScope("validation");
    const backend = new WebGpuBackend(device, context, format, puddleField, samples);
    const error = await device.popErrorScope();
    if (error !== null) {
      device.destroy();
      throw new Error(`WebGPU validation failed: ${error.message}`);
    }
    return backend;
  }

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    puddleField: Uint8Array,
    samples: number,
  ) {
    this.pipelines = createPipelines(device, format, samples);
    this.targets = new GpuTargets(device, format, samples);
    this.repeat = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.clamp = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.mask = this.waterMask(puddleField);
    this.blank = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: TextureUsage.TEXTURE_BINDING }).createView();
    this.waves = new WaveSim(device, this.mask, this.repeat);
    this.surface = new WaveSurface(device, this.waves.heightBuffers());
    this.trail = new TrailGpu(device, format);
    const uniform = (floats: number): GPUBuffer => device.createBuffer({ size: floats * 4, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    this.frameBuffer = uniform(FRAME_FLOATS);
    this.passesBuffer = uniform(PASSES_FLOATS);
    this.passesGroup = device.createBindGroup({ layout: this.pipelines.passesLayout, entries: [{ binding: 0, resource: { buffer: this.passesBuffer } }] });
    this.draws = this.drawBuffer(INITIAL_DRAWS);
  }

  createDrawable(bytes?: Uint8Array): DrawableHandle {
    const drawable: GpuDrawable = { buffer: null, capacity: 0, count: 0 };
    if (bytes !== undefined) {
      this.update(drawable, bytes);
    }
    return drawable;
  }

  update(handle: DrawableHandle, bytes: Uint8Array): void {
    const drawable = handle as GpuDrawable;
    drawable.count = bytes.byteLength / VERTEX_BYTES;
    if (bytes.byteLength === 0) {
      return;
    }
    if (drawable.buffer === null || drawable.capacity < bytes.byteLength) {
      drawable.buffer?.destroy();
      // Room to grow, so an actor mesh that varies frame to frame is not reallocated each time.
      drawable.capacity = Math.ceil((bytes.byteLength * 1.5) / 4) * 4;
      drawable.buffer = this.device.createBuffer({ size: drawable.capacity, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    }
    this.device.queue.writeBuffer(drawable.buffer, 0, bytes.buffer, bytes.byteOffset, Math.ceil(bytes.byteLength / 4) * 4);
  }

  render(frame: FrameUniforms, scene: FrameScene): void {
    const device = this.device;
    if (this.targets.fit(frame.width, frame.height) || this.groups === undefined) {
      this.groups = this.bindGroups();
    }
    // Mirror pass, then the screen's overhead world, ground, solids and sheers: draw n is entry n.
    const lists = [
      { calls: scene.mirrored, mirror: -1 },
      { calls: scene.overhead.grounds, mirror: 1, flip: 1 },
      { calls: scene.overhead.solids, mirror: 1, flip: 1 },
      { calls: scene.grounds, mirror: 1 },
      { calls: scene.solids, mirror: 1 },
      { calls: scene.sheers, mirror: 1 },
    ];
    this.uploadDraws(lists);
    const first = (list: number): number => drawCount(lists.slice(0, list));
    device.queue.writeBuffer(this.frameBuffer, 0, packFrame(frame, this.frameFloats));
    device.queue.writeBuffer(this.passesBuffer, 0, packPasses(frame, scene.rain, this.passesFloats));

    const encoder = device.createCommandEncoder();
    if (this.waves.encode(encoder, this.frameSeconds(frame.water.seconds), frame.water)) {
      this.surface.encode(encoder, this.waves.latestSlot());
    }
    const groups = this.groups ?? this.bindGroups();

    const sky = tripMirrorSky(stillSky(frame.atmosphere), frame.trip);
    const mirror = encoder.beginRenderPass({
      colorAttachments: [{ view: this.targets.mirror, clearValue: [sky[0], sky[1], sky[2], 1], loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: this.targets.mirrorDepth, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    mirror.setPipeline(this.pipelines.worldMirror);
    mirror.setBindGroup(0, groups[0]);
    drawCalls(mirror, scene.mirrored, first(0));
    mirror.end();

    const canvas = this.context.getCurrentTexture();
    const screen = encoder.beginRenderPass({
      colorAttachments: [screenAttachment(this.targets.screenColour, canvas.createView())],
      depthStencilAttachment: { view: this.targets.screenDepth, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    screen.setPipeline(this.pipelines.sky);
    screen.setBindGroup(0, this.passesGroup);
    screen.draw(3);
    // The trip's sky, in the back of the depth range; then the ground, so it hides what stands behind it.
    screen.setPipeline(this.pipelines.worldGround);
    screen.setBindGroup(0, groups[1]);
    drawCalls(screen, scene.overhead.grounds, first(1));
    screen.setPipeline(this.pipelines.worldSolid);
    drawCalls(screen, scene.overhead.solids, first(2));
    screen.setPipeline(this.pipelines.worldGround);
    drawCalls(screen, scene.grounds, first(3));
    screen.setPipeline(this.pipelines.worldSolid);
    drawCalls(screen, scene.solids, first(4));
    screen.setPipeline(this.pipelines.worldSheer);
    drawCalls(screen, scene.sheers, first(5));
    if (scene.rain.strength > 0) {
      screen.setPipeline(this.pipelines.rain);
      screen.setBindGroup(0, this.passesGroup);
      screen.draw(3);
    }
    screen.end();
    const trail = trailFrame(frame);
    if (trail !== undefined) {
      this.trail.encode(encoder, canvas, trail);
    }
    device.queue.submit([encoder.finish()]);
  }

  /** Seconds since the last frame on the shaders' clock, which wraps (`shaderSeconds`). */
  private frameSeconds(seconds: number): number {
    const last = this.lastSeconds ?? seconds;
    this.lastSeconds = seconds;
    const delta = seconds - last;
    return delta < 0 ? 1 / 60 : Math.min(delta, MAX_FRAME_S);
  }

  private uploadDraws(lists: readonly DrawList[]): void {
    const count = drawCount(lists);
    if (count * DRAW_FLOATS > this.drawFloats.length) {
      this.drawFloats = new Float32Array(count * 2 * DRAW_FLOATS);
      this.draws.destroy();
      this.draws = this.drawBuffer(count * 2);
      this.groups = this.bindGroups();
    }
    packDraws(lists, this.drawFloats);
    this.device.queue.writeBuffer(this.draws, 0, this.drawFloats, 0, count * DRAW_FLOATS);
  }

  private drawBuffer(draws: number): GPUBuffer {
    return this.device.createBuffer({ size: draws * DRAW_FLOATS * 4, usage: BufferUsage.STORAGE | BufferUsage.COPY_DST });
  }

  /** The world's bind groups: the mirror pass's, which reads no mirror, and the screen's. */
  private bindGroups(): [GPUBindGroup, GPUBindGroup] {
    const group = (mirror: GPUTextureView): GPUBindGroup =>
      this.device.createBindGroup({
        layout: this.pipelines.worldLayout,
        entries: [
          { binding: 0, resource: { buffer: this.frameBuffer } },
          { binding: 1, resource: { buffer: this.draws } },
          { binding: 2, resource: this.mask },
          { binding: 3, resource: this.repeat },
          { binding: 4, resource: mirror },
          { binding: 5, resource: this.clamp },
          { binding: 6, resource: this.surface.view },
        ],
      });
    return [group(this.blank), group(this.targets.mirror)];
  }

  /** The puddle field and the lakes, as the two-channel texture both water and waves read. */
  private waterMask(field: Uint8Array): GPUTextureView {
    const texture = this.device.createTexture({
      size: [FIELD_SIZE, FIELD_SIZE],
      format: "rg8unorm",
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture }, waterTexels(field), { bytesPerRow: FIELD_SIZE * 2 }, [FIELD_SIZE, FIELD_SIZE]);
    return texture.createView();
  }
}

/**
 * Where the screen pass draws: into the multisampled target, resolved to the
 * canvas - or, at one sample, straight into the canvas, which may not be a
 * resolve target for a single-sampled attachment.
 */
function screenAttachment(multisampled: GPUTextureView | null, canvas: GPUTextureView): GPURenderPassColorAttachment {
  // The sky covers every pixel first, so the clear colour never shows.
  const clearValue = [0, 0, 0, 1];
  return multisampled === null
    ? { view: canvas, loadOp: "clear", clearValue, storeOp: "store" }
    : { view: multisampled, resolveTarget: canvas, loadOp: "clear", clearValue, storeOp: "discard" };
}

/** Issue each draw with its index into the per-draw array as `firstInstance`. */
function drawCalls(pass: GPURenderPassEncoder, calls: readonly DrawCall[], first: number): void {
  calls.forEach((call, index) => {
    const drawable = call.drawable as GpuDrawable;
    if (drawable.count === 0 || drawable.buffer === null) {
      return;
    }
    pass.setVertexBuffer(0, drawable.buffer);
    pass.draw(drawable.count, 1, 0, first + index);
  });
}
