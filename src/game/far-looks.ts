/**
 * What each kind of ground looks like from the far lip: the meadow counted as
 * the field draws it.
 *
 * The far lip shows a cell by its terrain code alone, because composing a far
 * cell's tile reads the lattice round it and a scanline out there crosses a
 * hundred cells. So the look of a code has to be known in advance, and it has
 * to be the look of the field - not of one plain tile. A plain grass tile is
 * the darker half of the meadow: the field has tile variants over it and, on
 * a third of its pixels, tufts whose lit tips are the brightest greens it has.
 * A far colour counted from the bare tile lost all of that where the lip
 * blurs, and the far lip read as a band of another shade (`roll-far.ts`).
 *
 * So the look is counted off real ground: a few patches of the planet at fixed
 * poses, each cell composed exactly as the lip composes a near cell - its tile
 * from the lattice, its tufts upright over it - and every texel counted under
 * the code its cell reads. Fixed poses, so the look is the same every load;
 * several, far apart, so no one meadow's drift of flowers decides it. Counted
 * once, when the lip is created: composing a few hundred tiles is tens of
 * milliseconds, which is a load cost and must not be a frame's.
 */

import type { LocalBounds } from "./camera";
import { groundKey } from "./ground/ground-plan";
import { cellTerrain, DIRT, GRASS, sampleGround, type GroundSample, type TerrainCode } from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { tuftsInCell } from "./ground/tuft-placement";
import { bendFrame, TUFT_SHAPES, tuftCloud } from "./ground/tufts";
import type { PlanetPose } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { farLook, type FarLook } from "./roll-far";
import { gridTexels, tileLook, type TileTexels } from "./roll-ground";
import { packCloud, TuftOverlay, type PackedCloud, type TuftPiece } from "./roll-grass";

/** Where the meadow is counted: far apart on a planet `PLANET_TILES` round. */
const REFERENCE_POSES: readonly PlanetPose[] = [
  { x: 17.5, y: 41.5, turn: 0 },
  { x: 83.5, y: 170.5, turn: 0 },
  { x: 151.5, y: 97.5, turn: 0 },
  { x: 219.5, y: 226.5, turn: 0 },
];

/** One patch: a ring of cells round the counted ones, so every counted cell has its neighbours' blades. */
const PATCH: LocalBounds = { minX: -5, maxX: 5, minY: 0, maxY: 7 };

/** A code seen on fewer counted cells than this keeps its plain tile's look: too little to count. */
const MIN_CELLS = 8;

/**
 * The far look of each terrain code. Grass is the meadow with its tufts; dirt
 * is the path with the grass that edges it, or a plain dirt tile where the
 * patches found too little path to count.
 */
export function terrainFarLooks(): Readonly<Record<TerrainCode, FarLook>> {
  const counts = { [GRASS]: new Map<number, number>(), [DIRT]: new Map<number, number>() };
  const cells = { [GRASS]: 0, [DIRT]: 0 };
  for (const pose of REFERENCE_POSES) {
    countPatch(sampleGround(pose, PATCH), counts, cells);
  }
  const lookOf = (code: TerrainCode, plain: number): FarLook =>
    cells[code] >= MIN_CELLS ? farLook(counts[code]) : tileLook(plainTile(plain));
  return { [GRASS]: lookOf(GRASS, 0), [DIRT]: lookOf(DIRT, 0x1ff) };
}

function plainTile(dirt: number): TileTexels {
  return gridTexels(groundTile({ dirt, colours: 0, middle: 0, shade: 0 }));
}

/**
 * Compose a patch as the lip composes a near cell - tile, then the tufts of
 * every cell over it, farther rows first so a nearer blade is on top - and
 * count the cells that have every neighbour's blades in.
 */
function countPatch(
  sample: GroundSample,
  counts: Record<TerrainCode, Map<number, number>>,
  cells: Record<TerrainCode, number>,
): void {
  const { minX, maxX, minY, maxY } = PATCH;
  const grass = new TuftOverlay(PATCH);
  const clouds = new Map<number, PackedCloud>();
  for (let cellY = maxY; cellY >= minY; cellY -= 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      grass.stamp(cellX, cellY, uprightTufts(sample, cellX, cellY, clouds));
    }
  }
  const texel = new Uint8ClampedArray(4);
  // A blade rises into the cell beyond it and leans a column either way, so
  // the nearest row and the side columns are missing blades from outside.
  for (let cellY = minY + 1; cellY <= maxY; cellY += 1) {
    for (let cellX = minX + 1; cellX < maxX; cellX += 1) {
      const code = cellTerrain(sample, cellX, cellY);
      const tile = gridTexels(groundTile(unpackGroundKey(groundKey(sample, cellX, cellY))));
      cells[code] += 1;
      for (let v = 0; v < TILE_DEPTH; v += 1) {
        for (let u = 0; u < TILE_WIDTH; u += 1) {
          const from = ((TILE_DEPTH - 1 - v) * tile.width + u) * 4;
          texel.set(tile.rgba.subarray(from, from + 4));
          grass.blendInto(cellX * TILE_WIDTH + u, cellY * TILE_DEPTH + v, texel, 0);
          const colour = ((texel[0] ?? 0) << 16) | ((texel[1] ?? 0) << 8) | (texel[2] ?? 0);
          counts[code].set(colour, (counts[code].get(colour) ?? 0) + 1);
        }
      }
    }
  }
}

/** A cell's tufts at rest, each placed from the cell's foot - as the lip's layer gathers them. */
function uprightTufts(
  sample: GroundSample,
  cellX: number,
  cellY: number,
  clouds: Map<number, PackedCloud>,
): readonly TuftPiece[] {
  const left = (cellX - sample.bounds.minX) * TILE_WIDTH;
  const top = (sample.bounds.maxY - cellY) * TILE_DEPTH;
  return tuftsInCell(sample, cellX, cellY).map((placement) => {
    let cloud = clouds.get(placement.shape);
    if (cloud === undefined) {
      const shape = TUFT_SHAPES[placement.shape];
      cloud = packCloud(shape === undefined ? [] : tuftCloud(shape, bendFrame(0)));
      clouds.set(placement.shape, cloud);
    }
    return { cloud, x: placement.x - left - TILE_WIDTH / 2, y: placement.y - top - TILE_DEPTH };
  });
}
