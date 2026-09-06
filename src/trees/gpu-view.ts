/**
 * The tree lab's GPU half: blitting bodies, and diffing them against the CPU.
 *
 * Split out of `main.ts` when that file grew past its limit holding two jobs —
 * the render loop and the controls on one side, and this on the other. The seam
 * is real rather than arbitrary: nothing here touches the DOM chrome, the URL,
 * or the clock, and `main.ts` no longer needs to know how a body reaches the
 * screen once it has decided that one should.
 *
 * Two paths, and the difference between them is the whole point:
 *
 * - **Blitting** never reads pixels back. The shader renders into its own
 *   canvas and that canvas is `drawImage`d onto the page's, so the pixels go
 *   from the GPU to the screen without a stop in JavaScript. This is where the
 *   speed is.
 * - **Diffing** must read back, because comparing requires having both. It is
 *   the slow path on purpose, and it only runs when the lab is asked for it.
 */

import { paintCloud, paintCloudOnContext, type RasterBuffer } from "../game/cloud-raster";
import { burnInkFromGrid } from "../game/burnable";
import { hexToRgb } from "../game/color";
import { INK_COLORS, type PixelCloud } from "../game/ink";
import { drawVolume, drawVolumeShadow, readVolume, type VolumeGl } from "../game/gpu/volume-gl";
import { volumeCloud } from "../game/procgen/volume";
import type { SceneryEnv, SceneryInstance, VolumePart } from "../game/scenery";

/** Where a body's foot sits in the frame. */
export interface Foot {
  readonly footX: number;
  readonly footY: number;
}

/**
 * A body waiting to be blitted after the frame is flushed.
 *
 * Deferred rather than drawn in place because the two compositing paths cannot
 * be interleaved: the ground and the CPU species go through an `ImageData`
 * upload, and a `drawImage` issued before that upload would be painted over by
 * it.
 */
export interface GpuJob extends Foot {
  readonly parts: readonly VolumePart[];
  readonly overlay: PixelCloud;
}

export interface BlitOptions {
  readonly shadow: boolean;
  readonly light: { readonly x: number; readonly y: number };
  readonly elevation: number;
}

/** Draw the deferred bodies straight off the GPU canvas. No readback anywhere. */
export function blitJobs(
  gl: VolumeGl,
  context: CanvasRenderingContext2D,
  jobs: readonly GpuJob[],
  options: BlitOptions,
): void {
  for (const job of jobs) {
    for (const part of job.parts) {
      if (options.shadow) {
        // The shadow is its own pass over the same field, drawn first so the
        // body covers its own contact shadow.
        const shadow = drawVolumeShadow(gl, part.spec, part.light, {
          light: options.light,
          elevation: options.elevation,
        });
        context.drawImage(gl.canvas, job.footX + shadow.box.left, job.footY + shadow.box.top);
      }
      const drawn = drawVolume(gl, part.spec, part.light, part.clip, part.burn);
      context.drawImage(gl.canvas, job.footX + drawn.box.left, job.footY + drawn.box.top);
    }
    // Particles last, over everything the field drew.
    paintCloudOnContext(context, job.overlay, job.footX, job.footY);
  }
}

/**
 * Draw both renderers and mark every pixel they disagree about, returning the
 * count.
 *
 * The CPU picture goes down first for context, so the magenta is visible where
 * it happens rather than floating on black.
 */
export function diffBody(
  gl: VolumeGl,
  buffer: RasterBuffer,
  instance: SceneryInstance,
  env: SceneryEnv,
  at: Foot,
): number {
  paintCloud(buffer, instance.cloud(env), at.footX, at.footY);
  let mismatched = 0;
  for (const part of instance.volumes?.(env) ?? []) {
    const drawn = drawVolume(gl, part.spec, part.light, part.clip, part.burn);
    mismatched += diffPart(buffer, part, readVolume(gl, drawn), drawn, at);
  }
  return mismatched;
}

interface DrawnBox {
  readonly width: number;
  readonly height: number;
  readonly box: { readonly left: number; readonly top: number };
}

/**
 * Compare one part's GPU output against the **CPU render of that same part**.
 *
 * Per part, not against the finished buffer, and that distinction is the whole
 * test. Diffing against the composited cell reported 132 disagreements on the
 * chestnut, every one of them a trunk pixel the canopy had already painted
 * over; passing the fire to one path and not the other reported 216 on the
 * burning bush. Both times the shader was right and the measurement was wrong.
 * A parity check has to compare like with like or it invents its own failures.
 */
function diffPart(
  buffer: RasterBuffer,
  part: VolumePart,
  pixels: Uint8ClampedArray,
  drawn: DrawnBox,
  at: Foot,
): number {
  const reference = cpuReference(part);
  let differences = 0;
  for (let row = 0; row < drawn.height; row += 1) {
    for (let column = 0; column < drawn.width; column += 1) {
      const from = (row * drawn.width + column) * 4;
      const key = cellKey(drawn.box.left + column, drawn.box.top + row);
      if (agrees(pixels, from, reference.get(key))) {
        continue;
      }
      differences += 1;
      mark(buffer, at.footX + drawn.box.left + column, at.footY + drawn.box.top + row);
    }
  }
  return differences;
}

/** The CPU's answer for this part, burnt if it is on fire, as a colour per pixel. */
function cpuReference(part: VolumePart): Map<number, readonly [number, number, number]> {
  const body = volumeCloud(part.spec, part.light, part.clip);
  const drawn =
    part.burn === undefined
      ? body
      : burnInkFromGrid(part.burn.grid, body, part.burn.elapsedMs, part.burn.seed);

  const reference = new Map<number, readonly [number, number, number]>();
  for (const pixel of drawn) {
    const { r, g, b } = hexToRgb(INK_COLORS[pixel.ink]);
    reference.set(cellKey(pixel.x, pixel.y), [r, g, b]);
  }
  return reference;
}

function agrees(
  pixels: Uint8ClampedArray,
  from: number,
  cpu: readonly [number, number, number] | undefined,
): boolean {
  const onGpu = (pixels[from + 3] ?? 0) > 0;
  if (!onGpu) {
    // Neither drew here, which is agreement; or only the CPU did, which is not.
    return cpu === undefined;
  }
  // One channel of slack: the hash's final division is float64 on one side and
  // float32 on the other, and a level on a dither boundary can tip either way.
  return cpu !== undefined && cpu.every((channel, index) => Math.abs(channel - (pixels[from + index] ?? 0)) <= 1);
}

function cellKey(x: number, y: number): number {
  return (x + 512) * 4096 + (y + 512);
}

function mark(buffer: RasterBuffer, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
    return;
  }
  const at = (y * buffer.width + x) * 4;
  buffer.data[at] = 255;
  buffer.data[at + 1] = 68;
  buffer.data[at + 2] = 224;
  buffer.data[at + 3] = 255;
}
