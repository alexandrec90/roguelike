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

import { LAKE_MAX_REACH, lakesNear, planetLakes } from "../../game/lakes";
import { planetLandforms } from "../../game/landforms";
import { PLANET_TILES, wrapDelta, type PlanetPoint } from "../../game/planet";
import { sceneryNear } from "../../game/scenery-features";
import { MeshBuilder } from "./mesh";
import { sceneryMesh } from "./scenery-mesh";
import { groundMesh, lakeMesh, landformMesh } from "./terrain-mesh";

export const CHUNK_TILES = 32;
export const CHUNKS_PER_SIDE = PLANET_TILES / CHUNK_TILES;

export interface ChunkMesh {
  readonly cx: number;
  readonly cy: number;
  /** Planet point of the chunk's corner; every vertex is tiles from here. */
  readonly origin: PlanetPoint;
  /** Opaque: the ground, landforms and bodies. */
  readonly solid: Uint8Array;
  /** Sheer: shadows and water, drawn over the solid pass. */
  readonly sheer: Uint8Array;
}

/** Whether a planet point's chunk is `(cx, cy)`. */
function inChunk(point: PlanetPoint, cx: number, cy: number): boolean {
  return Math.floor(point.x / CHUNK_TILES) === cx && Math.floor(point.y / CHUNK_TILES) === cy;
}

/** Everything in one chunk, as geometry. Pure and seeded: the same chunk every time. */
export function buildChunk(cx: number, cy: number): ChunkMesh {
  const origin = { x: cx * CHUNK_TILES, y: cy * CHUNK_TILES };
  const centre = { x: origin.x + CHUNK_TILES / 2, y: origin.y + CHUNK_TILES / 2 };
  const solid = new MeshBuilder();
  const sheer = new MeshBuilder();

  groundMesh(solid, origin, CHUNK_TILES, lakesNear(centre, CHUNK_TILES / 2 + LAKE_MAX_REACH + 1));
  for (const lake of planetLakes()) {
    if (inChunk(lake, cx, cy)) {
      lakeMesh(sheer, lake, origin);
    }
  }
  for (const landform of planetLandforms()) {
    if (inChunk(landform, cx, cy)) {
      landformMesh(solid, landform, origin);
    }
  }
  for (const feature of sceneryNear(centre, CHUNK_TILES / 2)) {
    if (inChunk(feature, cx, cy)) {
      sceneryMesh(solid, sheer, feature.species, [feature.x - origin.x, feature.y - origin.y, 0], feature.seed);
    }
  }
  return { cx, cy, origin, solid: solid.bytesView().slice(), sheer: sheer.bytesView().slice() };
}

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
