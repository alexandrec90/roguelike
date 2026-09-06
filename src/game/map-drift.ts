/**
 * How far the picture is from the simulation, mid-step and at the step's end.
 *
 * This module exists because of one specific complaint that no screenshot and
 * no unit test caught: walking *sideways* makes things on screen jump about,
 * and the amount each one jumps by is different. It is not a rendering bug in
 * any single layer. It is a mismatch between two descriptions of the same
 * motion:
 *
 * - The **simulation** turns. `stepStrafe` swings the whole local frame around
 *   a pivot `radius` tiles behind the hero, so a point `y` tiles ahead sweeps
 *   sideways by `d * (1 + y / radius)` and a point `x` tiles to the side also
 *   moves in depth by `d * x / radius`. Near and far move by different amounts;
 *   that gradient is the parallax the round planet is for.
 * - The **drawing** translates. `scrollPhase` carries a step in flight as one
 *   uniform offset — every layer is shifted by the same `phaseX` tiles — and at
 *   the step boundary `groundPose` advances to the genuinely rotated pose.
 *
 * A translation cannot approximate a rotation, so the two agree at the start of
 * a step and disagree by the end, at which point the drawing snaps onto the
 * truth. Walking *forward* is exempt: that step really is a translation, and the
 * two descriptions are identical. Only strafing is affected, which is exactly
 * the axis the wrongness is reported on.
 *
 * Everything here is pure so the map can report the number and a test can pin
 * it. The overlay draws what this returns; it does not re-derive any of it.
 */

import { applyGait, toLocal, fromLocal, type Gait, type LocalPoint, type PlanetPose } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

/** One probe: where a point is, where it is going, and where it is drawn. */
export interface DriftSample {
  /** The probe's local position at the start of the step. */
  readonly local: LocalPoint;
  /** Where the simulation actually puts it at `progress`. */
  readonly truth: LocalPoint;
  /** Where the rigid-translation drawing puts it at `progress`. */
  readonly drawn: LocalPoint;
  /** Truth minus drawing, in logical screen pixels. */
  readonly dxPx: number;
  readonly dyPx: number;
}

/** The worst disagreement in a set of probes, in pixels. */
export function worstDrift(samples: readonly DriftSample[]): number {
  return samples.reduce((worst, s) => Math.max(worst, Math.hypot(s.dxPx, s.dyPx)), 0);
}

/**
 * Where the drawing puts a point part-way through a step.
 *
 * This is `camera.ts`'s rule written out: `localFoot` subtracts the phase from
 * the local coordinate, and the phase is `gait * progress`. The whole world is
 * one rigid picture sliding by that offset.
 */
export function drawnAt(local: LocalPoint, gait: Gait, progress: number): LocalPoint {
  return {
    x: local.x - gait.strafe * progress,
    y: local.y - gait.forward * progress,
  };
}

/**
 * Where the simulation puts the same point.
 *
 * Round-tripped through the planet on purpose rather than rotated in place:
 * the planet is the only frame in which a feature holds still, so converting
 * out and back is the definition of "where has the world carried it", seam and
 * all.
 */
export function truthAt(
  from: PlanetPose,
  local: LocalPoint,
  gait: Gait,
  radius: number,
  progress: number,
): LocalPoint {
  const walked = { forward: gait.forward * progress, strafe: gait.strafe * progress };
  return toLocal(applyGait(from, walked, radius), fromLocal(from, local));
}

/**
 * Measure every probe at one instant of a step.
 *
 * `progress` of 1 is the interesting one — the instant `groundPose` advances
 * and the picture snaps — but any fraction is valid, and sweeping it is how the
 * map shows that the error grows smoothly and then discharges all at once.
 */
export function stepDrift(
  from: PlanetPose,
  gait: Gait,
  radius: number,
  probes: readonly LocalPoint[],
  progress = 1,
): DriftSample[] {
  return probes.map((local) => {
    const truth = truthAt(from, local, gait, radius, progress);
    const drawn = drawnAt(local, gait, progress);
    return {
      local,
      truth,
      drawn,
      dxPx: (truth.x - drawn.x) * TILE_WIDTH,
      dyPx: (truth.y - drawn.y) * TILE_DEPTH,
    };
  });
}

/**
 * A lattice of probes over the visible field.
 *
 * Coarse on purpose: the drift is a smooth linear field, so a handful of points
 * describes it completely and a dense grid would only make the overlay
 * unreadable.
 */
export function probeGrid(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  stride = 5,
): LocalPoint[] {
  const probes: LocalPoint[] = [];
  for (let y = Math.ceil(minY); y <= maxY; y += stride) {
    for (let x = Math.ceil(minX); x <= maxX; x += stride) {
      probes.push({ x, y });
    }
  }
  return probes;
}
