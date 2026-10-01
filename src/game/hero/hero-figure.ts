/**
 * The hero as the game draws him: the equipped model, his face, his light, and
 * whether the blade is burning — one call, shared by the layer and the lab so
 * the lab can never show a different man from the one you play.
 */

import { CAST, HERO_EQUIPPED, HERO_FACE, IDLE, SWING, WALK } from "../models";
import { samplePose, type RigPose } from "../rig";
import { renderVolume, type VolumeRender } from "./rig-volume";
import type { RasterLight, ScreenPrim } from "./volume-raster";

export interface FigureOptions {
  /** The turn about his vertical axis — `facingYaw(heading)` for one of the eight. */
  readonly yaw?: number;
  readonly flipX?: boolean;
  /** -1..1, which way across the screen he is looking. */
  readonly gaze?: number;
  readonly enchanted?: boolean;
  /** Clock for the blade's flicker. */
  readonly timeMs?: number;
  readonly light?: RasterLight;
  /** Bodies simulated elsewhere — the scarf's tail. */
  readonly extras?: readonly ScreenPrim[];
}

/** Seed of the burning blade's churn; any constant, fixed so captures repeat. */
const BLADE_SEED = 0xb1ade;

/** The equipped hero at a pose, as lit pixels plus the solved skeleton. */
export function heroFigure(pose: RigPose, options: FigureOptions = {}): VolumeRender {
  const enchanted = options.enchanted === true;
  return renderVolume(HERO_EQUIPPED, pose, {
    yaw: options.yaw,
    flipX: options.flipX,
    gaze: options.gaze,
    light: options.light,
    face: HERO_FACE,
    extras: options.extras,
    retint: enchanted ? { sword: "fire" } : undefined,
    glow: enchanted ? { sword: { timeMs: options.timeMs ?? 0, seed: BLADE_SEED } } : undefined,
  });
}

/**
 * Which clips, sampled where — the layering `hero-layer.ts` has always done,
 * as a pure function so the lab can call it too.
 *
 * Legs and root come from the walk (or the idle breath); the cast, when one is
 * running, owns both arms over that; the swing owns the sword arm over both.
 * Channels a clip does not key fall through, so every combination is one line.
 */
export function layeredPose(tracks: {
  readonly walkMs?: number;
  readonly idleMs: number;
  readonly castMs?: number;
  readonly swingMs?: number;
}): RigPose {
  const base = HERO_EQUIPPED.basePose;
  const legs =
    tracks.walkMs === undefined ? samplePose(IDLE, base, tracks.idleMs) : samplePose(WALK, base, tracks.walkMs);
  const cast =
    tracks.castMs === undefined
      ? legs
      : samplePose(CAST, legs, tracks.castMs);
  return tracks.swingMs === undefined ? cast : samplePose(SWING, cast, tracks.swingMs);
}
