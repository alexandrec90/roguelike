/**
 * The game's scenery, drawn by the shader inside Phaser's own renderer.
 *
 * Each body is a handful of `GameObjects.Shader` quads — one per volume part,
 * plus one for its shadow — positioned at the body's foot and depth-sorted like
 * any other game object. That last point is the whole reason this file is as
 * short as it is: an earlier version rendered into a second WebGL2 context and
 * handed Phaser a texture, which meant one depth for all the scenery and a
 * hand-rolled behind/in-front split around the hero. Bodies that are ordinary
 * game objects interleave with the hero for nothing.
 *
 * The context is WebGL2 because `main.ts` hands Phaser one (`game.config.context`).
 * Phaser is happy on it, and its shader path compiles the `#version 300 es`
 * volume shader unchanged — same hash, same noise, same tree as the CPU.
 *
 * A machine without WebGL2 gets Phaser's own WebGL1 context, `webgl2Available`
 * is false, and every body renders through the CPU path into a `Graphics` —
 * slower, and pixel-for-pixel the same picture.
 */

import Phaser from "phaser";

import { drawCloud } from "./draw-cloud";
import { cellFoot, TREE_SITES, type TreeSite } from "./field";
import { MAX_SHADOW_REACH } from "./gpu/volume-uniforms";
import { volumeShaderConfig, type Quad } from "./gpu/volume-phaser";
import { detailFor } from "./lod";
import { RANK, TILE_WIDTH } from "./projection";
import { stageTree } from "./trees";
import { SDF_CROWN } from "./trees/sdf-crown";
import type { SceneryEnv, SceneryInstance, VolumePart } from "./scenery";

interface Planted {
  readonly site: TreeSite;
  readonly instance: SceneryInstance;
  readonly foot: { readonly x: number; readonly y: number };
  /** The pose this frame, read by every shader object's uniform callback. */
  parts: readonly VolumePart[];
  /** Only on the fallback path. */
  gfx?: Phaser.GameObjects.Graphics;
}

export interface SceneryOptions {
  readonly light: { readonly x: number; readonly y: number };
  readonly elevation: number;
  readonly windStrength: number;
  /** How many volume parts a species may have. One shader object per slot. */
  readonly maxParts: number;
}

const DEFAULTS: SceneryOptions = {
  light: { x: -0.6, y: -0.8 },
  elevation: 0.7,
  windStrength: 1,
  maxParts: 2,
};

export class SceneryLayer {
  private planted: Planted[] = [];
  private groundTop = 0;
  private rows = 0;
  private options: SceneryOptions = DEFAULTS;
  private onGpu = false;

  create(scene: Phaser.Scene, groundTop: number, rows: number, options: Partial<SceneryOptions> = {}): void {
    this.groundTop = groundTop;
    this.rows = rows;
    this.options = { ...DEFAULTS, ...options };
    // Narrowed rather than assumed: the renderer is a union, and a canvas
    // fallback has no context at all.
    const renderer = scene.game.renderer;
    this.onGpu = "gl" in renderer && renderer.gl instanceof WebGL2RenderingContext;

    this.planted = TREE_SITES.filter((site) => site.row < rows).map((site) => {
      const foot = cellFoot(site.column, site.row, groundTop);
      return {
        site,
        instance: SDF_CROWN.create(site.seed),
        foot: { x: foot.x + (site.offsetX ?? 0), y: foot.y },
        parts: [],
      };
    });

    for (const body of this.planted) {
      if (this.onGpu) {
        this.attachShaders(scene, body);
      } else {
        body.gfx = scene.add.graphics().setDepth(body.site.row * TILE_WIDTH + RANK.body);
      }
    }
  }

  animate(deltaMs: number, elapsedMs: number): void {
    for (const body of this.planted) {
      const env = this.envFor(body, elapsedMs);
      body.instance.step?.(deltaMs, env);
      // Read once per frame and held, because every shader object's uniform
      // callback asks for it and rebuilding the pose per object would let the
      // shadow disagree with the body it belongs to.
      body.parts = body.instance.volumes?.(env) ?? [];
      if (!this.onGpu) {
        this.drawFallback(body, env);
      }
    }
  }

  private attachShaders(scene: Phaser.Scene, body: Planted): void {
    const { footprint } = SDF_CROWN;
    const bodyQuad: Quad = {
      originX: -footprint.originX,
      originY: -footprint.originY,
      width: footprint.width,
      height: footprint.height,
    };
    // The ground a shadow can reach: the body's own width, plus the cap on how
    // far a shadow may rake either side of it.
    const shadowQuad: Quad = {
      originX: -footprint.originX - MAX_SHADOW_REACH,
      originY: 0,
      width: footprint.width + MAX_SHADOW_REACH * 2,
      height: MAX_SHADOW_REACH + 1,
    };
    const depth = body.site.row * TILE_WIDTH;

    for (let slot = 0; slot < this.options.maxParts; slot += 1) {
      const part = (): VolumePart | null => body.parts[slot] ?? null;
      this.addQuad(scene, body, shadowQuad, `shadow-${body.site.seed}-${slot}`, {
        part,
        shadow: () => ({ light: this.options.light, elevation: this.options.elevation }),
      }).setDepth(depth + RANK.shadow);
      this.addQuad(scene, body, bodyQuad, `body-${body.site.seed}-${slot}`, { part }).setDepth(
        depth + RANK.body,
      );
    }
  }

  private addQuad(
    scene: Phaser.Scene,
    body: Planted,
    quad: Quad,
    name: string,
    source: Parameters<typeof volumeShaderConfig>[2],
  ): Phaser.GameObjects.Shader {
    return scene.add
      .shader(
        volumeShaderConfig(name, quad, source),
        body.foot.x + quad.originX,
        body.foot.y + quad.originY,
        quad.width,
        quad.height,
      )
      .setOrigin(0, 0);
  }

  private drawFallback(body: Planted, env: SceneryEnv): void {
    if (body.gfx === undefined) {
      return;
    }
    body.gfx.clear();
    drawCloud(
      body.gfx,
      stageTree(body.instance, env, { shadow: true, elevation: this.options.elevation }),
      body.foot.x,
      body.foot.y,
    );
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
