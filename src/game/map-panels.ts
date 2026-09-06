/**
 * The two picture panels of the debug map, and the palette they share.
 *
 * Split from `map-overlay.ts` because the overlay's job is the canvas — attach
 * it, clear it, frame three boxes, keep a trail and a smoothed frame time — and
 * *this* is the job of saying what a frame of the simulation looks like from
 * outside it. They change for different reasons: one when the instrument moves
 * on the page, the other when there is a new thing about the world worth seeing.
 *
 * Both functions draw into a context already translated to their panel's
 * top-left and clipped to it, so neither knows where on the page it is.
 *
 * These colours are deliberately **not** game inks. See the note in
 * `map-overlay.ts`: this is an instrument held up against the world, and giving
 * it the world's closed palette would only make it harder to read and easier to
 * mistake for the world.
 */

import { localReach } from "./camera";
import type { DriftSample } from "./map-drift";
import { forwardOf, pivotOf, toLocal, wrapDelta, type PlanetPose } from "./planet";
import { puddlesNear, treesNear } from "./terrain";

export const COLOR = {
  ink: "#d8e2f0",
  dim: "#7c8aa0",
  panel: "rgba(8, 12, 20, 0.84)",
  edge: "#2c3a52",
  hero: "#ffd166",
  pivot: "#ef476f",
  circle: "rgba(239, 71, 111, 0.45)",
  tree: "#3ddc84",
  puddle: "#4cc9f0",
  frustum: "rgba(255, 209, 102, 0.5)",
  trail: "rgba(216, 226, 240, 0.35)",
  grid: "rgba(44, 58, 82, 0.7)",
  drawn: "#8892a4",
  drift: "#ff6b6b",
  good: "#3ddc84",
} as const;

/** Tiles either side of the hero the planet panel shows. */
const PLANET_SPAN = 26;

/** A point placed inside a panel: planet or local in, panel pixels out. */
type Place = (x: number, y: number) => [number, number];

/** What the planet panel needs. A subset, so the panels do not own `MapState`. */
export interface PanelView {
  readonly groundPose: PlanetPose;
  readonly livePose: PlanetPose;
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
  readonly radius: number;
}

/**
 * The planet panel: the hero at the centre, north up, everything else where the
 * planet actually put it.
 *
 * Centred on the hero because the world is unbounded and there is no origin to
 * anchor to — but it does *not* rotate with him, which is the whole point of
 * having this panel at all. A tree holds still here and nowhere else.
 */
export function drawPlanetPanel(
  ctx: CanvasRenderingContext2D,
  view: PanelView,
  trail: readonly { x: number; y: number }[],
  width: number,
  height: number,
): void {
  const pose = view.livePose;
  const scale = (width - 20) / (PLANET_SPAN * 2);
  const cx = width / 2;
  const cy = height / 2;
  // Planet +y is north, and north is up, so the panel's y is negated.
  const at: Place = (px, py) => [
    cx + wrapDelta(px, pose.x) * scale,
    cy - wrapDelta(py, pose.y) * scale,
  ];

  drawGrid(ctx, {
    atX: cx,
    atY: cy,
    strideX: scale * 8,
    strideY: scale * 8,
    width,
    height,
  });
  drawTrail(ctx, trail, at);

  const reach = localReach(view.bounds);
  for (const feature of puddlesNear(pose, reach)) {
    dot(ctx, at(feature.x, feature.y), 2, COLOR.puddle);
  }
  for (const feature of treesNear(pose, reach)) {
    dot(ctx, at(feature.x, feature.y), 2.5, COLOR.tree);
  }

  drawStrafeCircle(ctx, view, at, scale);
  drawFrustum(ctx, view, at);
  drawHero(ctx, pose, at, scale);
}

/**
 * The screen panel: the same world after `toLocal`, on the grid it is drawn on,
 * with every probe's disagreement drawn as a line.
 *
 * A line starts where the renderer will put that point at the end of this step
 * and ends where the simulation will actually have carried it. A field of lines
 * all the same length is a translation the renderer can express; a field that
 * fans out with depth is the rotation it cannot, and that fan is precisely the
 * jump seen on screen.
 */
