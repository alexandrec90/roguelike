/**
 * Tapered capsules in screen space, rasterised with a depth buffer and lit per
 * pixel from their own normals.
 *
 * This is the trees' mechanism — a body is a signed-distance field, the field's
 * gradient is the surface normal, the normal against the light picks a ramp
 * step — with the one thing a character needs that a crown does not: **depth
 * per pixel**. A crown is one welded mass; a figure is a dozen limbs crossing in
 * front of each other, and which one owns a pixel is the whole of whether the
 * near arm reads as near. So every capsule also knows how far toward the viewer
 * its axis is, a pixel's surface depth is that plus the bulge of the tube at
 * that point, and the nearest surface wins.
 *
 * The normal is the capsule's analytic one: across the screen it is the
 * direction from the axis to the pixel, and toward the viewer it is whatever is
 * left of a unit vector — a tube lights like a tube, a sphere like a sphere.
 *
 * Two passes after the fill make it read at 1x on grass, and both are the
 * pixel artist's, computed rather than painted:
 *
 * - **Selective outline.** Every empty pixel touching the body takes the
 *   darkest step of the material it touches, so a blue tunic is ringed in navy
 *   and a hand in umber, never in black.
 * - **Contact edges.** Where a nearer limb overlaps a farther one, the farther
 *   side of the seam drops a step, so an arm across the chest is drawn *over*
 *   it rather than merged into it.
 */

import type { InkId, PixelCloud } from "../ink";
import { fbm3 } from "../procgen/noise";
import { INK_RAMPS, rampInk } from "../shading";
import type { Material } from "../rig";

/** One body part on screen: a tapered capsule, or a sphere when a = b. */
export interface ScreenPrim {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ra: number;
  readonly rb: number;
  /** Rig depth (y toward the viewer) of each end; larger is nearer. */
  readonly da: number;
  readonly db: number;
  readonly material: Material;
  /** Ramp-level bias. */
  readonly shade: number;
  /** Which bone it belongs to; contact edges are only drawn between groups. */
  readonly group: number;
  /** Self-lit: a burning blade glows from noise, not from the sun. */
  readonly emissive?: { readonly timeMs: number; readonly seed: number };
}

export interface RasterLight {
  /** Screen-space, toward the lamp; +y is down. Need not be normalised. */
  readonly x: number;
  readonly y: number;
  /** The floor on the shadow side, 0..1. */
  readonly ambient?: number;
}

export interface VolumeRaster {
  readonly cloud: PixelCloud;
  /** Which material owns a filled pixel, or undefined; outline pixels are not filled. */
  materialAt(x: number, y: number): Material | undefined;
  /** Re-ink a filled pixel in place — eyes, a glint. False when nothing is there. */
  setInk(x: number, y: number, ink: InkId): boolean;
}

/** How much nearer a neighbour must be before the seam between them is drawn. */
const CONTACT_DEPTH = 1.2;
/** The light's lift toward the viewer: a sun behind the camera, over the shoulder. */
const LIGHT_LIFT = 0.75;

interface Grid {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly owner: Int16Array;
  readonly depth: Float32Array;
  readonly level: Float32Array;
}

function gridBounds(prims: readonly ScreenPrim[], floorY: number): Omit<Grid, "owner" | "depth" | "level"> {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const prim of prims) {
    const r = Math.max(prim.ra, prim.rb);
    left = Math.min(left, prim.ax - r, prim.bx - r);
    right = Math.max(right, prim.ax + r, prim.bx + r);
    top = Math.min(top, prim.ay - r, prim.by - r);
    bottom = Math.max(bottom, prim.ay + r, prim.by + r);
  }
  // One pixel of margin on every side, for the outline.
  const l = Math.floor(left) - 1;
  const t = Math.floor(top) - 1;
  const b = Math.min(Math.ceil(bottom) + 1, floorY + 1);
  return { left: l, top: t, width: Math.ceil(right) + 2 - l, height: Math.max(b - t + 1, 1) };
}

interface Hit {
  depth: number;
  nx: number;
  ny: number;
  nz: number;
}

/** The capsule's front surface at (x, y), or false when the pixel misses it. */
function hitPrim(prim: ScreenPrim, x: number, y: number, hit: Hit): boolean {
  const dx = prim.bx - prim.ax;
  const dy = prim.by - prim.ay;
  const lengthSquared = dx * dx + dy * dy;
  const px = x - prim.ax;
  const py = y - prim.ay;
  const t = lengthSquared === 0 ? 0 : Math.min(Math.max((px * dx + py * dy) / lengthSquared, 0), 1);
  const ox = px - dx * t;
  const oy = py - dy * t;
  const radius = prim.ra + (prim.rb - prim.ra) * t;
  const distanceSquared = ox * ox + oy * oy;
  if (radius <= 0 || distanceSquared > radius * radius) {
    return false;
  }
  const bulge = Math.sqrt(radius * radius - distanceSquared);
  hit.depth = prim.da + (prim.db - prim.da) * t + bulge;
  hit.nx = ox / radius;
  hit.ny = oy / radius;
  hit.nz = bulge / radius;
  return true;
}

function litLevel(prim: ScreenPrim, hit: Hit, light: RasterLight, x: number, y: number): number {
  if (prim.emissive !== undefined) {
    const churn = fbm3(x / 2.2, y / 2.6 + prim.emissive.timeMs / 90, prim.emissive.timeMs / 400, prim.emissive.seed, {
      octaves: 2,
    });
    return 0.35 + churn * 0.75 + prim.shade;
  }
  const ambient = light.ambient ?? 0.2;
  const length = Math.hypot(light.x, light.y, LIGHT_LIFT) || 1;
  const facing = (hit.nx * light.x + hit.ny * light.y + hit.nz * LIGHT_LIFT) / length;
  const diffuse = Math.max(facing, 0);
  // Polished materials get a tight highlight on top of the diffuse term.
  const polished = prim.material === "metal" || prim.material === "gold";
  const spark = polished ? Math.max(facing, 0) ** 10 * 0.45 : 0;
  return ambient + (1 - ambient) * diffuse * 0.92 + spark + prim.shade;
}

