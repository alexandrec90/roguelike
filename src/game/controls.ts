/**
 * What the player is holding down right now, in actions rather than in keys.
 *
 * Everything here is a pure function over a small mutable record, so the whole
 * input model is testable without a browser: the Phaser layer only translates
 * DOM events into `pressKey` / `releaseKey` / `pressButton` / `releaseButton`
 * and never decides anything.
 *
 * Two details are the reason this is a module rather than a `Set<string>`:
 *
 * - **An action can be held from several sources at once.** Space and the mouse
 *   are both bound to `attack`, and releasing one while the other is still down
 *   must not release the action. So each action holds a *set* of sources.
 * - **The newest direction wins.** Holding right and then pressing up should go
 *   up, and releasing up should resume going right — which is what a player
 *   means by it, and what a fixed axis priority (or summing to a diagonal, on a
 *   four-way grid) gets wrong.
 */

import {
  actionForButton,
  actionForKey,
  DEFAULT_KEYBINDINGS,
  DIRECTIONS,
  type Direction,
  type GameAction,
  type Keybindings,
  type MouseButton,
} from "./keybindings";

export interface ControlState {
  readonly bindings: Keybindings;
  /** Sources currently holding each action: `key:KeyW`, `mouse:left`. */
  readonly held: Map<GameAction, Set<string>>;
  /** Press sequence per action, so the most recent held direction is findable. */
  readonly pressedAt: Map<GameAction, number>;
  /** A monotonic counter; wall-clock time would tie on a same-frame press. */
  sequence: number;
  /**
   * An attack pressed while the player was mid-action, kept until it is spent.
   * A tap that lands during a 520 ms swing is a queued follow-up, not a
   * discarded input.
   */
  attackQueued: boolean;
  /**
   * The last direction pressed, kept on the same terms.
   *
   * Without it a tap shorter than a frame is silently lost: press and release
   * both land between two `update` calls, so nothing is held by the time the
   * game looks. A roguelike is played in taps, so a press owes exactly one step
   * whether or not the key is still down when it is read.
   */
  queuedDirection: Direction | undefined;
}

export function createControls(bindings: Keybindings = DEFAULT_KEYBINDINGS): ControlState {
  return {
    bindings,
    held: new Map(),
    pressedAt: new Map(),
    sequence: 0,
    attackQueued: false,
    queuedDirection: undefined,
  };
}

/** True when the input was bound — the caller's cue to `preventDefault` it. */
export function pressKey(state: ControlState, code: string): boolean {
  return press(state, actionForKey(code, state.bindings), `key:${code}`);
}

export function releaseKey(state: ControlState, code: string): boolean {
  return release(state, actionForKey(code, state.bindings), `key:${code}`);
}

export function pressButton(state: ControlState, button: MouseButton | undefined): boolean {
  if (button === undefined) {
    return false;
  }
  return press(state, actionForButton(button, state.bindings), `mouse:${button}`);
}

export function releaseButton(state: ControlState, button: MouseButton | undefined): boolean {
  if (button === undefined) {
    return false;
  }
  return release(state, actionForButton(button, state.bindings), `mouse:${button}`);
}

/**
 * Drop everything, for a window that lost focus.
 *
 * A key released while the tab is in the background never sends its `keyup`, so
 * without this the hero walks into a wall forever after an alt-tab. The queued
 * attack goes too: it was pressed before the player looked away.
 */
export function releaseAll(state: ControlState): void {
  state.held.clear();
  state.pressedAt.clear();
  state.attackQueued = false;
  state.queuedDirection = undefined;
}

export function isHeld(state: ControlState, action: GameAction): boolean {
  return (state.held.get(action)?.size ?? 0) > 0;
}

/** The most recently pressed direction still being held, if any. */
export function heldDirection(state: ControlState): Direction | undefined {
  let newest: Direction | undefined;
  let newestAt = -1;
  for (const direction of DIRECTIONS) {
    const at = state.pressedAt.get(direction) ?? -1;
    if (isHeld(state, direction) && at > newestAt) {
      newest = direction;
      newestAt = at;
    }
  }
  return newest;
}

/**
 * Which way the player wants to go: what is held, or failing that the tap that
 * has not been walked yet.
 *
 * Held wins, so a queued tap never overrides the key the player is leaning on.
 */
export function nextDirection(state: ControlState): Direction | undefined {
  return heldDirection(state) ?? state.queuedDirection;
}

export function spendDirection(state: ControlState): void {
  state.queuedDirection = undefined;
}

/**
 * Whether the player wants to attack this instant.
 *
 * Held counts as well as queued: holding the button swings repeatedly, on the
 * same terms as holding a direction walks repeatedly. This only *reads* the
 * want — the queue is spent by `spendAttack`, on the frame a swing actually
 * starts, so a tap during a swing survives until it can be used.
 */
export function wantsAttack(state: ControlState): boolean {
  return state.attackQueued || isHeld(state, "attack");
}

export function spendAttack(state: ControlState): void {
  state.attackQueued = false;
}

function press(state: ControlState, action: GameAction | undefined, source: string): boolean {
  if (action === undefined) {
    return false;
  }
  const sources = state.held.get(action) ?? new Set<string>();
  // A held key repeats `keydown` at the OS repeat rate; only the first is a
  // press. Movement repeat is the game's clock, not the keyboard's.
  const fresh = !sources.has(source);
  sources.add(source);
  state.held.set(action, sources);
  if (fresh) {
    state.sequence += 1;
    state.pressedAt.set(action, state.sequence);
    if (action === "attack") {
      state.attackQueued = true;
    } else {
      state.queuedDirection = action;
    }
  }
  return true;
}

function release(state: ControlState, action: GameAction | undefined, source: string): boolean {
  if (action === undefined) {
    return false;
  }
  state.held.get(action)?.delete(source);
  return true;
}
