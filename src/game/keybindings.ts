/**
 * The control map: which physical inputs mean which game action.
 *
 * This is the one file a rebinding touches. Nothing downstream names a key: the
 * control state (`controls.ts`) speaks in `GameAction`s, and the turn simulation
 * (`player.ts`) speaks in `Direction`s, so adding a gamepad or letting a player
 * rebind `KeyW` is a change to this table and to nothing else.
 *
 * Keys are `KeyboardEvent.code` — the physical key, not the character it
 * produces — so `KeyW` is the same key on AZERTY as on QWERTY and the bindings
 * do not silently move with the layout. Mouse buttons are named rather than
 * numbered for the same reason `button === 2` should never appear in game code.
 *
 * An action may carry several inputs, which is all "redundant bindings" means:
 * the arrows are a second spelling of WASD, and the mouse buttons a second
 * spelling of the space bar.
 */

/** The four ways a turn-based actor can leave a cell. Row 0 is the far edge. */
export type Direction = "north" | "south" | "west" | "east";

export type GameAction = Direction | "attack";

export type MouseButton = "left" | "middle" | "right";

export const DIRECTIONS: readonly Direction[] = ["north", "south", "west", "east"];

export const GAME_ACTIONS: readonly GameAction[] = [...DIRECTIONS, "attack"];

export interface ActionBinding {
  /** `KeyboardEvent.code` values, in the order a help screen should list them. */
  readonly keys: readonly string[];
  readonly buttons?: readonly MouseButton[];
}

export type Keybindings = Readonly<Record<GameAction, ActionBinding>>;

/**
 * WASD to move, with the arrows as a redundant second set; space to attack,
 * with either mouse button as a redundant second set.
 *
 * The middle button is deliberately unbound — it is a scroll wheel on most
 * hardware and binding it to an attack fires one on every accidental click.
 */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  north: { keys: ["KeyW", "ArrowUp"] },
  south: { keys: ["KeyS", "ArrowDown"] },
  west: { keys: ["KeyA", "ArrowLeft"] },
  east: { keys: ["KeyD", "ArrowRight"] },
  attack: { keys: ["Space"], buttons: ["left", "right"] },
};

/** `MouseEvent.button` / Phaser's `Pointer.button`, named. */
const BUTTON_BY_INDEX: readonly MouseButton[] = ["left", "middle", "right"];

export function mouseButtonOf(index: number): MouseButton | undefined {
  return BUTTON_BY_INDEX[index];
}

export function actionForKey(
  code: string,
  bindings: Keybindings = DEFAULT_KEYBINDINGS,
): GameAction | undefined {
  return GAME_ACTIONS.find((action) => bindings[action].keys.includes(code));
}

export function actionForButton(
  button: MouseButton,
  bindings: Keybindings = DEFAULT_KEYBINDINGS,
): GameAction | undefined {
  return GAME_ACTIONS.find((action) => bindings[action].buttons?.includes(button) === true);
}

/**
 * What is wrong with a control map, as a list of sentences.
 *
 * A binding table is data, and the two ways data goes wrong here are both
 * silent at runtime: an action nothing can trigger, and one input claimed by
 * two actions — where `actionForKey` would return whichever the enum happens to
 * list first, and the loser simply never fires. Asserted in the tests, so a
 * rebinding cannot ship either fault.
 */
export function validateKeybindings(bindings: Keybindings): string[] {
  const problems: string[] = [];
  const claimedKeys = new Map<string, GameAction>();
  const claimedButtons = new Map<MouseButton, GameAction>();

  for (const action of GAME_ACTIONS) {
    const binding = bindings[action];
    if (binding.keys.length === 0 && (binding.buttons?.length ?? 0) === 0) {
      problems.push(`${action} has no input bound to it`);
    }
    for (const key of binding.keys) {
      const owner = claimedKeys.get(key);
      if (owner !== undefined) {
        problems.push(`key ${key} is bound to both ${owner} and ${action}`);
      }
      claimedKeys.set(key, action);
    }
    for (const button of binding.buttons ?? []) {
      const owner = claimedButtons.get(button);
      if (owner !== undefined) {
        problems.push(`${button} mouse button is bound to both ${owner} and ${action}`);
      }
      claimedButtons.set(button, action);
    }
  }
  return problems;
}
