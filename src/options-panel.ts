/**
 * The options panel: every knob in `knobs.ts` as a control, folded into the
 * top-right corner until it is opened.
 *
 * Like the controls reminder it is plain DOM over the canvas, never pixels in
 * the world. Most knobs are read once at load, so a change reloads the page
 * under the new address - exactly what typing it would do - and the panel stays
 * open across that reload (per tab, in `sessionStorage`) so a run of changes
 * does not mean re-opening it each time. The effect switches are the
 * exception: they flip the running game at once, and only rewrite the address.
 *
 * A game key pressed while one of its controls has focus is handed to the game
 * instead: the arrows would otherwise step a dropdown (and reload the page) and
 * Space would tick a box, rather than walk and swing.
 */

import { formatEffectsOff, type EffectSwitches } from "./game/effects";
import { actionForKey, isHelpKey, isSkinKey } from "./game/keybindings";
import { hrefReset, hrefWith, KNOB_GROUPS, knobApplies, knobChecked, knobsFor, knobValue, switchesFor, type Knob } from "./knobs";
import type { SkinId } from "./skins/skin";

const OPEN_KEY = "options-panel-open";

/**
 * Fold the panel into the corner of `host`, for the knobs `skin` reads.
 * `effects` is the page's live set of switches, shared with the skin.
 */
export function attachOptionsPanel(host: HTMLElement, skin: SkinId, location: Location, effects: EffectSwitches): HTMLElement {
  const doc = host.ownerDocument;
  const query = new URLSearchParams(location.search);
  const go = (href: string): void => {
    if (href !== location.href) {
      location.assign(href);
    }
  };
  // The address follows a live switch without a reload; anything else reloads under it.
  const remember = (knob: Knob) => (): void => {
    const history = doc.defaultView?.history;
    history?.replaceState(history.state, "", hrefWith(location.href, knob, formatEffectsOff(effects.off)));
  };

  const panel = doc.createElement("details");
  panel.className = "options-panel";
  panel.open = readOpen();
  panel.addEventListener("toggle", () => writeOpen(panel.open));
  panel.addEventListener("keydown", (event) => {
    if (actionForKey(event.code) !== undefined || isHelpKey(event.code) || isSkinKey(event.code)) {
      event.preventDefault();
      (doc.activeElement as HTMLElement | null)?.blur();
    }
  });

  const summary = doc.createElement("summary");
  summary.textContent = "Options";
  panel.append(summary);

  const knobs = knobsFor(skin);
  for (const group of KNOB_GROUPS) {
    const members = knobs.filter((knob) => knob.group === group);
    if (members.length === 0) {
      continue;
    }
    const fieldset = doc.createElement("fieldset");
    const legend = doc.createElement("legend");
    legend.textContent = group;
    fieldset.append(legend);
    for (const knob of members) {
      const change = (value: string): void => go(hrefWith(location.href, knob, value));
      fieldset.append(
        ...(knob.control.kind === "switches" ? switchRows(doc, knob, skin, effects, remember(knob)) : [knobRow(doc, knob, query, change)]),
      );
    }
    panel.append(fieldset);
  }

  const reset = doc.createElement("button");
  reset.type = "button";
  reset.className = "options-panel__reset";
  reset.textContent = "Reset all";
  reset.addEventListener("click", () => go(hrefReset(location.href)));
  panel.append(reset);

  host.append(panel);
  return panel;
}

/**
 * A checkbox per switch the skin draws, and a pair of buttons that turn them
 * all on or all off - the bare world, for a baseline to add effects back to.
 *
 * These take effect at once: each flips `effects` in place, which the skin
 * reads every frame, and `remember` writes the new list into the address
 * without reloading, so a reload or a copied link opens the same way.
 */
function switchRows(doc: Document, knob: Knob, skin: SkinId, effects: EffectSwitches, remember: () => void): HTMLElement[] {
  const switches = switchesFor(knob, skin);
  const boxes = switches.map((option) => {
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.checked = effects.on(option.value);
    box.addEventListener("change", () => {
      effects.set(option.value, box.checked);
      remember();
    });
    return box;
  });
  const rows = switches.map((option, index) => {
    const row = doc.createElement("label");
    row.className = "options-panel__row";
    row.title = option.what;
    const name = doc.createElement("span");
    name.textContent = option.label;
    row.append(name, boxes[index]!);
    return row;
  });
  const all = doc.createElement("div");
  all.className = "options-panel__all";
  for (const [label, on] of [["All on", true], ["All off", false]] as const) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      switches.forEach((option, index) => {
        effects.set(option.value, on);
        boxes[index]!.checked = on;
      });
      remember();
    });
    all.append(button);
  }
  return [...rows, all];
}

function knobRow(doc: Document, knob: Knob, query: URLSearchParams, change: (value: string) => void): HTMLElement {
  const row = doc.createElement("label");
  row.className = "options-panel__row";
  if (!knobApplies(knob, query)) {
    row.classList.add("options-panel__row--idle");
  }
  const name = doc.createElement("span");
  name.textContent = knob.label;

  const control = knob.control;
  if (control.kind === "toggle") {
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.checked = knobChecked(knob, query);
    box.addEventListener("change", () => change(box.checked ? control.checked : control.unchecked));
    row.append(name, box);
    return row;
  }

  if (control.kind === "switches") {
    throw new Error(`Knob ${knob.key} is a set of switches, drawn by switchRows`);
  }
  const select = doc.createElement("select");
  const current = knobValue(knob, query);
  const options = control.options.some((option) => option.value === current)
    ? control.options
    : [...control.options, { value: current, label: current }];
  for (const option of options) {
    const element = doc.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === current;
    select.append(element);
  }
  select.addEventListener("change", () => change(select.value));
  row.append(name, select);
  return row;
}

function readOpen(): boolean {
  return sessionStore()?.getItem(OPEN_KEY) === "1";
}

function writeOpen(open: boolean): void {
  sessionStore()?.setItem(OPEN_KEY, open ? "1" : "0");
}

/** The tab's storage, or none where reading it throws (blocked site data): the panel then starts folded. */
function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
