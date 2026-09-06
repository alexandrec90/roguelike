/**
 * The game's scenery, drawn by the shader inside Phaser's own renderer.
 *
 * Each body is a handful of `GameObjects.Shader` quads - one per volume part,
 * plus one for its shadow - positioned at the body's foot and depth-sorted like
 * any other game object. That last point is the whole reason this file is as
 * short as it is: an earlier version rendered into a second WebGL2 context and
 * handed Phaser a texture, which meant one depth for all the scenery and a
 * hand-rolled behind/in-front split around the hero. Bodies that are ordinary
 * game objects interleave with the hero for nothing.
 *
 * The context is WebGL2 because `main.ts` hands Phaser one (`game.config.context`).
 * Phaser is happy on it, and its shader path compiles the `#version 300 es`
 * volume shader unchanged - same hash, same noise, same tree as the CPU.
 *
 * A machine without WebGL2 gets Phaser's own WebGL1 context, and every body
 * renders through the CPU path into a `Graphics` - slower, and pixel-for-pixel
 * the same picture.
 *
 * **A tree is a point feature, not a cell.** It has planet coordinates out of
 * `terrain.ts`, so it keeps its identity as the world scrolls and swings beneath
 * the hero, and it is drawn at its exact local position rather than snapped to
 * the screen's grid - which it may be, precisely because it is one body with a
 * foot and not a tile that has to meet its neighbours.
 *
 * **The horizon is part of the reach.** A body is asked for out to `ROLL_ROWS`
 * past the field's far edge, and `localPlacement` says where on the roll it
 * stands and how small it is; the shader then samples the same field at that
 * scale. A tree first seen as a speck on the horizon line is the tree the hero
 * later walks past, and nothing is swapped in between.
 *
 * Which is what the pool below is for. There are unboundedly many trees on a
 * round planet and a fixed number of shader objects, so a slot is *lent* to
 * whichever tree is in reach, keyed by the planet point it stands on: a tree
 * that holds its slot across a step keeps the sway it had built up, and one that
 * scrolls out of reach hands its slot to a tree scrolling in.
 */

import Phaser from "phaser";

import {
  localPlacement,
  localReach,
  localRow,
  type CameraFrame,
  type LocalBounds,
  type Placement,
} from "./camera";
import { drawCloud } from "./draw-cloud";
import { volumeShaderConfig, type Quad } from "./gpu/volume-phaser";
import { MAX_SHADOW_REACH } from "./gpu/volume-uniforms";
import { ROLL_ROWS } from "./horizon";
import type { PixelCloud } from "./ink";
import { detailFor } from "./lod";
import { toLocal, type PlanetPose } from "./planet";
import { volumeCloud } from "./procgen/volume";
import { RANK, TILE_WIDTH } from "./projection";
import type { SceneryEnv, SceneryInstance, VolumePart } from "./scenery";
import { bodiesInView, keyOf, lendSlots } from "./scenery-slots";
import { treesNear, type Feature } from "./terrain";
import { stageTree } from "./trees";
import { castShadow } from "./trees/foliage";
import { SDF_CROWN } from "./trees/sdf-crown";

/**
 * Bodies on screen at once. Tree density puts about twenty within the field
 * and roughly as many again on the roll, where they converge toward the centre
 * of the screen and so a wider swathe of planet fits across it.
 */
const SCENERY_POOL = 48;

/** One lent slot: the shader objects, and whichever tree currently holds them. */
interface Slot {
  /** The planet point of the tree in this slot, or null while it is idle. */
  key: string | null;
  feature: Feature | null;
  instance: SceneryInstance;
  /** The pose this frame, read by every shader object's uniform callback. */
  parts: readonly VolumePart[];
  /** Screen pixels per cloud pixel this frame - under 1 on the horizon roll. */
  scale: number;
  objects: readonly Phaser.GameObjects.Shader[];
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
  private slots: Slot[] = [];
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private width = 0;
  private options: SceneryOptions = DEFAULTS;
  private onGpu = false;
  /** The pose the candidates were swept for; they only change when it does. */
  private swept: PlanetPose | undefined;
  private candidates: readonly Feature[] = [];

