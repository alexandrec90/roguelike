/**
 * The hero as low-poly solids on his skeleton - in this skin, quite literally:
 * an undead skeleton with a stick.
 *
 * He is the same rig the pixel skin draws: `HERO_EQUIPPED`, posed by the same
 * layered clips (`layeredPose`, `tracksOf`) and turned by the same yaw. What
 * hangs on those bones is this skin's own (`hero-dress.ts`): each piece, a
 * capsule or a sphere on a bone, becomes a six-sided prism or an icosahedron
 * here. So a new clip or a re-proportioned limb shows up in this skin with
 * nothing written for it; a new bone needs a line in the dress to be seen.
 *
 * Rig space is logical pixels, x right, y toward the viewer, z up; the mesh is
 * tiles, x right, y ahead, z up - `toLocal` is the one conversion.
 */

import { HERO_EQUIPPED } from "../../game/models";
import { orientVector, solveModel, type RigPose, type Vec3 as RigVec3 } from "../../game/rig";
import { TILE_WIDTH } from "../../game/projection";
import { SKELETON_DRESS, SKULL_HOLES, STICK_DRESS, type DressPiece } from "./hero-dress";
import { Kind, MeshBuilder, type Rgb, type Vec3 } from "./mesh";
import { LOWPOLY } from "./palette";
import { blob, frustum } from "./primitives";

/** Every bone's pieces: the skeleton's, and the stick on the rig's sword bone. */
const VOLUMES: Readonly<Record<string, readonly DressPiece[]>> = {
  ...SKELETON_DRESS,
  sword: STICK_DRESS,
};

/** Sides on a limb: six reads as round from any yaw and as faceted up close. */
const LIMB_SIDES = 6;

/** A piece's colour, or fire if it burns and the stick is enchanted. */
function pieceColour(piece: DressPiece, enchanted: boolean): { colour: Rgb; kind: typeof Kind.body | typeof Kind.glow } {
  if (enchanted && piece.burns === true) {
    return { colour: LOWPOLY.fire, kind: Kind.glow };
  }
  return { colour: LOWPOLY[piece.colour], kind: Kind.body };
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
  /** Tiles of land under his foot - a landform's lower slope (`standingHeight`); 0 on open ground. */
  readonly ground?: number;
}

/** The posed hero, in local tiles round his foot at the origin. */
export function heroMesh(b: MeshBuilder, pose: RigPose, options: HeroMeshOptions): void {
  const solved = solveModel(HERO_EQUIPPED, pose, { yaw: options.yaw });
  const lift = (options.ground ?? 0) - options.sunk;
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
  skullHoles(b, solved.head?.end, options.yaw, lift);
}

/**
 * The skull's empty sockets and nose, dark against the bone - the one detail
 * that says which way he is looking from any distance. On his back they are
 * inside his head.
 */
function skullHoles(b: MeshBuilder, head: RigVec3 | undefined, yaw: number, lift: number): void {
  if (head === undefined) {
    return;
  }
  SKULL_HOLES.forEach(({ at, radius }, index) => {
    const out = orientVector(at, yaw, false);
    const centre = toLocal({ x: head.x + out.x, y: head.y + out.y, z: head.z + out.z }, lift);
    const r = radius / TILE_WIDTH;
    blob(b, centre, [r, r, r], { colour: LOWPOLY.socket, anchor: [0, 0] }, index, 0);
  });
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
