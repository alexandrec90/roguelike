/**
 * The game's scenery: every tree, bush, boulder and mushroom ring, drawn from
 * bakes.
 *
 * Each body is two plain images — its body and its cast shadow — positioned at
 * its foot and depth-sorted like any other game object, so a trunk interleaves
 * with the hero for nothing. What the images *show* comes from
 * `scenery-cache.ts`: a body baked once per lean and per light, so a frame of
 * scenery is a handful of `setTexture` calls rather than a field evaluated per
 * pixel. (An earlier version drew each body through its own per-frame shader;
 * on an integrated GPU that cost a third of every frame. The shader still exists
 * — the tree lab renders with it and diffs it against the CPU — it is simply no
 * longer how the game draws.)
 *
 * **A body is a point feature, not a cell.** It has planet coordinates out of
 * `scenery-features.ts`, keeps its identity as the world scrolls and swings
 * beneath the hero, and is drawn at its exact local position rather than
 * snapped to the screen's grid.
 *
 * **The horizon is part of the reach.** A body is asked for out to `ROLL_ROWS`
 * past the field's far edge, and `localPlacement` says where on the roll it
 * stands and how small it is; there it draws a bake re-sampled at that scale. A
 * tree first seen as a speck on the horizon line is the tree the hero later
 * walks past. Every body's bakes are asked for at `create`, off the main thread
 * (`scenery-baker.ts`), so neither end of that walk waits on one.
 *
 * **The wind is sampled at the planet point**, never the screen position, so a
 * body's sway does not re-phase every time the hero takes a step, and a gust
 * rolls across a wood as the same travelling wave that rolls across the grass.
 */

import type { Image, Scene } from "../engine";
import { localPlacement, localReach, localRow, type LocalBounds } from "./camera";
import type { FrameContext } from "./frame-context";
import { fieldDepth, rowsToSink } from "./horizon";
import { toLocal, type PlanetPose } from "./planet";
import { RANK, standingDepth, TILE_WIDTH } from "./projection";
import { quantizeLight, windLevelIndex } from "./scenery-bake";
import { SceneryCache, type BakedTexture } from "./scenery-cache";
import { sceneryArchetypes, sceneryNear, speciesHeight, type SceneryFeature } from "./scenery-features";
import { bodiesInView, keyOf, lendSlots, TALLEST_BODY } from "./scenery-slots";
import { windAt } from "./wind";

/** Bodies on screen at once, field, roll and the sinking far side of the horizon together. */
const SCENERY_POOL = 256;

/** Milliseconds of texture uploads a held (not yet shown) frame may spend. */
const HOLD_UPLOAD_MS = 50;

/** The widest body a slot may hold — a full chestnut crown. */
const WIDEST_BODY = 80;

/** Shadows sit over the grass of their own row, under anything standing. */
const SHADOW_RANK = RANK.grass + 0.5;

interface Slot {
  key: string | null;
  feature: SceneryFeature | null;
  readonly body: Image;
  readonly shadow: Image;
  /** The wind this body last leaned to, eased so it never snaps between leans. */
  lean: number;
}

export class SceneryLayer {
  private slots: Slot[] = [];
  private cache!: SceneryCache;
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private width = 0;
  private swept: PlanetPose | undefined;
  private candidates: readonly SceneryFeature[] = [];

  create(scene: Scene, bounds: LocalBounds, width: number): void {
    this.layout(bounds, width);
    this.cache = new SceneryCache(scene.textures);
    this.cache.warm(sceneryArchetypes());
    this.slots = Array.from({ length: SCENERY_POOL }, () => ({
      key: null,
      feature: null,
      body: scene.add.image(-999, -999, "__DEFAULT").setOrigin(0, 0).setVisible(false),
      shadow: scene.add.image(-999, -999, "__DEFAULT").setOrigin(0, 0).setVisible(false),
      lean: 0,
    }));
  }

  /** Re-cut the reach after a resize changed how much playfield there is. */
  layout(bounds: LocalBounds, width: number): void {
    this.bounds = bounds;
    this.width = width;
    this.swept = undefined;
  }

  update(ctx: FrameContext): void {
    const atmosphere = ctx.atmosphere;
    this.cache.setLight(quantizeLight(atmosphere.light, atmosphere.elevation));
    this.lend(ctx);
    for (const slot of this.slots) {
      if (slot.feature !== null) {
        this.draw(slot, slot.feature, ctx);
      }
    }
    this.cache.pump();
  }

  /**
   * Whether every body has a picture to show yet. The scene holds its first
   * frame back until it does, so a load never shows the wood filling in.
   */
  ready(): boolean {
    // Nothing is on screen while the scene holds, so the uploads may have the frame.
    this.cache.pump(HOLD_UPLOAD_MS);
    return this.cache.warmed();
  }