function fill(prims: readonly ScreenPrim[], light: RasterLight, floorY: number): Grid {
  const bounds = gridBounds(prims, floorY);
  const size = bounds.width * bounds.height;
  const grid: Grid = {
    ...bounds,
    owner: new Int16Array(size).fill(-1),
    depth: new Float32Array(size),
    level: new Float32Array(size),
  };
  const hit: Hit = { depth: 0, nx: 0, ny: 0, nz: 0 };
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.top + row;
    if (y > floorY) {
      break;
    }
    for (let column = 0; column < bounds.width; column += 1) {
      fillPixel(grid, prims, light, row * bounds.width + column, hit);
    }
  }
  return grid;
}

function fillPixel(grid: Grid, prims: readonly ScreenPrim[], light: RasterLight, index: number, hit: Hit): void {
  const x = grid.left + (index % grid.width);
  const y = grid.top + Math.floor(index / grid.width);
  let best = -1;
  let bestDepth = -Infinity;
  let level = 0;
  for (let p = 0; p < prims.length; p += 1) {
    const prim = prims[p] as ScreenPrim;
    if (hitPrim(prim, x, y, hit) && hit.depth > bestDepth) {
      best = p;
      bestDepth = hit.depth;
      level = litLevel(prim, hit, light, x, y);
    }
  }
  if (best >= 0) {
    grid.owner[index] = best;
    grid.depth[index] = bestDepth;
    grid.level[index] = level;
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The nearest filled neighbour's owner, or -1 — what an outline pixel borrows its ink from. */
function nearestNeighbour(grid: Grid, column: number, row: number): number {
  let owner = -1;
  let depth = -Infinity;
  for (const [dx, dy] of NEIGHBOURS) {
    const c = column + dx;
    const r = row + dy;
    if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) {
      continue;
    }
    const index = r * grid.width + c;
    const candidate = grid.owner[index] ?? -1;
    if (candidate >= 0 && (grid.depth[index] ?? 0) > depth) {
      owner = candidate;
      depth = grid.depth[index] ?? 0;
    }
  }
  return owner;
}

/** True when a neighbour from another bone sits clearly nearer than this pixel. */
function behindSeam(grid: Grid, prims: readonly ScreenPrim[], column: number, row: number): boolean {
  const index = row * grid.width + column;
  const self = prims[grid.owner[index] ?? -1];
  const depth = grid.depth[index] ?? 0;
  for (const [dx, dy] of NEIGHBOURS) {
    const c = column + dx;
    const r = row + dy;
    if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) {
      continue;
    }
    const other = prims[grid.owner[r * grid.width + c] ?? -1];
    if (other !== undefined && self !== undefined && other.group !== self.group &&
        (grid.depth[r * grid.width + c] ?? 0) > depth + CONTACT_DEPTH) {
      return true;
    }
  }
  return false;
}

function emitCloud(grid: Grid, prims: readonly ScreenPrim[], floorY: number): { cloud: PixelCloud; index: Int32Array } {
  const cloud: PixelCloud = [];
  const index = new Int32Array(grid.width * grid.height).fill(-1);
  for (let row = 0; row < grid.height; row += 1) {
    const y = grid.top + row;
    for (let column = 0; column < grid.width && y <= floorY; column += 1) {
      const x = grid.left + column;
      const at = row * grid.width + column;
      const owner = grid.owner[at] ?? -1;
      if (owner >= 0) {
        const prim = prims[owner] as ScreenPrim;
        const seam = behindSeam(grid, prims, column, row) ? 0.3 : 0;
        index[at] = cloud.length;
        cloud.push({ x, y, ink: rampInk(INK_RAMPS[prim.material], (grid.level[at] ?? 0) - seam, { x, y }) });
        continue;
      }
      const neighbour = nearestNeighbour(grid, column, row);
      if (neighbour >= 0) {
        const material = (prims[neighbour] as ScreenPrim).material;
        cloud.push({ x, y, ink: INK_RAMPS[material][0] as InkId });
      }
    }
  }
  return { cloud, index };
}

/**
 * Fill, light, outline. `floorY` is the ground line: nothing is drawn below it,
 * because a figure standing in a hole reads as exactly that.
 */
export function rasterizePrims(
  prims: readonly ScreenPrim[],
  light: RasterLight,
  floorY = 0,
): VolumeRaster {
  if (prims.length === 0) {
    return { cloud: [], materialAt: () => undefined, setInk: () => false };
  }
  const grid = fill(prims, light, floorY);
  const { cloud, index } = emitCloud(grid, prims, floorY);
  const locate = (x: number, y: number): number => {
    const column = x - grid.left;
    const row = y - grid.top;
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) {
      return -1;
    }
    return row * grid.width + column;
  };
  return {
    cloud,
    materialAt: (x, y) => {
      const at = locate(x, y);
      const owner = at < 0 ? -1 : (grid.owner[at] ?? -1);
      return owner < 0 ? undefined : prims[owner]?.material;
    },
    setInk: (x, y, ink) => {
      const at = locate(x, y);
      const slot = at < 0 ? -1 : (index[at] ?? -1);
      const pixel = cloud[slot];
      if (pixel === undefined) {
        return false;
      }
      cloud[slot] = { x: pixel.x, y: pixel.y, ink };
      return true;
    },
  };
}
