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
 * - **Both axes are read, and the newest press wins its own axis.** Holding
 *   right and then pressing up goes up *and* right, because this is a
 *   twin-stick game and two inputs at once mean a diagonal. Pressing left while
 *   right is still down reverses, and releasing left resumes right — the
 *   newest-wins rule survives, scoped to the axis the two of them share instead
 *   of applied across all four.
 */

import {
  actionForButton,
  actionForKey,
  COMMANDS,
  DEFAULT_KEYBINDINGS,
  DIRECTION_AXES,
  HEADING_VECTOR,
  headingOf,
  headingToward,
  type Command,
  type Direction,
  type GameAction,
  type Heading,
  type Keybindings,
  type MouseButton,
} from "./keybindings";
import { DEPTH_RATIO } from "./projection";

export interface ControlState {
  readonly bindings: Keybindings;
  /** Sources currently holding each action: `key:KeyW`, `mouse:left`. */
  readonly held: Map<GameAction, Set<string>>;
  /** Press sequence per action, so the most recent held direction is findable. */
  readonly pressedAt: Map<GameAction, number>;
  /** A monotonic counter; wall-clock time would tie on a same-frame press. */
  sequence: number;
  /**
   * Commands pressed and not yet acted on, kept until they are spent. A tap on
   * attack that lands during a 520 ms swing is a queued follow-up, not a
   * discarded input; the same holds for a cast, and a tap on enchant is only
   * ever a press — it toggles, so holding it must not flicker the blade.
   */
  readonly queued: Set<Command>;
  /**
   * The heading last pressed, kept on the same terms.
   *
   * Without it a tap shorter than a frame is silently lost: press and release
   * both land between two `update` calls, so nothing is held by the time the
   * game looks. A press owes exactly one step whether or not the key is still
   * down when it is read.
   *
   * Two taps in the same frame join into the diagonal they mean, rather than
   * the second overwriting the first — a flick of up-and-right is a flick
   * up-right even when neither key survives to the next `update`.
   */
  queuedHeading: Heading | undefined;
  /**
   * Where the player is pointing - the second stick, which is the mouse.
   *
   * `undefined` until the pointer first moves, so a keyboard-only player still
   * faces where he walks; from then on it holds the last direction pointed,
   * because a cursor that has stopped moving is still pointing somewhere.
   */
  aim: Heading | undefined;
}

export function createControls(bindings: Keybindings = DEFAULT_KEYBINDINGS): ControlState {
  return {
    bindings,
    held: new Map(),
    pressedAt: new Map(),
    sequence: 0,
    queued: new Set(),
    queuedHeading: undefined,
    aim: undefined,
  };
}

/**
 * Point the aim along a screen-pixel offset from the hero's chest.
 *
 * The offset is un-foreshortened first: the screen squashes depth by
 * `DEPTH_RATIO`, so a cursor that *looks* diagonal on screen is further ahead
 * on the ground than it is across, and the sectors are drawn on the ground. An
 * offset of zero - the cursor on his chest - keeps the aim it had.
 */
export function aimAt(state: ControlState, dx: number, dy: number): void {
  state.aim = headingToward(dx, dy / DEPTH_RATIO) ?? state.aim;
}

export function currentAim(state: ControlState): Heading | undefined {
  return state.aim;
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
 * attack goes too: it was pressed before the player looked away. The aim stays -
 * it is a position, not a press, and nothing was left held down.
 */
export function releaseAll(state: ControlState): void {
  state.held.clear();
  state.pressedAt.clear();
  state.queued.clear();
  state.queuedHeading = undefined;
}

export function isHeld(state: ControlState, action: GameAction): boolean {
  return (state.held.get(action)?.size ?? 0) > 0;
}

/** The most recently pressed of a set of directions that is still held. */
function newestHeld(
  state: ControlState,
  directions: readonly Direction[],
): Direction | undefined {
  let newest: Direction | undefined;
  let newestAt = -1;
  for (const direction of directions) {
    const at = state.pressedAt.get(direction) ?? -1;
    if (isHeld(state, direction) && at > newestAt) {
      newest = direction;
      newestAt = at;
    }
  }
  return newest;
}

/**
 * The heading everything currently held adds up to.
 *
 * One winner per axis, then the two summed: up and right held together is
 * northeast, and up plus down is whichever of the pair was pressed later rather
 * than a cancelled-out stand still.
 */
export function heldHeading(state: ControlState): Heading | undefined {
  let dx = 0;
  let dy = 0;
  for (const axis of DIRECTION_AXES) {
    const held = newestHeld(state, axis);
    if (held === undefined) {
      continue;
    }
    dx += HEADING_VECTOR[held].dx;
    dy += HEADING_VECTOR[held].dy;
  }
  return headingOf(dx, dy);
}

/**
 * Which way the player wants to go: what is held, or failing that the tap that
 * has not been walked yet.
 *
 * Held wins, so a queued tap never overrides the keys the player is leaning on.
 */
export function nextHeading(state: ControlState): Heading | undefined {
  return heldHeading(state) ?? state.queuedHeading;
}

export function spendHeading(state: ControlState): void {
  state.queuedHeading = undefined;
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
  return state.queued.has("attack") || isHeld(state, "attack");
}

export function spendAttack(state: ControlState): void {
  state.queued.delete("attack");
}

/** Whether the player wants to cast: held or queued, exactly like the sword. */
export function wantsCast(state: ControlState): boolean {
  return state.queued.has("cast") || isHeld(state, "cast");
}

export function spendCast(state: ControlState): void {
  state.queued.delete("cast");
}

/** Whether the player wants the frost nova: held or queued, like a cast. */
export function wantsFrost(state: ControlState): boolean {
  return state.queued.has("frost") || isHeld(state, "frost");
}

export function spendFrost(state: ControlState): void {
  state.queued.delete("frost");
}

/**
 * Whether a toggle of the blade's fire is owed. Queued only, never held: one
 * press is one toggle, however long the key stays down.
 */
export function wantsEnchant(state: ControlState): boolean {
  return state.queued.has("enchant");
}

export function spendEnchant(state: ControlState): void {
  state.queued.delete("enchant");
}

function isCommand(action: GameAction): action is Command {
  return (COMMANDS as readonly GameAction[]).includes(action);
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
    if (isCommand(action)) {
      state.queued.add(action);
    } else {
      state.queuedHeading = joinQueued(state.queuedHeading, action);
    }
  }
  return true;
}

/**
 * Fold a fresh direction into the unspent tap debt.
 *
 * The new press owns its own axis and leaves the other one alone, so up-then-
 * right within a single frame owes one northeast step, and up-then-down owes a
 * step south. A direction is never the zero vector, so the fallback is
 * unreachable and only there to keep the type honest.
 */
function joinQueued(queued: Heading | undefined, pressed: Direction): Heading {
  const fresh = HEADING_VECTOR[pressed];
  const prior = queued === undefined ? { dx: 0, dy: 0 } : HEADING_VECTOR[queued];
  const dx = fresh.dx === 0 ? prior.dx : fresh.dx;
  const dy = fresh.dy === 0 ? prior.dy : fresh.dy;
  return headingOf(dx, dy) ?? pressed;
}

function release(state: ControlState, action: GameAction | undefined, source: string): boolean {
  if (action === undefined) {
    return false;
  }
  state.held.get(action)?.delete(source);
  return true;
}
