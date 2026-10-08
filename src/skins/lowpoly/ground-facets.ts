/**
 * How the ground's lattice points (`ground-relief.ts`) are joined into faces,
 * and so the height of the face under any point - which is where a foot stands.
 *
 * Under the flat look every tile is two triangles. The painted look varies the
 * size of a face by a factor of thirty, as a painter's planes vary:
 *
 * | Tile | Faces | Chosen by |
 * | --- | --- | --- |
 * | in a merged 4×4 square | one plane of two triangles over all sixteen tiles | `mergeLarge`, tried first |
 * | in a merged 2×2 square | one plane of two triangles over four | `merge` |
 * | split | four small faces round a middle point pushed up (a bump) or down (a dent) | `split`, `bump` |
 * | otherwise | two triangles | - |
 *
 * **No crack opens at a merged plane's edge.** A lattice point lying on that edge
 * belongs to the neighbouring tiles too, and they would bend at it while the plane
 * runs straight past - so it is slid onto the edge line (`groundVertex`), and both
 * sides meet exactly. A split's middle point belongs to its tile alone, so it can
 * go anywhere.
 *
 * **Water stays level.** A square merges, and a split bumps, only where no water
 * can stand anywhere under it and no lake or landform is near (`freeToTilt`),
 * so no plane tilts a puddle or stands over a landform's foot.
 *
 * Squares are aligned to their own size, which divides `CHUNK_TILES` and
 * `PLANET_TILES`, so none straddles a chunk or the planet's seam.
 */

import { PLANET_TILES, wrapTile, type PlanetPoint } from "../../game/planet";
import { freeToTilt, latticeVertex } from "./ground-relief";
import type { Look } from "./look";
import type { Vec3 } from "./mesh";
import { hash01, seedOf } from "./palette";

/** How far a split's middle point may wander off the tile's centre, tiles. */
const SPLIT_WANDER = 0.15;

/** Per look, every tile's merged square: 1, 2 or 4 tiles a side. Made once. */
const blockTables = new WeakMap<Look, Uint8Array>();

function merges(look: Look): boolean {
  return look.merge > 0 || look.mergeLarge > 0;
}

function blockTable(look: Look): Uint8Array {
  const known = blockTables.get(look);
  if (known !== undefined) {
    return known;
  }
  const sizes = new Uint8Array(PLANET_TILES * PLANET_TILES).fill(1);
  const mark = (x0: number, y0: number, size: number): void => {
    for (let j = 0; j < size; j += 1) {
      sizes.fill(size, (y0 + j) * PLANET_TILES + x0, (y0 + j) * PLANET_TILES + x0 + size);
    }
  };
  for (let y = 0; y < PLANET_TILES; y += 4) {
    for (let x = 0; x < PLANET_TILES; x += 4) {
      if (hash01(seedOf(x, y, 0xb4)) < look.mergeLarge && freeToTilt(x, y, 4)) {
        mark(x, y, 4);
        continue;
      }
      for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) {
        if (hash01(seedOf(x + dx, y + dy, 0xb2)) < look.merge && freeToTilt(x + dx, y + dy, 2)) {
          mark(x + dx, y + dy, 2);
        }
      }
    }
  }
  blockTables.set(look, sizes);
  return sizes;
}

/** The merged square tile `(tx, ty)` lies in, as its corner and size; size 1 is a tile of its own. */
interface Block {
  readonly x0: number;
  readonly y0: number;
  readonly size: number;
}

function blockOf(tx: number, ty: number, look: Look): Block {
  const size = merges(look) ? blockTable(look)[wrapTile(ty) * PLANET_TILES + wrapTile(tx)]! : 1;
  return { x0: Math.floor(tx / size) * size, y0: Math.floor(ty / size) * size, size };
}

/**
 * Lattice point `(px, py)` as drawn, unwrapped: the raw point, or - when it lies
 * on a merged plane's edge, not at its corner - slid onto that edge, between
 * the plane's own corners. The largest plane wins; a 2×2 square's corner may
 * itself lie on a 4×4's edge, which is what the recursion resolves.
 */
function drawnPoint(px: number, py: number, look: Look): Vec3 {
  if (!merges(look)) {
    return latticeVertex(px, py, look);
  }
  let best: Block | undefined;
  for (const [tx, ty] of [[px - 1, py - 1], [px, py - 1], [px - 1, py], [px, py]] as const) {
    const block = blockOf(tx, ty, look);
    const corner = (px === block.x0 || px === block.x0 + block.size) && (py === block.y0 || py === block.y0 + block.size);
    if (block.size > 1 && !corner && (best === undefined || block.size > best.size)) {
      best = block;
    }
  }
  if (best === undefined) {
    return latticeVertex(px, py, look);
  }
  const { x0, y0, size } = best;
  const u = (px - x0) / size;
  const v = (py - y0) / size;
  const a = drawnPoint(x0, y0, look);
  const b = drawnPoint(x0 + size, y0, look);
  const c = drawnPoint(x0, y0 + size, look);
  const d = drawnPoint(x0 + size, y0 + size, look);
  return [0, 1, 2].map((k) => (a[k]! * (1 - u) + b[k]! * u) * (1 - v) + (c[k]! * (1 - u) + d[k]! * u) * v) as unknown as Vec3;
}

