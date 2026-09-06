/**
 * Species 1 — a recursive fractal skeleton with **hierarchical spring sway**.
 *
 * The structure is the textbook one: a segment splits into two or three
 * shorter segments at seeded angles, four levels deep. What makes it move like
 * a tree rather than like a fractal in a breeze is that each branch order gets
 * its own damped spring (`wind.ts`), and a branch's angle is its parent's angle
 * plus its own bend. Displacement therefore *compounds outward* — the trunk
 * leans a degree, the limbs on it lean three, the twigs on those lean twelve —
 * and the outer springs are tuned faster and lighter, so twigs rattle while the
 * trunk is still deciding to move.
 *
 * That single property, cumulative rotation through a hierarchy of springs, is
 * most of what separates real vegetation motion from a sine wave. It costs one
 * spring per branch order: five numbers.
 */

import { strokeLine, type PixelCloud } from "../ink";
import { INK_RAMPS } from "../shading";
import { pixelHash } from "../transforms";
import { createSway, stepSway, windAt, type Sway } from "../wind";
import { barkInk, leafCluster, rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const MAX_DEPTH = 4;
const TRUNK_LENGTH = 11.5;
const SHRINK = 0.71;

interface Segment {
  readonly parent: number;
  /** Radians relative to the parent's direction; the root's is absolute. */
  readonly localAngle: number;
  readonly length: number;
  readonly depth: number;
}

/** Grow the static skeleton. Seeded, so a seed is a tree, not a jitter. */
function grow(seed: number): readonly Segment[] {
  const segments: Segment[] = [{ parent: -1, localAngle: -Math.PI / 2, length: TRUNK_LENGTH, depth: 0 }];
  let generation = [0];
  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    const next: number[] = [];
    for (const parent of generation) {
      const source = segments[parent];
      if (source === undefined) {
        continue;
      }
      const forks = pixelHash(parent, depth, seed, 1) > 0.62 ? 3 : 2;
      for (let fork = 0; fork < forks; fork += 1) {
        const spread = 0.34 + pixelHash(parent, fork, seed, 2) * 0.46;
        const side = fork === 0 ? -1 : fork === 1 ? 1 : 0.15;
        next.push(segments.length);
        segments.push({
          parent,
          localAngle: side * spread,
          length: source.length * SHRINK * (0.82 + pixelHash(parent, fork, seed, 3) * 0.36),
          depth,
        });
      }
    }
    generation = next;
  }
  return segments;
}

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** Walk the skeleton, adding each order's bend to its parent's direction. */
function place(segments: readonly Segment[], bend: readonly number[]): Placed[] {
  const ends: Placed[] = [];
  segments.forEach((segment, index) => {
    const parent = segment.parent < 0 ? { x: 0, y: 0, angle: 0 } : ends[segment.parent];
    if (parent === undefined) {
      return;
    }
    const base = segment.parent < 0 ? 0 : parent.angle;
    const angle = base + segment.localAngle + (bend[segment.depth] ?? 0);
    ends[index] = {
      x: parent.x + Math.cos(angle) * segment.length,
      y: parent.y + Math.sin(angle) * segment.length,
      angle,
    };
  });
  return ends;
}

function thicknessFor(depth: number): number {
  return depth === 0 ? 3 : depth === 1 ? 2 : 1;
}

class RecursiveOak implements SceneryInstance {
  private readonly segments: readonly Segment[];
  private readonly springs: readonly Sway[];
  private bend: number[] = Array.from({ length: MAX_DEPTH + 1 }, () => 0);

  constructor(private readonly seed: number) {
    this.segments = grow(seed);
    // Outer orders are lighter and springier: higher natural frequency, less
    // damping, and far more travel per unit of wind.
    this.springs = Array.from({ length: MAX_DEPTH + 1 }, (_, depth) =>
      createSway({
        frequency: 0.34 + depth * 0.22,
        damping: 0.34 - depth * 0.05,
        response: 0.03 + depth * 0.05,
      }),
    );
  }

  step(dtMs: number, env: SceneryEnv): void {
    this.bend = this.springs.map((spring, depth) => {
      const drive = windAt(env.elapsedMs, env.fieldX + depth * 7, env.fieldY - depth * 6, env.wind);
      return stepSway(spring, dtMs, drive);
    });
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    const ends = place(this.segments, this.bend);

    this.segments.forEach((segment, index) => {
      const end = ends[index];
      const start = segment.parent < 0 ? { x: 0, y: 0 } : ends[segment.parent];
      if (end === undefined || start === undefined) {
        return;
      }
      strokeWood(cloud, start, end, segment.depth, this.seed);
    });

    // Leaves only on the last order, where a real canopy carries them.
    this.segments.forEach((segment, index) => {
      const end = ends[index];
      if (segment.depth !== MAX_DEPTH || end === undefined) {
        return;
      }
      leafCluster(cloud, {
        x: Math.round(end.x),
        y: Math.round(end.y),
        radiusX: 4,
        radiusY: 3,
        seed: this.seed + index,
        elapsedMs: env.elapsedMs,
        ramp: INK_RAMPS.canopy,
        drift: (this.bend[MAX_DEPTH] ?? 0) * 24,
      });
    });
    return rooted(cloud);
  }
}

function strokeWood(
  cloud: PixelCloud,
  start: { readonly x: number; readonly y: number },
  end: Placed,
  depth: number,
  seed: number,
): void {
  const from = { x: Math.round(start.x), y: Math.round(start.y) };
  const to = { x: Math.round(end.x), y: Math.round(end.y) };
  if (depth > 0) {
    strokeLine(cloud, from, to, "steel", thicknessFor(depth));
    return;
  }
  // The trunk alone gets bark: at one pixel wide the texture would be noise
  // rather than grain, so the thinner orders stay flat steel.
  const wood: PixelCloud = [];
  strokeLine(wood, from, to, "steel", thicknessFor(depth));
  for (const pixel of wood) {
    cloud.push({ x: pixel.x, y: pixel.y, ink: barkInk(pixel.x, pixel.y, seed, INK_RAMPS.bone) });
  }
}

export const OAK_RECURSIVE: ScenerySpecies = {
  id: "oak-recursive",
  kind: "tree",
  label: "Oak — recursive fractal",
  technique: "L-system skeleton + one damped spring per branch order",
  notes:
    "Four levels of seeded binary/ternary forking. Each branch order owns a damped spring driven " +
    "by the wind field, and a branch's angle is its parent's plus its own bend — so displacement " +
    "compounds outward and the twigs rattle while the trunk is still leaning.",
  footprint: { width: 74, height: 52, originX: 37, originY: 51 },
  create: (seed) => new RecursiveOak(seed),
};
