/**
 * A posed rig as a lit body: the volumetric renderer.
 *
 * `renderModel` strokes each bone as a line in one ink, which is a skeleton.
 * This dresses the same solved skeleton in flesh: every bone carries pieces
 * (`VolumePiece`) — a capsule of a radius and a material along part of it, a
 * sphere at a joint, a crossbar — and each piece is projected with exactly the
 * world's projection (`x`, `y·DEPTH_RATIO − z`), then handed to
 * `volume-raster.ts` to be filled nearest-first and lit from its own normal.
 *
 * So everything the line rig already had comes for free: clips, layering,
 * facing (`yaw` turns the bones, and the pieces' offsets with them — the belt
 * buckle goes behind him), mirroring, and gear that is a bone. A sword is
 * still one gear part; it now has a grip, a gold guard and a steel blade.
 */

import { effectiveSkeleton, orientVector, solveModel, type RenderOptions, type RigModel, type RigPose, type SolvedPose, type Vec3 } from "../rig";
import { DEPTH_RATIO } from "../projection";
import type { InkId, PixelCloud } from "../ink";
import { rasterizePrims, type RasterLight, type ScreenPrim } from "./volume-raster";
import type { Material, VolumePiece } from "../rig";

/** A point on screen, foot-relative, with its rig depth. */
export interface ScreenPoint3 {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/** Where the face goes, and what it is drawn with. */
export interface FaceSpec {
  /** The bone whose end is the head's centre. */
  readonly bone: string;
  /** Eyes this many pixels either side of the centre line. */
  readonly spacing: number;
  /** And this far below the head's centre. */
  readonly drop: number;
  readonly ink: InkId;
  /** Only drawn over this material, so a hair fringe is never given an eye. */
  readonly on: Material;
}

export interface VolumeOptions extends RenderOptions {
  readonly light?: RasterLight;
  /** -1..1: which way he is looking across the screen. Slides the eyes. */
  readonly gaze?: number;
  /** Swap a bone's materials wholesale — the enchanted blade is `sword → fire`. */
  readonly retint?: Readonly<Record<string, Material>>;
  /** Make a bone self-lit from noise at this time. */
  readonly glow?: Readonly<Record<string, { readonly timeMs: number; readonly seed: number }>>;
  readonly face?: FaceSpec;
  /** More bodies in screen space — a scarf simulated elsewhere. */
  readonly extras?: readonly ScreenPrim[];
}

export interface VolumeRender {
  readonly cloud: PixelCloud;
  readonly solved: SolvedPose;
}

const DEFAULT_LIGHT: RasterLight = { x: -0.6, y: -0.8, ambient: 0.22 };

/** Rig space to screen, unrounded: the world's projection, re-used. */
export function projectPoint(point: Vec3): ScreenPoint3 {
  return { x: point.x, y: point.y * DEPTH_RATIO - point.z, depth: point.y };
}

function along(start: Vec3, end: Vec3, t: number, offset: Vec3): Vec3 {
  return {
    x: start.x + (end.x - start.x) * t + offset.x,
    y: start.y + (end.y - start.y) * t + offset.y,
    z: start.z + (end.z - start.z) * t + offset.z,
  };
}

function orientOffset(offset: Vec3 | undefined, options: VolumeOptions): Vec3 {
  if (offset === undefined) {
    return { x: 0, y: 0, z: 0 };
  }
  return orientVector(offset, options.yaw ?? 0, options.flipX === true);
}

interface PieceContext {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly group: number;
  readonly material?: Material;
  readonly glow?: { readonly timeMs: number; readonly seed: number };
}

function piecePrim(piece: VolumePiece, context: PieceContext, options: VolumeOptions): ScreenPrim {
  const offset = orientOffset(piece.offset, options);
  const a = projectPoint(along(context.start, context.end, piece.from, offset));
  let b = piece.to === undefined ? a : projectPoint(along(context.start, context.end, piece.to, offset));
  let from = a;
  if (piece.across !== undefined) {
    // Square to the bone on screen: the bar a crossguard is, whatever the swing.
    const s = projectPoint(context.start);
    const e = projectPoint(context.end);
    const length = Math.hypot(e.x - s.x, e.y - s.y) || 1;
    const px = (-(e.y - s.y) / length) * piece.across;
    const py = ((e.x - s.x) / length) * piece.across;
    from = { x: a.x + px, y: a.y + py, depth: a.depth };
    b = { x: a.x - px, y: a.y - py, depth: a.depth };
  }
  return {
    ax: from.x,
    ay: from.y,
    bx: b.x,
    by: b.y,
    ra: piece.radius,
    rb: piece.radiusEnd ?? piece.radius,
    da: from.depth,
    db: b.depth,
    material: context.material ?? piece.material,
    shade: piece.shade ?? 0,
    group: context.group,
    emissive: context.glow,
  };
}

/** Every piece of every bone, projected — the input the raster fills. */
export function modelPrims(model: RigModel, solved: SolvedPose, options: VolumeOptions = {}): ScreenPrim[] {
  const prims: ScreenPrim[] = [];
  const gear = new Map<string, readonly VolumePiece[]>();
  for (const part of model.parts) {
    if (part.kind === "bone" && part.volumes !== undefined) {
      gear.set(part.bone.name, part.volumes);
    }
  }
  effectiveSkeleton(model).bones.forEach((bone, group) => {
    const segment = solved[bone.name];
    const pieces = model.volumes?.[bone.name] ?? gear.get(bone.name);
    if (segment === undefined || pieces === undefined) {
      return;
    }
    const context: PieceContext = {
      start: segment.start,
      end: segment.end,
      group,
      material: options.retint?.[bone.name],
      glow: options.glow?.[bone.name],
    };
    for (const piece of pieces) {
      prims.push(piecePrim(piece, context, options));
    }
  });
  return prims;
}

/**
 * How far proud of the head's centre line the eyes sit, in the model's own
 * frame. Against `spacing` it decides where each eye goes round the side: both
 * show from the front and on a three-quarter view, one in profile, none from
 * behind.
 */
const EYE_OUT = 1.2;

function drawFace(
  raster: ReturnType<typeof rasterizePrims>,
  solved: SolvedPose,
  face: FaceSpec,
  options: VolumeOptions,
): void {
  const head = solved[face.bone];
  if (head === undefined) {
    return;
  }
  const centre = projectPoint(head.end);
  const y = Math.round(centre.y + face.drop);
  const middle = Math.round(centre.x + Math.round(options.gaze ?? 0));
  for (const side of [-face.spacing, face.spacing]) {
    // Each eye turns with the head: it slides by its turned x, and is round the
    // far side - so not drawn - once its turned depth points away.
    const eye = orientVector({ x: side, y: EYE_OUT, z: 0 }, options.yaw ?? 0, options.flipX === true);
    if (eye.y <= 0) {
      continue;
    }
    const x = middle + Math.round(eye.x);
    if (raster.materialAt(x, y) === face.on) {
      raster.setInk(x, y, face.ink);
    }
  }
}

/**
 * The posed model as lit, outlined pixels, foot-anchored at (0, 0).
 *
 * Eyes are the one drawn detail, and they are drawn only while they face the
 * viewer and only over skin — the front/back contract, and the reason a fringe
 * can hang over them without being punched through.
 */
export function renderVolume(model: RigModel, pose: RigPose, options: VolumeOptions = {}): VolumeRender {
  const solved = solveModel(model, pose, options);
  const prims = [...modelPrims(model, solved, options), ...(options.extras ?? [])];
  const raster = rasterizePrims(prims, options.light ?? DEFAULT_LIGHT);
  if (options.face !== undefined) {
    drawFace(raster, solved, options.face, options);
  }
  return { cloud: raster.cloud, solved };
}

/** A bone's span on screen between two fractions of it — where a blade is. */
export function boneSpan(solved: SolvedPose, bone: string, from = 0, to = 1): {
  readonly a: ScreenPoint3;
  readonly b: ScreenPoint3;
} | undefined {
  const segment = solved[bone];
  if (segment === undefined) {
    return undefined;
  }
  const zero = { x: 0, y: 0, z: 0 };
  return {
    a: projectPoint(along(segment.start, segment.end, from, zero)),
    b: projectPoint(along(segment.start, segment.end, to, zero)),
  };
}
