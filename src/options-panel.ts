/**
 * The options panel: every knob in `knobs.ts` as a control, folded into the
 * top-right corner until it is opened.
 *
 * Like the controls reminder it is plain DOM over the canvas, never pixels in
 * the world. Each knob is read once at load, so a change reloads the page under
 * the new address - exactly what typing it would do - and the panel stays open
 * across that reload (per tab, in `sessionStorage`) so a run of changes does not
 * mean re-opening it each time.
 *
 * A game key pressed while one of its controls has focus is handed to the game
 * instead: the arrows would otherwise step a dropdown (and reload the page) and
 * Space would tick a box, rather than walk and swing.
 */

import { actionForKey, isHelpKey, isSkinKey } from "./game/keybindings";
import { hrefReset, hrefWith, KNOB_GROUPS, knobApplies, knobChecked, knobsFor, knobValue, type Knob } from "./knobs";
import type { SkinId } from "./skins/skin";

const OPEN_KEY = "options-panel-open";

/** Fold the panel into the corner of `host`, for the knobs `skin` reads. */
export function attachOptionsPanel(host: HTMLElement, skin: SkinId, location: Location): HTMLElement {
  const doc = host.ownerDocument;
  const query = new URLSearchParams(location.search);
  const go = (href: string): void => {
    if (href !== location.href) {
      location.assign(href);
    }
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
    fieldset.append(legend, ...members.map((knob) => knobRow(doc, knob, query, (value) => go(hrefWith(location.href, knob, value)))));
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
