/**
 * The skeleton's looseness: a secondary-motion term summed onto the shared
 * pose, so the low-poly hero's upper body hangs and rattles instead of riding
 * his hips like a coat hanger.
 *
 * The clips key the legs and the arms; the torso, shoulders and head hold the
 * base pose unless a swing or a cast leans them. Directions in a pose are
 * absolute, not relative to the parent, so a leaning spine on its own would
 * leave the shoulders level and the skull bolt upright. This term moves all
 * three together, on the stride's own phase:
 *
 * - the spine leans over the planted leg and hunches forward;
 * - the shoulder line tilts with the lean and shrugs against the arm swing;
 * - the skull lolls the other way a beat late and nods at each footfall;
 * - the arms hang in nearer the ribs and flop through after the stride.
 *
 * Standing, the same terms run slowly and small: an undead sway. Pure in
 * (pose, tracks), so a capture at a fixed time repeats. It only reshapes the
 * picture - where he walks and what he hits are decided before it runs.
 */

import { layeredPose } from "../../game/hero/hero-figure";
import { CAST, SWING, WALK } from "../../game/models";
import { vec3, type RigPose, type Vec3 } from "../../game/rig";

export type SwayTracks = Parameters<typeof layeredPose>[0];

/** Standing, one slow sway takes this long, ms. */
const IDLE_SWAY_MS = 2600;
/** How much of the walking sway survives standing. */
const IDLE_SHARE = 0.45;

/** Sideways lean of the spine over the planted leg. */
const SWAY = 0.16;
/** Forward stoop of the spine: walking, and standing. */
const HUNCH_WALK = 0.22;
const HUNCH_IDLE = 0.12;
/** The shoulder line's shrug against the arm swing. */
const SHRUG = 0.14;
/** The skull's counter-loll, how late it follows, its droop and its nod. */
const LOLL = 0.24;
const LOLL_LAG = 0.8;
const DROOP = 0.14;
const NOD = 0.08;
/** How far the arms hang in toward the ribs, and their follow-through. */
const ARMS_IN = 0.32;
const FLOP = 0.3;
const FLOP_LAG = 0.6;

/** A share of a clip's ends over which it hands its bones back. */
const HANDOVER = 0.2;

/**
 * 1 while a one-shot clip is not playing, 0 through its middle, eased at each
 * end - so the term lets go of the bones a swing or a cast keys, and takes
 * them back as the clip settles, without a pop either side.
 */
export function freeOf(clipMs: number | undefined, durationMs: number): number {
  if (clipMs === undefined) {
    return 1;
  }
  const t = Math.min(Math.max(clipMs / durationMs, 0), 1);
  const owned = Math.min(1, t / HANDOVER, (1 - t) / HANDOVER);
  return 1 - owned;
}

function add(a: Vec3 | undefined, x: number, y: number, z: number): Vec3 {
  const base = a ?? vec3(0, 0, 0);
  return vec3(base.x + x, base.y + y, base.z + z);
}

/** The pose with the skeleton's looseness summed on. */
export function looseSkeleton(pose: RigPose, tracks: SwayTracks): RigPose {
  const walking = tracks.walkMs !== undefined;
  const phase = walking
    ? ((tracks.walkMs ?? 0) / WALK.durationMs) * Math.PI * 2
    : (tracks.idleMs / IDLE_SWAY_MS) * Math.PI * 2;
  const amount = walking ? 1 : IDLE_SHARE;
  const swingFree = freeOf(tracks.swingMs, SWING.durationMs);
  const castFree = freeOf(tracks.castMs, CAST.durationMs);
  const spineFree = Math.min(swingFree, castFree);

  const lean = SWAY * amount * Math.sin(phase) * spineFree;
  const hunch = (walking ? HUNCH_WALK : HUNCH_IDLE) * spineFree;
  const shrug = SHRUG * amount * Math.cos(phase);
  const flop = FLOP * amount * Math.cos(phase - FLOP_LAG) * (walking ? 1 : 0);
  const bones = pose.bones;
  return {
    root: pose.root,
    bones: {
      ...bones,
      torso: add(bones.torso, lean, hunch, 0),
      // Leaning right drops the right shoulder; the shrug lifts one as its arm swings back.
      "shoulder-l": add(bones["shoulder-l"], 0, 0, lean + shrug),
      "shoulder-r": add(bones["shoulder-r"], 0, 0, -lean - shrug),
      head: add(
        bones.head,
        -LOLL * amount * Math.sin(phase - LOLL_LAG),
        DROOP + NOD * amount * Math.sin(phase * 2),
        0,
      ),
      "arm-l": add(bones["arm-l"], ARMS_IN * castFree + lean, -flop * castFree, 0),
      "arm-r": add(bones["arm-r"], (-ARMS_IN + lean) * spineFree, flop * spineFree, 0),
    },
  };
}
