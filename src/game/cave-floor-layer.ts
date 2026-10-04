/**
 * The cave chamber's floor, laid over the field while the hero is inside.
 *
 * Built the way the overworld's ground is (`ground-layer.ts`): one surface the
 * size of the grid, re-tiled only when the pose the world is sampled from
 * changes, and moved by the scroll every frame - so it slides and turns under
 * him exactly as the grass did. Each cell asks `floorCell` what its planet
 * point is, and a tile is baked the first time it is asked for.
 *
 * It sits over the ground and the water and under the band, and fades in and
 * out with the horizon: during a change of realm every pixel follows the same
 * mask as the band above (`composeMasked`), so the floor and the walls sweep
 * in as one picture.
 *
 * The way out is lit: the mouth's tiles are the stone the day falls on, and a
 * pool of daylight is pushed into the frame's lights there.
 */

import type { Scene } from "../engine";

import { localOrigin, localPlacement, scrollOffset, type CameraFrame, type LocalBounds } from "./camera";
import { floorCell, floorKeyId, floorTileCloud, type FloorKey } from "./cave-floor";
import type { Cave } from "./caves";
import type { FrameContext } from "./frame-context";
import { composeMasked, transitionProgress, type HorizonTransition } from "./horizon-transition";
import { INK_COLORS } from "./ink";
import { blitBuffer, createBuffer, paintInto, type PixelBuffer } from "./pixel-buffer";
import { PixelSurface } from "./pixel-surface";
import { localFrame, toLocal, type PlanetPose } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { CAVE } from "./realm";
import { PUDDLE_DEPTH } from "./water-layer";

/** Over the field's ground and water, under the horizon band. */
export const CAVE_FLOOR_DEPTH = PUDDLE_DEPTH + 5;

/** The daylight falling through the mouth, logical pixels of reach. */
const EXIT_LIGHT_RADIUS = 40;

const TILES = new Map<string, PixelBuffer>();

function floorTile(key: FloorKey): PixelBuffer {
  const id = floorKeyId(key);
  let tile = TILES.get(id);
  if (tile === undefined) {
    tile = createBuffer(TILE_WIDTH, TILE_DEPTH);
    paintInto(tile, floorTileCloud(key), 0, 0);
    TILES.set(id, tile);
  }
  return tile;
}

export class CaveFloorLayer {
  private scene!: Scene;
  private surface: PixelSurface | undefined;
  /** The floor as tiled, before any mask: what a change of realm reveals. */
  private tiled: PixelBuffer | undefined;
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private origin = { x: 0, y: 0 };
  private sampled: { readonly pose: PlanetPose; readonly cave: Cave } | undefined;
  /** Whether the surface holds the whole floor unmasked, as last committed. */
  private whole = false;

  create(scene: Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    this.layout(frame, bounds);
  }

  /** (Re)build the surface for a grid of this size - on every resize, as the ground does. */
  layout(frame: CameraFrame, bounds: LocalBounds): void {
    this.surface?.destroy();
    this.bounds = bounds;
    this.origin = localOrigin({ ...frame, phaseX: 0, phaseY: 0 }, { x: bounds.minX, y: bounds.maxY });
    const width = (bounds.maxX - bounds.minX + 1) * TILE_WIDTH;
    const height = (bounds.maxY - bounds.minY + 1) * TILE_DEPTH;
    this.surface = new PixelSurface(this.scene, width, height, "cave-floor");
    this.surface.image.setDepth(CAVE_FLOOR_DEPTH).setVisible(false);
    this.tiled = createBuffer(width, height);
    this.sampled = undefined;
    this.whole = false;
  }

  /** Hide the floor: under the sky, with no change in flight. */
  hide(): void {
    this.surface?.image.setVisible(false);
  }

  /**
   * One frame inside `cave`, or changing to or from it: re-tile if the pose
   * moved, mask by `transition` while one is in flight, scroll, and light the
   * way out.
   */
  update(ctx: FrameContext, cave: Cave, transition: HorizonTransition | undefined): void {
    const surface = this.surface;
    const tiled = this.tiled;
    if (surface === undefined || tiled === undefined) {
      return;
    }
    const retiled = this.sampled?.pose !== ctx.pose || this.sampled.cave !== cave;
    if (retiled) {
      this.tile(tiled, ctx.pose, cave);
      this.sampled = { pose: ctx.pose, cave };
    }
    const offset = scrollOffset(ctx.frame);
    const x = this.origin.x + offset.x;
    const y = this.origin.y + offset.y;
    surface.image.setPosition(x, y).setVisible(true);
    if (transition !== undefined) {
      const inward = transition.to === CAVE;
      composeMasked(surface.buffer, inward ? undefined : tiled, inward ? tiled : undefined, {
        style: transition.style,
        progress: transitionProgress(transition, ctx.elapsedMs),
        originX: x,
        originY: y,
        screenWidth: ctx.width,
        screenHeight: ctx.height,
      });
      surface.touch().commit();
      this.whole = false;
    } else if (retiled || !this.whole) {
      surface.buffer.data.set(tiled.data);
      surface.touch().commit();
      this.whole = true;
    }
    this.lightTheWayOut(ctx, cave, transition);
  }

  private tile(into: PixelBuffer, pose: PlanetPose, cave: Cave): void {
    const at = localFrame(pose);
    const { minX, maxX, maxY, minY } = this.bounds;
    for (let ly = minY; ly <= maxY; ly += 1) {
      for (let lx = minX; lx <= maxX; lx += 1) {
        // A tile stands on its foot and reaches one row ahead: its middle is half a row up.
        const tile = floorTile(floorCell(cave, at(lx, ly + 0.5)));
        // `blitBuffer` composites, and every floor tile is opaque, so this is a copy.
        blitBuffer(into, tile, (lx - minX) * TILE_WIDTH, (maxY - ly) * TILE_DEPTH);
      }
    }
  }

  private lightTheWayOut(ctx: FrameContext, cave: Cave, transition: HorizonTransition | undefined): void {
    const placed = localPlacement(ctx.frame, toLocal(ctx.pose, cave));
    if (!placed.visible) {
      return;
    }
    const progress = transition === undefined ? 1 : transitionProgress(transition, ctx.elapsedMs);
    const share = transition === undefined || transition.to === CAVE ? progress : 1 - progress;
    ctx.lights.push({
      x: placed.x,
      y: placed.y - TILE_DEPTH / 2,
      radius: EXIT_LIGHT_RADIUS,
      color: INK_COLORS.foam,
      intensity: 0.9 * share,
    });
  }
}