  create(
    scene: Phaser.Scene,
    bounds: LocalBounds,
    width: number,
    options: Partial<SceneryOptions> = {},
  ): void {
    this.layout(bounds, width);
    this.options = { ...DEFAULTS, ...options };
    // Narrowed rather than assumed: the renderer is a union, and a canvas
    // fallback has no context at all.
    const renderer = scene.game.renderer;
    this.onGpu = "gl" in renderer && renderer.gl instanceof WebGL2RenderingContext;

    this.slots = Array.from({ length: SCENERY_POOL }, (_unused, index) => {
      const slot: Slot = {
        key: null,
        feature: null,
        instance: SDF_CROWN.create(index),
        parts: [],
        scale: 1,
        objects: [],
      };
      if (this.onGpu) {
        slot.objects = this.buildShaders(scene, slot, index);
      } else {
        slot.gfx = scene.add.graphics();
      }
      this.hide(slot);
      return slot;
    });
  }

  /** Re-cut the reach after a resize changed how much playfield there is. */
  layout(bounds: LocalBounds, width: number): void {
    this.bounds = bounds;
    this.width = width;
    this.swept = undefined;
  }

  animate(frame: CameraFrame, pose: PlanetPose, deltaMs: number, elapsedMs: number): void {
    this.lend(frame, pose);

    for (const slot of this.slots) {
      const feature = slot.feature;
      if (feature === null) {
        continue;
      }
      const local = toLocal(pose, feature);
      const placed = localPlacement(frame, local);
      const env = this.envFor(feature, local.y, elapsedMs);

      slot.instance.step?.(deltaMs, env);
      // Read once per frame and held, because every shader object's uniform
      // callback asks for it and rebuilding the pose per object would let the
      // shadow disagree with the body it belongs to.
      slot.parts = slot.instance.volumes?.(env) ?? [];
      slot.scale = placed.scale;

      // The affine row, even on the roll: it keeps decreasing with distance
      // where the roll's few scanlines would tie, so far bodies still sort.
      const depth = Math.round(localRow(frame, local)) * TILE_WIDTH;
      this.place(slot, placed, depth);
      if (!this.onGpu) {
        this.drawFallback(slot, env, placed);
      }
    }
  }

  /**
   * Lend each slot to a tree in view, preferring the one it already held.
   *
   * The choosing is `scenery-slots.ts`, which is pure and tested; what is left
   * here is applying its answer to the Phaser objects. A kept slot is left
   * entirely alone - that is the point of it - so the body inside keeps the sway
   * it had built up rather than snapping upright as the scan order changes.
   */
  private lend(frame: CameraFrame, pose: PlanetPose): void {
    const wanted = bodiesInView(this.sweep(pose), pose, {
      frame,
      bounds: this.bounds,
      width: this.width,
      footprintWidth: SDF_CROWN.footprint.width,
    });

    const plans = lendSlots(
      this.slots.map((slot) => slot.key),
      wanted,
    );

    for (const plan of plans) {
      const slot = this.slots[plan.index];
      if (slot === undefined) {
        continue;
      }
      if (plan.kept !== undefined) {
        slot.feature = plan.kept;
        continue;
      }
      if (plan.taken !== undefined) {
        slot.key = keyOf(plan.taken);
        slot.feature = plan.taken;
        // A new tenant is a different tree, so it gets its own body rather than
        // inheriting the shape the slot was last holding.
        slot.instance = SDF_CROWN.create(plan.taken.seed);
        slot.parts = [];
        this.show(slot);
        continue;
      }
      slot.key = null;
      slot.feature = null;
      this.hide(slot);
    }
  }

  /**
   * Every tree that could be in view, out to the horizon.
   *
   * Swept once per pose rather than once per frame: the pose the world is
   * sampled from is frozen for the length of a stride (`player.ts`), and the
   * sweep is a square of planet cells wide enough to reach the horizon in any
   * direction, which is a few thousand hashes - cheap once a step, wasteful
   * sixty times a second.
   */
  private sweep(pose: PlanetPose): readonly Feature[] {
    if (this.swept !== pose) {
      this.candidates = treesNear(pose, localReach(this.bounds) + ROLL_ROWS);
      this.swept = pose;
    }
    return this.candidates;
  }

