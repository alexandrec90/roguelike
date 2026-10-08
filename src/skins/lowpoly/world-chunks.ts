/**
 * The planet, cut into square chunks of geometry built once and kept.
 *
 * The whole planet is small - 256 tiles a side - and the horizon is real, so a
 * mountain a hundred tiles off still shows its peak over the line. So every
 * chunk is drawn every frame, at whichever image of it round the wrap is
 * nearest the hero (`chunkOffset`). That is ~64 draw calls of static buffers:
 * the GPU's favourite kind of work. Nothing is rebuilt as the hero walks; the
 * camera simply moves.
 *
 * A chunk owns everything whose *centre* is in it - a lake, a landform, a tree -
 * even where its geometry runs over the edge, so nothing is drawn twice.
 */

import { LAKE_MAX_REACH, lakesNear } from "../../game/lakes";
import { planetLandforms } from "../../game/landforms";
import { PLANET_TILES, wrapDelta, type PlanetPoint } from "../../game/planet";
import { sceneryNear } from "../../game/scenery-features";
import { ImpostorBuilder } from "./impostor";
import type { Leaves } from "./look-options";
import { MeshBuilder } from "./mesh";
import { ROLL_ROWS } from "../../game/horizon";
import { sceneryMesh } from "./scenery-mesh";
import { groundMesh, landformMesh } from "./terrain-mesh";

export const CHUNK_TILES = 32;
export const CHUNKS_PER_SIDE = PLANET_TILES / CHUNK_TILES;

export interface ChunkMesh {
  readonly cx: number;
  readonly cy: number;
  /** Planet point of the chunk's corner; every vertex is tiles from here. */
  readonly origin: PlanetPoint;
  /**
   * The flat ground on its own: never mirrored, and skipped wholesale when the
   * chunk is past the horizon (`groundInView`), where every pixel of it would be
   * rasterised only to be discarded.
   */
  readonly ground: Uint8Array;
  /** Opaque: bodies - trees, rocks, bushes - drawn and mirrored. */
  readonly solid: Uint8Array;
  /**
   * Opaque: the landforms, drawn and mirrored like `solid` but kept apart, so
   * that on a frame with a window round the hero (`cutaway.ts`) they alone
   * draw with the shader that can discard.
   */
  readonly land: Uint8Array;
  /** Sheer: shadows and water, drawn over the solid pass. */
  readonly sheer: Uint8Array;
  /** Impostor balls (`impostor.ts`): the crowns, with `?leaves=impostor`; empty otherwise. */
  readonly balls: Uint8Array;
}

/** Whether a planet point's chunk is `(cx, cy)`. */
function inChunk(point: PlanetPoint, cx: number, cy: number): boolean {
  return Math.floor(point.x / CHUNK_TILES) === cx && Math.floor(point.y / CHUNK_TILES) === cy;
}

/**
 * Everything in one chunk, as geometry. Pure and seeded: the same chunk every
 * time. `leaves` says whether crowns are faceted plates or impostor balls.
 */
export function buildChunk(cx: number, cy: number, leaves: Leaves = "mesh"): ChunkMesh {
  const origin = { x: cx * CHUNK_TILES, y: cy * CHUNK_TILES };
  const centre = { x: origin.x + CHUNK_TILES / 2, y: origin.y + CHUNK_TILES / 2 };
  const ground = new MeshBuilder();
  const solid = new MeshBuilder();
  const land = new MeshBuilder();
  const sheer = new MeshBuilder();
  const balls = new ImpostorBuilder();
  const crowns = leaves === "impostor" ? balls : undefined;

  groundMesh(ground, origin, CHUNK_TILES, lakesNear(centre, CHUNK_TILES / 2 + LAKE_MAX_REACH + 1));
  for (const landform of planetLandforms()) {
    if (inChunk(landform, cx, cy)) {
      landformMesh(land, landform, origin);
    }
  }
  for (const feature of sceneryNear(centre, CHUNK_TILES / 2)) {
    if (inChunk(feature, cx, cy)) {
      sceneryMesh(solid, sheer, feature.species, [feature.x - origin.x, feature.y - origin.y, 0], feature.seed, crowns);
    }
  }
  return {
    cx,
    cy,
    origin,
    ground: ground.bytesView().slice(),
    solid: solid.bytesView().slice(),
    land: land.bytesView().slice(),
    sheer: sheer.bytesView().slice(),
    balls: balls.bytesView().slice(),
  };
}

/** Rows of the screen's field, from the hero: how far it reaches behind him and ahead, from the view. */
export interface FieldRows {
  readonly behind: number;
  readonly ahead: number;
}

/**
 * Whether any of a chunk's ground can be on screen: some of it is between the
 * screen's near edge and the horizon line (`ROLL_ROWS` past the field).
 * `offset` is the chunk's corner from the hero (`chunkOffset`), `turn` the
 * world's. Rows ahead are the turned planet offset's `y`, as `toLocal` turns it.
 * A row of margin each way covers ground jitter and the lip's first row.
 */
export function groundInView(offset: PlanetPoint, turn: number, rows: FieldRows, beyond: number = ROLL_ROWS): boolean {
  const sin = Math.sin(turn);
  const cos = Math.cos(turn);
  let nearest = Number.POSITIVE_INFINITY;
  let farthest = Number.NEGATIVE_INFINITY;
  for (const [dx, dy] of [[0, 0], [CHUNK_TILES, 0], [0, CHUNK_TILES], [CHUNK_TILES, CHUNK_TILES]] as const) {
    const ahead = (offset.x + dx) * sin + (offset.y + dy) * cos;
    nearest = Math.min(nearest, ahead);
    farthest = Math.max(farthest, ahead);
  }
  return farthest >= -rows.behind - 1 && nearest <= rows.ahead + beyond + 1;
}

/**
 * Rows past the field's edge whose bodies are still drawn into the mirror. A
 * reflection lands below its body's foot, in water nearer than it; on the lip
 * that water is a few scanlines tall and the reflection a speck, so past this
 * nothing a player could see is lost - and every chunk left out is the mirror
 * pass's largest saving.
 */
export const MIRROR_ROWS = 10;

/**
 * Where to draw a chunk from: its corner as a planet offset from the hero,
 * taken to the image of the chunk nearest him round the wrap. Measured from the
 * chunk's centre, so a chunk is never split across two images.
 */
export function chunkOffset(chunk: { readonly origin: PlanetPoint }, hero: PlanetPoint): PlanetPoint {
  const half = CHUNK_TILES / 2;
  return {
    x: wrapDelta(chunk.origin.x + half, hero.x) - half,
    y: wrapDelta(chunk.origin.y + half, hero.y) - half,
  };
}
