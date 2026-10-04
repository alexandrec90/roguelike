/**
 * The controls reminder's content, read off the binding table.
 *
 * Nothing here names a key the player presses — it *describes* whatever
 * `keybindings.ts` says, so rebinding an action there changes the reminder with
 * it and the two can never disagree. Pure and DOM-free; `help-overlay.ts` only
 * lays these rows out.
 */

import {
  DEFAULT_KEYBINDINGS,
  DIRECTIONS,
  HELP_KEYS,
  SKIN_KEYS,
  type Command,
  type Keybindings,
  type MouseButton,
} from "./keybindings";

export interface HelpRow {
  /** What the input does, in the player's words. */
  readonly label: string;
  /** Each alternative input, already human-readable: "Space", "Left click". */
  readonly inputs: readonly string[];
}

/** What each command is called on the reminder, in the order it is listed. */
const COMMAND_LABELS: Readonly<Record<Command, string>> = {
  attack: "Swing the sword",
  enchant: "Set the blade alight (toggle)",
  cast: "Throw a fireball",
  frost: "Frost nova — puts grass fires out",
};

const ORDER: readonly Command[] = ["attack", "enchant", "cast", "frost"];

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Slash: "?",
  Enter: "Enter",
  Escape: "Esc",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
};

/** A `KeyboardEvent.code` as the player would say it: `KeyW` → `W`, `ArrowUp` → `↑`. */
export function keyLabel(code: string): string {
  const named = NAMED_KEYS[code];
  if (named !== undefined) {
    return named;
  }
  const match = /^(?:Key|Digit)(.+)$/.exec(code);
  return match?.[1] ?? code;
}

export function buttonLabel(button: MouseButton): string {
  return `${button[0]?.toUpperCase() ?? ""}${button.slice(1)} click`;
}

/**
 * Every row of the reminder: movement first (each set of four direction keys
 * as one "W A S D" group), then each command in play order, then how to close
 * the reminder itself - after the skin switch, the one other key that is not a
 * game action.
 */
export function helpRows(bindings: Keybindings = DEFAULT_KEYBINDINGS): HelpRow[] {
  return [
    movementRow(bindings),
    ...ORDER.map((command) => commandRow(bindings, command)),
    { label: "Switch the look (skin)", inputs: SKIN_KEYS.map(keyLabel) },
    helpRow(),
  ];
}

/**
 * The direction keys grouped into the sets a hand rests on. Each direction may
 * have several keys; the n-th key of every direction forms the n-th set, so
 * `W/↑, A/←, S/↓, D/→` reads as `W A S D` and `↑ ← ↓ →`.
 */
function movementRow(bindings: Keybindings): HelpRow {
  const ordered = [bindings.north, bindings.west, bindings.south, bindings.east];
  const sets = Math.max(...DIRECTIONS.map((direction) => bindings[direction].keys.length));
  const inputs: string[] = [];
  for (let set = 0; set < sets; set += 1) {
    const keys = ordered.map((binding) => binding.keys[set]).filter((key) => key !== undefined);
    if (keys.length > 0) {
      inputs.push(keys.map((key) => keyLabel(key)).join(" "));
    }
  }
  return { label: "Move (two at once for diagonals)", inputs };
}

function commandRow(bindings: Keybindings, command: Command): HelpRow {
  const binding = bindings[command];
  return {
    label: COMMAND_LABELS[command],
    inputs: [...binding.keys.map(keyLabel), ...(binding.buttons ?? []).map(buttonLabel)],
  };
}

function helpRow(): HelpRow {
  return { label: "Show / hide this reminder", inputs: HELP_KEYS.map(keyLabel) };
}

/** The address-bar knobs worth remembering, for the reminder's footer. */
export const URL_HINTS: readonly string[] = [
  "?time=21 — fix the hour",
  "?weather=storm — clear, rain or storm",
  "?day=300 — seconds in a day",
];
