/**
 * The air above the horizon at the screen's own resolution: `?sky=hd`.
 *
 * A `Backdrop` (`engine/game.ts`): the game draws it across the canvas first
 * and lays the 320×180 world over it, so it shows wherever the world drew
 * nothing - which, with `SkyLayer` painting only the ridges, is the band above
 * them. Everything that stands in the band - a tree on the far row, a mountain,
 * the rain - is still the world, drawn over the sky in its own pixels.
 *
 * Its colours are final: it sits behind the lighting pass rather than under
 * it, so it is handed the atmosphere's colours as they are, not pre-divided by
 * the ambient (`sky-hd.ts`). One `ScreenPass` a frame, over the rows above the
 * horizon line only; the CPU's share is writing the twenty-odd clouds on
 * screen into a small float texture (`writeCloudTexels`).
 */

import { uniqueKey, type Backdrop, type BackdropView, type Scene, type ScreenPass, type UniformValue } from "../engine";
import type { Atmosphere } from "./atmosphere";
import { FloatTexture } from "./gpu/float-texture";
import { SKY_FRAGMENT_SHADER } from "./gpu/sky-shader";
import type { HorizonLayout } from "./horizon";
import { CLOUD_TEXELS, MAX_SKY_CLOUDS, panoramaOffset, skyDrift, skyUniforms, writeCloudTexels } from "./sky-hd";

/** Logical rows past the horizon line the pass also covers: the ridges hide them, a shake may not. */
const SKIRT_ROWS = 2;

export class HdSkyLayer implements Backdrop {
  private pass!: ScreenPass;
  private data!: FloatTexture;
  private layout!: HorizonLayout;
  private width = 0;
  private readonly texels = new Float32Array(CLOUD_TEXELS * MAX_SKY_CLOUDS * 4);
  private clouds = 0;
  /** This moment's uniforms, or undefined before the first update - nothing to draw yet. */
  private uniforms: Record<string, UniformValue> | undefined;

  create(scene: Scene, layout: HorizonLayout, width: number): void {
    this.layout = layout;
    this.width = width;
    this.data = new FloatTexture(scene, uniqueKey("sky-clouds"), CLOUD_TEXELS, MAX_SKY_CLOUDS);
    this.pass = scene.add.screenPass({
      name: "hd sky",
      fragmentSource: SKY_FRAGMENT_SHADER,
      samplers: { u_cloudData: this.data.key },
    });
    scene.game.setBackdrop(this);
  }

  /** One moment of sky for a heading, a time of day and a clock. */
  update(turn: number, atmosphere: Atmosphere, elapsedMs: number): void {
    const offset = panoramaOffset(turn);
    this.clouds = writeCloudTexels(this.texels, {
      offset,
      drift: skyDrift(elapsedMs),
      overcast: atmosphere.overcast,
      width: this.width,
      skyHeight: this.layout.skyHeight,
    });
    if (this.clouds > 0) {
      this.data.write(0, 0, CLOUD_TEXELS, this.clouds, this.texels);
    }
    this.uniforms = skyUniforms(atmosphere, this.layout, this.width, { offset, elapsedMs });
  }

  render(view: BackdropView): void {
    if (this.uniforms === undefined) {
      return;
    }
    const rows = Math.ceil((this.layout.horizonY + SKIRT_ROWS - view.scrollY) * view.scale);
    this.uniforms.u_view = [view.scale, view.height, view.scrollX, view.scrollY];
    this.uniforms.u_clouds = this.clouds;
    this.pass.render({ x: 0, y: 0, width: view.width, height: Math.min(rows, view.height) }, view.height, this.uniforms);
  }
}