  private draw(slot: Slot, feature: SceneryFeature, ctx: FrameContext): void {
    const local = toLocal(ctx.pose, feature);
    const placed = localPlacement(ctx.frame, local);
    if (!placed.visible) {
      hide(slot);
      return;
    }
    // The affine row, even on the roll: it keeps decreasing with distance where
    // the roll's few scanlines would tie, so far bodies still sort - among
    // themselves and with the landforms, which take their depth the same way.
    const row = Math.round(localRow(ctx.frame, local));

    if (placed.scale < 0.999) {
      const far = this.cache.scaled(feature, placed.scale);
      // Its full-size bakes in this light, before it reaches the field: one
      // asked for on arrival lands frames later, and the body changes again.
      this.cache.prewarm(feature);
      slot.shadow.setVisible(false);
      show(slot.body, far, placed.x, placed.y, standingDepth(row, RANK.body));
      clipAt(slot.body, placed.clipY);
      slot.body.setTint(ctx.shade.tint(placed.x, placed.y));
      return;
    }

    const wind = windAt(ctx.elapsedMs, feature.x * TILE_WIDTH, feature.y * TILE_WIDTH, ctx.wind);
    // Eased toward the field rather than set to it: a baked lean has no spring,
    // so the inertia the spring would have given is put back here.
    slot.lean += (wind - slot.lean) * Math.min(1, ctx.deltaMs / 180);
    // Lean and shadow fade out over the field's last row, so at the seam the
    // body is its ladder's full-size rung exactly and crosses without a snap.
    const depth = fieldDepth(placed.y, ctx.frame.groundTop);
    const lean = this.cache.lean(feature, windLevelIndex(slot.lean * depth));
    if (lean === undefined) {
      hide(slot);
      return;
    }
    show(slot.body, lean.body, placed.x, placed.y, standingDepth(row, RANK.body));
    clipAt(slot.body, placed.clipY);
    // A body stands over the cloud shadows' pass; the shadow at its foot is its tint.
    slot.body.setTint(ctx.shade.tint(placed.x, placed.y));
    const shadowAlpha = Math.min(1, ctx.atmosphere.shadowStrength * 1.15) * depth;
    if (lean.shadow === null || ctx.atmosphere.shadowStrength < 0.05 || shadowAlpha <= 0) {
      slot.shadow.setVisible(false);
    } else {
      show(slot.shadow, lean.shadow, placed.x, placed.y, standingDepth(row, SHADOW_RANK));
      slot.shadow.setAlpha(shadowAlpha);
    }
  }

  /**
   * Lend each slot to a body in view, preferring the one it already held.
   *
   * The choosing is `scenery-slots.ts`, which is pure and tested; a kept slot
   * keeps its eased lean, so a tree mid-sway does not snap upright because the
   * scan order changed.
   */
  private lend(ctx: FrameContext): void {
    const wanted = bodiesInView(this.sweep(ctx.pose), ctx.pose, {
      frame: ctx.frame,
      bounds: this.bounds,
      width: this.width,
      footprintWidth: WIDEST_BODY,
      heightOf: (feature) => speciesHeight((feature as SceneryFeature).species),
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
      } else if (plan.taken !== undefined) {
        slot.key = keyOf(plan.taken);
        slot.feature = plan.taken;
        slot.lean = 0;
      } else {
        slot.key = null;
        slot.feature = null;
        hide(slot);
      }
    }
  }

  /**
   * Every body that could be in view, out to the horizon — swept once per pose,
   * because the pose the world is sampled from is frozen for a stride.
   */
  private sweep(pose: PlanetPose): readonly SceneryFeature[] {
    if (this.swept !== pose) {
      this.candidates = sceneryNear(pose, localReach(this.bounds) + rowsToSink(TALLEST_BODY));
      this.swept = pose;
    }
    return this.candidates;
  }
}

function show(
  image: Image,
  baked: BakedTexture | undefined,
  footX: number,
  footY: number,
  depth: number,
): void {
  if (baked === undefined) {
    image.setVisible(false);
    return;
  }
  if (image.texture.key !== baked.key || (baked.frame !== undefined && String(image.frameName) !== String(baked.frame))) {
    image.setTexture(baked.key, baked.frame);
  }
  image
    .setPosition(footX - baked.originX, footY - baked.originY)
    .setDepth(depth)
    .setVisible(true);
}

/**
 * Cut a body off at the horizon line, for one past it: its foot has sunk
 * below the line and only what still stands above it shows. Nothing is cut
 * this side of the horizon.
 */
function clipAt(image: Image, clipY: number): void {
  if (!image.visible) {
    return;
  }
  if (!Number.isFinite(clipY)) {
    if (image.isCropped) {
      image.setCrop();
    }
    return;
  }
  const shown = Math.floor(clipY - image.y);
  if (shown <= 0) {
    image.setVisible(false);
    return;
  }
  image.setCrop(0, 0, image.width, Math.min(shown, image.height));
}

function hide(slot: Slot): void {
  slot.body.setVisible(false);
  slot.shadow.setVisible(false);
}
