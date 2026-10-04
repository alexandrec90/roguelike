/**
 * The WebGPU backend's off-screen textures, sized to the drawing buffer and
 * remade only when it changes: the multisampled colour and depth the screen is
 * drawn into (resolved to the canvas), and the half-size mirror and its depth.
 */

import { REFLECTION_SCALE } from "../reflection";
import { TextureUsage } from "./gpu-flags";
import { DEPTH_FORMAT, MIRROR_FORMAT } from "./pipelines";

export class GpuTargets {
  private width = 0;
  private height = 0;
  /** The multisampled colour target, or null at one sample, when the canvas is drawn into directly. */
  screenColour: GPUTextureView | null = null;
  screenDepth!: GPUTextureView;
  mirror!: GPUTextureView;
  mirrorDepth!: GPUTextureView;
  private owned: GPUTexture[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly screenFormat: GPUTextureFormat,
    private readonly samples: number,
  ) {}

  /** Make sure the textures fit a buffer this big; true when they were remade (bind groups must follow). */
  fit(width: number, height: number): boolean {
    if (width === this.width && height === this.height) {
      return false;
    }
    this.width = width;
    this.height = height;
    for (const texture of this.owned) {
      texture.destroy();
    }
    const attach = TextureUsage.RENDER_ATTACHMENT;
    const screen = { width, height };
    const half = { width: Math.max(1, Math.round(width * REFLECTION_SCALE)), height: Math.max(1, Math.round(height * REFLECTION_SCALE)) };
    const make = (size: { width: number; height: number }, format: GPUTextureFormat, samples: number, usage: number): GPUTexture =>
      this.device.createTexture({ size, format, sampleCount: samples, usage });
    const depth = make(screen, DEPTH_FORMAT, this.samples, attach);
    const mirror = make(half, MIRROR_FORMAT, 1, attach | TextureUsage.TEXTURE_BINDING);
    const mirrorDepth = make(half, DEPTH_FORMAT, 1, attach);
    const colour = this.samples > 1 ? make(screen, this.screenFormat, this.samples, attach) : null;
    this.owned = colour === null ? [depth, mirror, mirrorDepth] : [depth, mirror, mirrorDepth, colour];
    this.screenColour = colour?.createView() ?? null;
    this.screenDepth = depth.createView();
    this.mirror = mirror.createView();
    this.mirrorDepth = mirrorDepth.createView();
    return true;
  }
}
