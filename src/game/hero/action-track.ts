/**
 * One action's clock: the shape the sword arm and the casting hands share.
 *
 * `CLAUDE.md` asks that every action live on its own track, because the moment
 * two share an enum one of them starts waiting for the other. This is a track:
 * an optional elapsed time, aged by the frame's delta, that restarts when the
 * action is still wanted as it ends and carries its overshoot so a held button
 * gives an even rhythm. It also reports the one moment gameplay hangs off —
 * the swing's contact, the cast's release — as a crossing, so a beat is
 * delivered exactly once however the frames happen to fall around it.
 */

export interface TrackTick {
  /** Elapsed ms in the action, or undefined when the track is free. */
  readonly ms: number | undefined;
  /** True on the frame a new action started. */
  readonly started: boolean;
  /** True on the frame the action passed its beat. */
  readonly beat: boolean;
}

/**
 * Age a track by `delta`.
 *
 * `cycleMs` is how long the track stays busy (a clip, plus any cooldown);
 * `beatMs` is the moment inside it that matters. A beat is crossed when the
 * clock moves from before it to at-or-after it — by aging an action already
 * running, or by a new one starting with enough carried overshoot to be past
 * it already.
 */
export function advanceTrack(
  ms: number | undefined,
  wanted: boolean,
  delta: number,
  cycleMs: number,
  beatMs: number,
): TrackTick {
  const step = Math.max(delta, 0);
  const aged = ms === undefined ? undefined : ms + step;
  const passed = ms !== undefined && aged !== undefined && ms < beatMs && aged >= beatMs;
  if (aged !== undefined && aged < cycleMs) {
    return { ms: aged, started: false, beat: passed };
  }
  if (!wanted) {
    return { ms: undefined, started: false, beat: passed };
  }
  // Never more than one action's worth of carry, however long the tab slept.
  const carry = aged === undefined ? 0 : Math.min(aged - cycleMs, cycleMs);
  return { ms: carry, started: true, beat: passed || carry >= beatMs };
}