/** A ground vertex as drawn, in tiles from `origin`. */
export function groundVertex(px: number, py: number, origin: PlanetPoint, look: Look): Vec3 {
  const [x, y, z] = drawnPoint(px, py, look);
  return [x - origin.x, y - origin.y, z];
}

/** The faces one tile owns, and the seed they are tinted from. */
export interface GroundCell {
  readonly seed: number;
  readonly faces: readonly Face[];
}

type Face = readonly [Vec3, Vec3, Vec3];

/** Whether every face winds the way an unfolded tile's do: none is folded back over its neighbour. */
function unfolded(faces: readonly Face[]): boolean {
  return faces.every(([p, q, r]) => (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]) > 0);
}

/**
 * The faces tile `(px, py)` owns: two triangles; or, for the corner tile of a
 * merged square, the whole square's two, and none for its other tiles; or four
 * round a bump or a dent. The diagonal alternates by hash, so the field is
 * triangles, not a quilt - unless the jitter has pushed a corner far enough in
 * that the tile is no longer convex, when only one diagonal stays inside it and
 * the other would fold a face back over the next tile. A split that would fold
 * is drawn whole.
 */
export function groundCell(px: number, py: number, origin: PlanetPoint, look: Look): GroundCell {
  const seed = seedOf(wrapTile(px), wrapTile(py), 0x7a1);
  const { x0, y0, size } = blockOf(px, py, look);
  if (px !== x0 || py !== y0) {
    return { seed, faces: [] };
  }
  const a = groundVertex(x0, y0, origin, look);
  const b = groundVertex(x0 + size, y0, origin, look);
  const c = groundVertex(x0 + size, y0 + size, origin, look);
  const d = groundVertex(x0, y0 + size, origin, look);
  if (size === 1 && look.split > 0 && hash01(seed + 5) < look.split) {
    const push = freeToTilt(px, py, 1) ? (hash01(seed + 6) * 2 - 1) * look.bump : 0;
    const middle: Vec3 = [
      (a[0] + b[0] + c[0] + d[0]) / 4 + (hash01(seed + 7) * 2 - 1) * SPLIT_WANDER,
      (a[1] + b[1] + c[1] + d[1]) / 4 + (hash01(seed + 8) * 2 - 1) * SPLIT_WANDER,
      (a[2] + b[2] + c[2] + d[2]) / 4 + push,
    ];
    const fan: Face[] = [[a, b, middle], [b, c, middle], [c, d, middle], [d, a, middle]];
    if (unfolded(fan)) {
      return { seed, faces: fan };
    }
  }
  const across: Face[] = [[a, b, c], [a, c, d]];
  const down: Face[] = [[a, b, d], [b, c, d]];
  const [first, second] = hash01(seed) < 0.5 ? [across, down] : [down, across];
  return { seed, faces: unfolded(first) ? first : second };
}

/**
 * How high the drawn ground stands under a planet point, tiles: the height of
 * the very triangle `groundMesh` draws over it. The flat look's wobble is a
 * hair, and a foot has always stood at 0 on it, so it answers 0.
 *
 * A jittered corner can carry a neighbouring tile's face over the point, so the
 * tiles round it are asked too - each for the tile that owns its faces, which
 * for a merged square is its corner tile, up to three tiles away.
 */
export function groundSurface(point: PlanetPoint, look: Look): number {
  if (look.hills <= 0) {
    return 0;
  }
  const origin = { x: Math.floor(point.x), y: Math.floor(point.y) };
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  const owners = new Map<string, Block>();
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const block = blockOf(origin.x + i, origin.y + j, look);
      owners.set(`${block.x0},${block.y0}`, block);
    }
  }
  let height = 0;
  let found = false;
  for (const { x0, y0 } of owners.values()) {
    for (const [p, q, r] of groundCell(x0, y0, origin, look).faces) {
      const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
      const l1 = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (y - r[1])) / det;
      const l2 = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (y - r[1])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) {
        const z = l1 * p[2] + l2 * q[2] + l3 * r[2];
        height = found ? Math.max(height, z) : z;
        found = true;
      }
    }
  }
  return height;
}
