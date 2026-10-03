/**
 * Raw DOM input, handed on untranslated.
 *
 * What an input *means* is `keybindings.ts` and what is held is `controls.ts`;
 * this only listens. Keys are heard on `window`, so focus inside the page is
 * enough. A press must land on the canvas, while a move or a release is heard
 * anywhere - a drag that leaves the canvas still lets go.
 */

export type KeyEventKind = "keydown" | "keyup";
export type PointerEventKind = "pointermove" | "pointerdown" | "pointerup";

/** A pointer event as a layer sees it: which button, and the DOM event for its position. */
export interface Pointer {
  readonly button: number;
  readonly event: MouseEvent;
}

type Unlisten = () => void;

export class Keyboard {
  private readonly unlisten: Unlisten[] = [];

  on(kind: KeyEventKind, handler: (event: KeyboardEvent) => void): this {
    window.addEventListener(kind, handler);
    this.unlisten.push(() => window.removeEventListener(kind, handler));
    return this;
  }

  destroy(): void {
    this.unlisten.splice(0).forEach((stop) => stop());
  }
}

export class Input {
  readonly keyboard = new Keyboard();
  private readonly unlisten: Unlisten[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {}

  on(kind: PointerEventKind, handler: (pointer: Pointer) => void): this {
    const target: EventTarget = kind === "pointerdown" ? this.canvas : window;
    const listener = (event: Event) => handler({ button: (event as MouseEvent).button, event: event as MouseEvent });
    target.addEventListener(kind, listener);
    this.unlisten.push(() => target.removeEventListener(kind, listener));
    return this;
  }

  /** Right-click is a game input here, so the browser's menu is in the way. */
  disableContextMenu(): this {
    const block = (event: Event) => event.preventDefault();
    this.canvas.addEventListener("contextmenu", block);
    this.unlisten.push(() => this.canvas.removeEventListener("contextmenu", block));
    return this;
  }

  destroy(): void {
    this.keyboard.destroy();
    this.unlisten.splice(0).forEach((stop) => stop());
  }
}
