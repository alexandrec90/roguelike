/**
 * The game's scenery, drawn by the shader and handed to Phaser as a texture.
 *
 * Phaser 4.2 is a WebGL1 renderer and the volume shader needs WebGL2 (see
 * `gpu/volume-shader.ts` for why the hash cannot be ported down), so the two do
 * not share a context. They do not need to: this layer keeps its own WebGL2
 * canvas, blits each finished body onto a plain 2D canvas the size of the render
 * target, and registers that canvas as a Phaser texture. Phaser draws one image.
 *
 * **The pixels never leave the GPU on the way to the screen.** No `readPixels`
 * anywhere — that call alone costs twenty times what rendering a body does. The
 * only CPU work per frame is one `drawImage` per body and one texture refresh.
 *
 * ## Depth, with one texture
 *
 * A tree has a row, the hero has a row, and whichever is nearer the camera is
 * drawn on top. One texture has one depth, so this keeps **two**: bodies behind
 * the hero and bodies in front of it, with the images' depths bracketing the
 * hero's own. Two draw calls buy correct occlusion without a texture per tree.
 *
 * ## Falling back
 *
 * A machine with no WebGL2 gets `null` from `createVolumeGl`, and every body
 * renders through the CPU path into ordinary `Graphics` objects — slower, and
 * pixel-for-pixel the same picture, which is the point of the port being a port.
 */

import Phaser from "phaser";

import { drawCloud } from "./draw-cloud";
import { cellFoot, TREE_SITES, type TreeSite } from "./field";
import { createVolumeGl, drawVolume, drawVolumeShadow, type VolumeGl } from "./gpu/volume-gl";
import { detailFor } from "./lod";
import { TILE_WIDTH } from "./projection";
import { stageTree } from "./trees";
import { SDF_CROWN } from "./trees/sdf-crown";
import type { SceneryEnv, SceneryInstance } from "./scenery";

/** Matches `hero-layer.ts`, so the brackets land either side of the hero. */
const RANK_ACTOR = 8;

interface Planted {
  readonly site: TreeSite;
  readonly instance: SceneryInstance;
  readonly foot: { readonly x: number; readonly y: number };
  /** Only used on the fallback path; one graphics object per body. */
  gfx?: Phaser.GameObjects.Graphics;
}

interface Surface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly texture: Phaser.Textures.CanvasTexture;
  readonly image: Phaser.GameObjects.Image;
}

export interface SceneryOptions {
  readonly light: { readonly x: number; readonly y: number };
  readonly elevation: number;
  readonly windStrength: number;
}

const DEFAULTS: SceneryOptions = {
  light: { x: -0.6, y: -0.8 },
  elevation: 0.7,
  windStrength: 1,
};

export class SceneryLayer {
  private gl: VolumeGl | null = null;
  private behind: Surface | null = null;
  private front: Surface | null = null;
  private planted: Planted[] = [];
  private groundTop = 0;
  private rows = 0;
  private options: SceneryOptions = DEFAULTS;

  create(
    scene: Phaser.Scene,
    groundTop: number,
    rows: number,
    size: { readonly width: number; readonly height: number },
    options: Partial<SceneryOptions> = {},
  ): void {
    this.groundTop = groundTop;
    this.rows = rows;
    this.options = { ...DEFAULTS, ...options };
    this.gl = createVolumeGl();

    this.planted = TREE_SITES.filter((site) => site.row < rows).map((site) => {
      const foot = cellFoot(site.column, site.row, groundTop);
      return {
        site,
        instance: SDF_CROWN.create(site.seed),
        foot: { x: foot.x + (site.offsetX ?? 0), y: foot.y },
      };
    });

    if (this.gl === null) {
      for (const body of this.planted) {
        body.gfx = scene.add.graphics().setDepth(body.site.row * TILE_WIDTH + RANK_ACTOR - 1);
      }
      return;
    }
    this.behind = surface(scene, "scenery-behind", size);
    this.front = surface(scene, "scenery-front", size);
  }

