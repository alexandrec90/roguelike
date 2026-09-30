/**
 * The controls reminder: what every key does, one keypress away.
 *
 * Like the debug map it is plain DOM stacked over the canvas, not pixels in the
 * 320x180 target — it is a note held up against the game, not part of the
 * world, so it is set in readable type at the window's own resolution and the
 * world stays exactly what it was.
 *
 * On load a small hint names the key and then fades, so a player who has
 * forgotten learns where to look without the reminder ever standing in front
 * of the game uninvited. The rows come from `controls-help.ts`, which reads the
 * binding table — rebind an action in `keybindings.ts` and this follows.
 */

import { helpRows, keyLabel, URL_HINTS, type HelpRow } from "./controls-help";
import { HELP_KEYS, isHelpKey } from "./keybindings";

/** How long the load-time hint stays before it fades, ms. */
const HINT_MS = 7000;

export class HelpOverlay {
  private readonly panel: HTMLElement;
  private readonly hint: HTMLElement;

  private constructor(host: HTMLElement) {
    const doc = host.ownerDocument;
    this.hint = doc.createElement("div");
    this.hint.className = "help-hint";
    this.hint.textContent = `Press ${keyLabel(HELP_KEYS[0] ?? "KeyH")} for controls`;
    this.panel = buildPanel(doc, helpRows());
    this.panel.hidden = true;
    host.append(this.hint, this.panel);
  }

  /** Stack the reminder over the game and start listening for its keys. */
  static attach(host: HTMLElement): HelpOverlay {
    const overlay = new HelpOverlay(host);
    const view = host.ownerDocument.defaultView;
    view?.addEventListener("keydown", (event) => overlay.onKey(event));
    overlay.panel.addEventListener("click", () => overlay.setOpen(false));
    view?.setTimeout(() => overlay.hint.classList.add("help-hint--faded"), HINT_MS);
    return overlay;
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    if (open) {
      this.hint.classList.add("help-hint--faded");
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (isHelpKey(event.code)) {
      // F1 opens the browser's own help and Slash its quick-find; neither is
      // what a player pressing them here means.
      event.preventDefault();
      if (!event.repeat) {
        this.setOpen(!this.open);
      }
    } else if (event.code === "Escape" && this.open) {
      this.setOpen(false);
    }
  }
}

function buildPanel(doc: Document, rows: readonly HelpRow[]): HTMLElement {
  const panel = doc.createElement("section");
  panel.className = "help-panel";
  panel.setAttribute("aria-label", "Controls");

  const title = doc.createElement("h2");
  title.textContent = "Controls";
  panel.append(title);

  const table = doc.createElement("dl");
  for (const row of rows) {
    const inputs = doc.createElement("dt");
    row.inputs.forEach((input, index) => {
      if (index > 0) {
        inputs.append(doc.createTextNode(" or "));
      }
      const kbd = doc.createElement("kbd");
      kbd.textContent = input;
      inputs.append(kbd);
    });
    const label = doc.createElement("dd");
    label.textContent = row.label;
    table.append(inputs, label);
  }
  panel.append(table);

  const footer = doc.createElement("p");
  footer.className = "help-panel__hints";
  footer.textContent = `In the address bar: ${URL_HINTS.join(" · ")}`;
  panel.append(footer);
  return panel;
}
