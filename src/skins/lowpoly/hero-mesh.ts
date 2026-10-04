/**
 * The hero as low-poly solids on his skeleton.
 *
 * He is the same rig the pixel skin draws: `HERO_EQUIPPED`, posed by the same
 * layered clips (`layeredPose`, `tracksOf`) and turned by the same yaw. Each
 * body piece the rig already describes - a capsule or a sphere on a bone, in a
 * material (`HERO_VOLUMES`, the sword's own) - becomes a six-sided prism or an
 * icosahedron here. So a new clip, a new piece of gear or a re-proportioned
 * limb shows up in this skin with nothing written for it.
 *
 * Rig space is logical pixels, x right, y toward the viewer, z up; the mesh is
 * tiles, x right, y ahead, z up - `toLocal` is the one conversion.
 */

import { HERO_EQUIPPED } from "../../game/models";
import { orientVector, solveModel, type RigPose, type VolumePiece, type Vec3 as RigVec3 } from "../../game/rig";
import { TILE_WIDTH } from "../../game/projection";
import { Kind, MeshBuilder, mixRgb, type Rgb, type Vec3 } from "./mesh";
import { LOWPOLY } from "./palette";
import { blob, frustum } from "./primitives";

/** Every bone's body pieces, the sword's included. */
const VOLUMES: Readonly<Record<string, readonly VolumePiece[]>> = {
  ...HERO_EQUIPPED.volumes,
  ...Object.fromEntries(
    HERO_EQUIPPED.parts.flatMap((part) => (part.kind === "bone" && part.volumes !== undefined ? [[part.bone.name, part.volumes]] : [])),
  ),
};

/** Sides on a limb: six reads as round from any yaw and as faceted up close. */
const LIMB_SIDES = 6;

/** A rig material as this skin colours it; a darker `shade` is the trousers' cloth. */
function pieceColour(piece: VolumePiece, enchanted: boolean): { colour: Rgb; kind: typeof Kind.body | typeof Kind.glow } {
  if (enchanted && piece.material === "metal") {
    return { colour: LOWPOLY.fire, kind: Kind.glow };
  }
  const shade = piece.shade ?? 0;
  switch (piece.material) {
    case "tunic":
      return { colour: shade < -0.2 ? LOWPOLY.trousers : LOWPOLY.tunic, kind: Kind.body };
    case "skin":
      return { colour: LOWPOLY.skin, kind: Kind.body };
    case "hair":
      return { colour: LOWPOLY.hair, kind: Kind.body };
    case "leather":
      return { colour: LOWPOLY.leather, kind: Kind.body };
    case "crimson":
      return { colour: LOWPOLY.crimson, kind: Kind.body };
    case "metal":
      return { colour: LOWPOLY.metal, kind: Kind.body };
    case "gold":
      return { colour: LOWPOLY.gold, kind: Kind.body };
    default:
      return { colour: mixRgb(LOWPOLY.rock, LOWPOLY.tunic, 0.5), kind: Kind.body };
  }
}

/** A rig point (pixels, y toward the viewer) as local tiles (y ahead), raised by `lift` tiles. */
function toLocal(point: RigVec3, lift: number): Vec3 {
  return [point.x / TILE_WIDTH, -point.y / TILE_WIDTH, point.z / TILE_WIDTH + lift];
}

export interface HeroMeshOptions {
  /** The turn of the rig: 0 faces the viewer, as everywhere else. */
  readonly yaw: number;
  readonly enchanted: boolean;
  /** Tiles he stands below the ground - his shins in a lake. */
  readonly sunk: number;
}

/** The posed hero, in local tiles round his foot at the origin. */
export function heroMesh(b: MeshBuilder, pose: RigPose, options: HeroMeshOptions): void {
  const solved = solveModel(HERO_EQUIPPED, pose, { yaw: options.yaw });
  const lift = -options.sunk;
  for (const [bone, pieces] of Object.entries(VOLUMES)) {
    const segment = solved[bone];
    if (segment === undefined) {
      continue;
    }
    const along = (t: number, offset: RigVec3 | undefined): Vec3 => {
      const nudge = offset === undefined ? { x: 0, y: 0, z: 0 } : orientVector(offset, options.yaw, false);
      return toLocal(
        {
          x: segment.start.x + (segment.end.x - segment.start.x) * t + nudge.x,
          y: segment.start.y + (segment.end.y - segment.start.y) * t + nudge.y,
          z: segment.start.z + (segment.end.z - segment.start.z) * t + nudge.z,
        },
        lift,
      );
    };
    pieces.forEach((piece, index) => {
      const { colour, kind } = pieceColour(piece, options.enchanted);
      const style = { colour, kind, anchor: [0, 0] as const };
      const radius = piece.radius / TILE_WIDTH;
      if (piece.to === undefined) {
        blob(b, along(piece.from, piece.offset), [radius, radius, radius], style, index * 131 + bone.length, 0);
      } else {
        frustum(
          b,
          {
            from: along(piece.from, piece.offset),
            to: along(piece.to, piece.offset),
            r0: radius,
            r1: (piece.radiusEnd ?? piece.radius) / TILE_WIDTH,
            sides: LIMB_SIDES,
          },
          style,
        );
      }
    });
  }
  eyes(b, solved.head?.end, options.yaw, lift);
}

/**
 * Two dark eyes on the front of the face - the one detail that says which way
 * he is looking from any distance. On his back they are inside his head.
 */
function eyes(b: MeshBuilder, head: RigVec3 | undefined, yaw: number, lift: number): void {
  if (head === undefined) {
    return;
  }
  for (const side of [-1, 1]) {
    const out = orientVector({ x: side * 1.15, y: 3.45, z: -0.3 }, yaw, false);
    const at = toLocal({ x: head.x + out.x, y: head.y + out.y, z: head.z + out.z }, lift);
    const r = 0.5 / TILE_WIDTH;
    blob(b, at, [r, r, r * 1.3], { colour: LOWPOLY.hair, anchor: [0, 0] }, side, 0);
  }
}

/** How tall he stands in the base pose, logical pixels: what centres him in the window. */
export function heroHeightPx(): number {
  const solved = solveModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
  let top = 0;
  for (const [bone, pieces] of Object.entries(VOLUMES)) {
    const segment = solved[bone];
    for (const piece of pieces) {
      if (segment !== undefined) {
        const t = piece.to ?? piece.from;
        const z = segment.start.z + (segment.end.z - segment.start.z) * t + (piece.offset?.z ?? 0);
        top = Math.max(top, z + piece.radius);
      }
    }
  }
  return Math.ceil(top);
}