export function drawScreenPanel(
  ctx: CanvasRenderingContext2D,
  view: PanelView,
  samples: readonly DriftSample[],
  width: number,
  height: number,
): void {
  const { minX, maxX, minY, maxY } = view.bounds;
  const scaleX = width / Math.max(1, maxX - minX);
  const scaleY = height / Math.max(1, maxY - minY);
  // Local +y is forward, which is up the screen.
  const at: Place = (lx, ly) => [(lx - minX) * scaleX, height - (ly - minY) * scaleY];

  // Anchored on the hero rather than on the panel's corner, so the lattice is
  // the tile grid he stands on and not an arbitrary ruling.
  const [heroX, heroY] = at(0, 0);
  drawGrid(ctx, {
    atX: heroX,
    atY: heroY,
    strideX: scaleX * 4,
    strideY: scaleY * 4,
    width,
    height,
  });

  const pose = view.groundPose;
  for (const feature of treesNear(pose, localReach(view.bounds))) {
    const local = toLocal(pose, feature);
    dot(ctx, at(local.x, local.y), 2, COLOR.tree);
  }

  ctx.strokeStyle = COLOR.drift;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLOR.drawn;
  for (const sample of samples) {
    const [dx, dy] = at(sample.drawn.x, sample.drawn.y);
    const [tx, ty] = at(sample.truth.x, sample.truth.y);
    ctx.beginPath();
    ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  dot(ctx, at(0, 0), 3, COLOR.hero);
}

/** The circle a strafe orbits, and the pivot it is anchored to. */
function drawStrafeCircle(
  ctx: CanvasRenderingContext2D,
  view: PanelView,
  at: Place,
  scale: number,
): void {
  const pivot = pivotOf(view.livePose, view.radius);
  const [px, py] = at(pivot.x, pivot.y);
  ctx.strokeStyle = COLOR.circle;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(px, py, view.radius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  cross(ctx, px, py, 4, COLOR.pivot);
}

/** The patch of planet the screen is currently sampling — a turned rectangle. */
function drawFrustum(ctx: CanvasRenderingContext2D, view: PanelView, at: Place): void {
  const { minX, maxX, minY, maxY } = view.bounds;
  const pose = view.groundPose;
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  const corner = (lx: number, ly: number): [number, number] =>
    at(pose.x + lx * cos + ly * sin, pose.y - lx * sin + ly * cos);

  ctx.strokeStyle = COLOR.frustum;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const box = [
    corner(minX, minY),
    corner(maxX, minY),
    corner(maxX, maxY),
    corner(minX, maxY),
  ];
  box.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: readonly { x: number; y: number }[],
  at: Place,
): void {
  if (trail.length < 2) {
    return;
  }
  ctx.strokeStyle = COLOR.trail;
  ctx.lineWidth = 1;
  ctx.beginPath();
  trail.forEach((point, index) => {
    const [x, y] = at(point.x, point.y);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function drawHero(
  ctx: CanvasRenderingContext2D,
  pose: PlanetPose,
  at: Place,
  scale: number,
): void {
  const [hx, hy] = at(pose.x, pose.y);
  const forward = forwardOf(pose.turn);
  ctx.strokeStyle = COLOR.hero;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + forward.x * scale * 7, hy - forward.y * scale * 7);
  ctx.stroke();
  dot(ctx, [hx, hy], 3, COLOR.hero);
}

export function dot(
  ctx: CanvasRenderingContext2D,
  [x, y]: [number, number],
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function cross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

/** A lattice: where it is pinned, how far apart, and how far it has to reach. */
interface Lattice {
  /** The point the ruling is anchored on, so it lines up with what it measures. */
  readonly atX: number;
  readonly atY: number;
  readonly strideX: number;
  /** Separate from `strideX`: the screen panel is not square in tiles, and one
   * stride for both would draw a grid that lies about the field's aspect. */
  readonly strideY: number;
  readonly width: number;
  readonly height: number;
}

/** A faint lattice, so a slide of half a tile is readable as motion. */
function drawGrid(ctx: CanvasRenderingContext2D, lattice: Lattice): void {
  const { atX, atY, strideX, strideY, width, height } = lattice;
  if (strideX < 2 || strideY < 2) {
    return;
  }
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = atX % strideX; x < width; x += strideX) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = atY % strideY; y < height; y += strideY) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}