  /** `heroRow` decides which bodies are drawn over the hero and which under. */
  animate(deltaMs: number, elapsedMs: number, heroRow: number): void {
    for (const body of this.planted) {
      body.instance.step?.(deltaMs, this.envFor(body, elapsedMs));
    }
    if (this.gl === null || this.behind === null || this.front === null) {
      this.drawFallback(elapsedMs);
      return;
    }

    clear(this.behind);
    clear(this.front);
    for (const body of this.planted) {
      const target = body.site.row < heroRow ? this.behind : this.front;
      this.blit(target, body, elapsedMs);
    }
    this.behind.texture.refresh();
    this.front.texture.refresh();
    // Bracketing the hero's own depth is what makes a single texture per side
    // enough: everything in one is behind the hero, everything in the other is
    // in front, and nothing needs to interleave.
    const heroDepth = Math.round(heroRow) * TILE_WIDTH + RANK_ACTOR;
    this.behind.image.setDepth(heroDepth - 1);
    this.front.image.setDepth(heroDepth + 1);
  }

  private blit(target: Surface, body: Planted, elapsedMs: number): void {
    const env = this.envFor(body, elapsedMs);
    const parts = body.instance.volumes?.(env) ?? [];
    for (const part of parts) {
      if (this.gl === null) {
        return;
      }
      const shadow = drawVolumeShadow(this.gl, part.spec, part.light, {
        light: this.options.light,
        elevation: this.options.elevation,
      });
      target.context.drawImage(
        this.gl.canvas,
        body.foot.x + shadow.box.left,
        body.foot.y + shadow.box.top,
      );
      const drawn = drawVolume(this.gl, part.spec, part.light, part.clip);
      target.context.drawImage(
        this.gl.canvas,
        body.foot.x + drawn.box.left,
        body.foot.y + drawn.box.top,
      );
    }
  }

  private drawFallback(elapsedMs: number): void {
    for (const body of this.planted) {
      if (body.gfx === undefined) {
        continue;
      }
      body.gfx.clear();
      const env = this.envFor(body, elapsedMs);
      drawCloud(
        body.gfx,
        stageTree(body.instance, env, { shadow: true, elevation: this.options.elevation }),
        body.foot.x,
        body.foot.y,
      );
    }
  }

  private envFor(body: Planted, elapsedMs: number): SceneryEnv {
    return {
      elapsedMs,
      wind: { strength: this.options.windStrength, gustiness: 0.6 },
      light: this.options.light,
      fieldX: body.foot.x,
      fieldY: body.foot.y,
      // Rows are counted from the horizon, so a body high up the field is the
      // far one. Distance costs it detail, never a different model.
      //
      // The thresholds are fractions of the field rather than fixed row counts:
      // `lod.ts`'s defaults assume a deeper world than this scene has, and with
      // them every tree but the front row rendered flat. What "far" means has to
      // scale with how much field there is to be far across.
      detail: detailFor(this.rows - body.site.row, {
        nearRows: Math.max(2, Math.round(this.rows / 3)),
        midRows: Math.max(4, Math.round((this.rows * 2) / 3)),
      }),
    };
  }
}

function surface(
  scene: Phaser.Scene,
  key: string,
  size: { readonly width: number; readonly height: number },
): Surface | null {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  context.imageSmoothingEnabled = false;
  // A key already in the cache belongs to a previous run of this scene; reuse
  // rather than add, or a restart leaks a texture per scene creation.
  scene.textures.remove(key);
  const texture = scene.textures.addCanvas(key, canvas);
  if (texture === null) {
    return null;
  }
  const image = scene.add.image(0, 0, key).setOrigin(0, 0);
  return { canvas, context, texture, image };
}

function clear(target: Surface): void {
  target.context.clearRect(0, 0, target.canvas.width, target.canvas.height);
}