  private buildShaders(
    scene: Phaser.Scene,
    slot: Slot,
    index: number,
  ): readonly Phaser.GameObjects.Shader[] {
    const { footprint } = SDF_CROWN;
    // The quads are the full-size footprint whatever the scale: a body on the
    // roll is smaller than its quad and the shader discards the rest, which
    // costs nothing next to resizing a game object per frame.
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

    const objects: Phaser.GameObjects.Shader[] = [];
    for (let part = 0; part < this.options.maxParts; part += 1) {
      const read = (): VolumePart | null => slot.parts[part] ?? null;
      const scale = (): number => slot.scale;
      objects.push(
        this.addQuad(scene, shadowQuad, `shadow-${index}-${part}`, RANK.shadow, {
          part: read,
          scale,
          shadow: () => ({ light: this.options.light, elevation: this.options.elevation }),
        }),
        this.addQuad(scene, bodyQuad, `body-${index}-${part}`, RANK.body, { part: read, scale }),
      );
    }
    return objects;
  }

  private addQuad(
    scene: Phaser.Scene,
    quad: Quad,
    name: string,
    rank: number,
    source: Parameters<typeof volumeShaderConfig>[2],
  ): Phaser.GameObjects.Shader {
    const object = scene.add
      .shader(volumeShaderConfig(name, quad, source), 0, 0, quad.width, quad.height)
      .setOrigin(0, 0);
    // Carried on the object so `place` can move a quad without re-deriving the
    // geometry it was built with.
    object.setData("offsetX", quad.originX);
    object.setData("offsetY", quad.originY);
    object.setData("rank", rank);
    return object;
  }

  /** Move one body's quads to where its foot now is, and re-sort them. */
  private place(slot: Slot, foot: { x: number; y: number }, depth: number): void {
    for (const object of slot.objects) {
      object
        .setPosition(
          foot.x + (object.getData("offsetX") as number),
          foot.y + (object.getData("offsetY") as number),
        )
        .setDepth(depth + (object.getData("rank") as number));
    }
    slot.gfx?.setDepth(depth + RANK.body);
  }

  private show(slot: Slot): void {
    for (const object of slot.objects) {
      object.setVisible(true);
    }
    slot.gfx?.setVisible(true);
  }

  private hide(slot: Slot): void {
    for (const object of slot.objects) {
      object.setVisible(false);
    }
    slot.gfx?.clear().setVisible(false);
  }

  /**
   * The CPU path: the staged body at full size, or on the roll the same parts
   * rasterised at the placement's scale - the species' own cache only knows
   * full-size poses, and a far body is cheap enough to draw fresh.
   */
  private drawFallback(slot: Slot, env: SceneryEnv, placed: Placement): void {
    if (slot.gfx === undefined) {
      return;
    }
    const elevation = this.options.elevation;
    const body: PixelCloud =
      placed.scale === 1
        ? stageTree(slot.instance, env, { shadow: true, elevation })
        : slot.parts.flatMap((part) => volumeCloud(part.spec, part.light, part.clip, placed.scale));
    const cloud: PixelCloud =
      placed.scale === 1 ? body : [...castShadow(body, { light: env.light, elevation }), ...body];
    slot.gfx.clear();
    drawCloud(slot.gfx, cloud, placed.x, placed.y);
  }

  /**
   * The body's world, this frame.
   *
   * The wind is sampled at the tree's *planet* point rather than at its position
   * on screen. That is the same reason a grass tuft is seeded from the planet:
   * anchored to the screen, a tree's sway would re-phase every time the hero took
   * a step, and a whole field of them would shiver in unison as the world slid.
   */
  private envFor(feature: Feature, distance: number, elapsedMs: number): SceneryEnv {
    const depth = Math.max(1, this.bounds.maxY);
    return {
      elapsedMs,
      wind: { strength: this.options.windStrength, gustiness: 0.6 },
      light: this.options.light,
      fieldX: feature.x,
      fieldY: feature.y,
      // Distance costs a body detail, never a different model. The thresholds
      // are fractions of the visible depth rather than fixed row counts:
      // `lod.ts`'s defaults assume a deeper world than this scene has, and with
      // them every tree but the nearest rendered flat. Nothing in view is ever
      // culled by distance - the horizon decides that, in `localPlacement`.
      detail: detailFor(distance, {
        nearRows: Math.max(2, Math.round(depth / 3)),
        midRows: Math.max(4, Math.round((depth * 2) / 3)),
        cullRows: depth + ROLL_ROWS + 1,
      }),
    };
  }
}
