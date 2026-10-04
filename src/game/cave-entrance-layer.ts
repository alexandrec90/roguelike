/**
 * Cave mouths on the overworld: placed like any body, drawn the same from every side.
 *
 * Each mouth in reach is a planet point (`caves.ts`), put on screen by
 * `localPlacement` - on the field, or smaller and higher on the horizon roll,
 * sunk and clipped past the horizon line - and sorted with the trees and the
 * hero by `standingDepth`. Its picture is a bake of `caveEntranceCloud` at the
 * scale it stands at, in whole twentieths, for the current light quantised as
 * the scenery's is: so the speck on the horizon and the mound the hero walks
 * into are one description sampled at two sizes, and only its position ever
 * turns with the world.
 */

import type { Image, Scene } from "../engine";

import { groundRow, localPlacement, localReach, type LocalBounds } from "./camera";
import { caveEntranceCloud, ENTRANCE_HEIGHT } from "./cave-entrance-art";
import { cavesNear } from "./caves";
import type { FrameContext } from "./frame-context";
import { rowsToSink } from "./horizon";
import { bakeCloud } from "./pixel-buffer";
import { installBuffer } from "./pixel-surface";
import { toLocal } from "./planet";
import { RANK, standingDepth } from "./projection";
import { lightKey, quantizeLight, type BakeLight } from "./scenery-bake";

/** Mouths drawn at once; more in reach than this are left to the nearest. */
const POOL = 4;

/** Scales are baked in steps of this: a ladder of rungs, as a body's horizon pictures are. */
const RUNGS = 20;

interface Baked {
  readonly key: string;
  readonly originX: number;
  readonly originY: number;
  readonly height: number;
}

export class CaveEntranceLayer {
  private scene!: Scene;
  private readonly images: Image[] = [];
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly baked = new Map<string, Baked>();
  private light = "";

  create(scene: Scene, bounds: LocalBounds): void {
    this.scene = scene;
    this.bounds = bounds;
    for (let index = 0; index < POOL; index += 1) {
      this.images.push(scene.add.image(-999, -999, "__DEFAULT").setOrigin(0, 0).setVisible(false));
    }
  }

  layout(bounds: LocalBounds): void {
    this.bounds = bounds;
  }

  /** Put every mouth away: the hero is inside one. */
  hide(): void {
    for (const image of this.images) {
      image.setVisible(false);
    }
  }

  update(ctx: FrameContext): void {
    const light = quantizeLight(ctx.atmosphere.light, ctx.atmosphere.elevation);
    this.relight(light);
    const reach = localReach(this.bounds) + rowsToSink(ENTRANCE_HEIGHT);
    const near = cavesNear(ctx.pose, reach)
      .map((cave) => ({ cave, local: toLocal(ctx.pose, cave) }))
      .sort((a, b) => Math.hypot(a.local.x, a.local.y) - Math.hypot(b.local.x, b.local.y));
    this.images.forEach((image, index) => {
      const mouth = near[index];
      if (mouth === undefined) {
        image.setVisible(false);
        return;
      }
      const placed = localPlacement(ctx.frame, mouth.local);
      if (!placed.visible) {
        image.setVisible(false);
        return;
      }
      const picture = this.bake(Math.round(placed.scale * RUNGS) / RUNGS, light);
      if (image.texture.key !== picture.key) {
        image.setTexture(picture.key);
      }
      image
        .setPosition(placed.x - picture.originX, placed.y - picture.originY)
        .setDepth(standingDepth(groundRow(ctx.frame, mouth.local), RANK.body))
        .setTint(ctx.shade.tint(placed.x, placed.y))
        .setVisible(true);
      clip(image, placed.clipY, picture.height);
    });
  }

  /** A new light drops the old bakes: the mouth is re-lit, rung by rung, as it is next drawn. */
  private relight(light: BakeLight): void {
    const key = lightKey(light);
    if (key === this.light) {
      return;
    }
    this.light = key;
    for (const picture of this.baked.values()) {
      this.scene.textures.remove(picture.key);
    }
    this.baked.clear();
  }

  private bake(scale: number, light: BakeLight): Baked {
    const id = `cave-mouth-${Math.round(scale * RUNGS)}-${this.light}`;
    let picture = this.baked.get(id);
    if (picture === undefined) {
      const { buffer, originX, originY } = bakeCloud(caveEntranceCloud(scale, light));
      installBuffer(this.scene.textures, id, buffer);
      picture = { key: id, originX, originY, height: buffer.height };
      this.baked.set(id, picture);
    }
    return picture;
  }
}

/** Cut a mouth off at the horizon line, past which its foot has sunk; nothing is cut this side of it. */
function clip(image: Image, clipY: number, height: number): void {
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
  image.setCrop(0, 0, image.width, Math.min(shown, height));
}
