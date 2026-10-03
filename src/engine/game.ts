/**
 * The game: a WebGL2 canvas, one scene, and the loop that updates then draws it.
 *
 * This replaced Phaser, which the game had come to use as a texture store and
 * a sprite batcher and little else: every per-pixel pass, every surface upload
 * and all of the input was already the game's own code reaching round it. What
 * is left is small enough to read in one sitting - which, for a codebase an
 * agent maintains, is the point.
 *
 * The canvas is the render target at its logical size (320×180); `main.ts`
 * scales it up by CSS at a whole factor with `image-rendering: pixelated`, so
 * nothing here knows the window's size.
 */

import { Batcher } from "./batcher";
import { Camera } from "./camera";
import { DEFAULT_TEXTURE, DisplayList, WHITE_TEXTURE, type RenderContext, type Stage } from "./display";
import { Input } from "./input";
import { FrameClock } from "./loop";
import type { Scene } from "./scene";
import { TextureStore } from "./texture";

export type GameEvent = "ready" | "prestep" | "postrender" | "blur";

export interface GameConfig {
  /** The element the canvas is appended to. */
  readonly parent: HTMLElement;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly scene: Scene;
  /** Keep the last frame readable after it is shown - the asset lab's snapshots need it. */
  readonly preserveDrawingBuffer?: boolean;
}

/** A WebGL2 context on a fresh canvas, or null where the browser has none. */
export function createContext(preserveDrawingBuffer = false): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer,
    // The integrated GPU where a laptop has two: the target the frame budget is
    // held to (`.claude/rules/rendering.md`), so what is measured is what ships.
    powerPreference: "low-power",
  });
  return gl === null ? null : { canvas, gl };
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly textures: TextureStore;
  readonly batcher: Batcher;
  readonly input: Input;
  readonly camera = new Camera();
  readonly width: number;
  readonly height: number;
  /** True once the scene is built - before that there is nothing to step. */
  isBooted = false;
  private readonly list = new DisplayList();
  private readonly clock = new FrameClock();
  private readonly listeners = new Map<GameEvent, (() => void)[]>();
  private readonly scene: Scene;
  private frame = 0;
  private running = true;
  private readonly onBlur = () => this.emit("blur");
  private readonly onVisibility = () => {
    if (document.visibilityState === "visible") {
      this.clock.reset();
    }
  };

  constructor(config: GameConfig) {
    const context = createContext(config.preserveDrawingBuffer);
    if (context === null) {
      throw new Error("This game needs WebGL2, and this browser has none.");
    }
    this.canvas = context.canvas;
    this.gl = context.gl;
    this.width = config.width;
    this.height = config.height;
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    config.parent.appendChild(this.canvas);

    this.textures = new TextureStore(this.gl);
    this.textures.addBytes(WHITE_TEXTURE, new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.textures.addBytes(DEFAULT_TEXTURE, new Uint8Array(32 * 32 * 4), 32, 32);
    this.batcher = new Batcher(this.gl);
    this.input = new Input(this.canvas);
    this.camera.setBackgroundColor(config.backgroundColor);

    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.scene = config.scene;
    const stage: Stage = { textures: this.textures, list: this.list, batcher: this.batcher };
    this.scene.boot(this, stage);
    this.scene.create();
    // Next tick, so a caller can subscribe to `ready` after constructing.
    queueMicrotask(() => this.emit("ready"));
    this.isBooted = true;
    this.frame = requestAnimationFrame(this.loop);
  }

  on(event: GameEvent, handler: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  once(event: GameEvent, handler: () => void): void {
    const wrapped = () => {
      this.off(event, wrapped);
      handler();
    };
    this.on(event, wrapped);
  }

  off(event: GameEvent, handler: () => void): void {
    const list = this.listeners.get(event);
    if (list !== undefined) {
      const index = list.indexOf(handler);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }
  }

  private emit(event: GameEvent): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      handler();
    }
  }

  private readonly loop = (now: number): void => {
    if (!this.running) {
      return;
    }
    this.step(now, this.clock.tick(now));
    this.frame = requestAnimationFrame(this.loop);
  };

  /**
   * One frame by hand: update the scene at `time` by `delta`, then draw it.
   * The loop calls this every animation frame; the asset lab calls it with a
   * zero delta to draw what it just changed in a tab whose loop is frozen.
   */
  step(time: number, delta: number): void {
    this.camera.tick(time);
    this.emit("prestep");
    this.scene.update(time, delta);
    this.render();
    this.emit("postrender");
  }

  /**
   * The frame as it stands, as a PNG data URL. It draws first and reads in the
   * same task, so it works without `preserveDrawingBuffer` and in a hidden tab
   * whose loop is frozen - step the game by hand, then call this.
   */
  snapshot(): string {
    this.render();
    return this.canvas.toDataURL("image/png");
  }

  /** Draw the display list, back to front, then the fade over it. */
  render(): void {
    const gl = this.gl;
    const camera = this.camera;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const bg = camera.backgroundColor;
    gl.clearColor(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ctx: RenderContext = {
      batcher: this.batcher,
      textures: this.textures,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    };
    this.batcher.begin({ framebuffer: null, width: this.width, height: this.height });
    for (const object of this.list.sorted()) {
      if (object.visible) {
        object.render(ctx);
      }
    }
    const black = camera.fadeAmount();
    if (black > 0) {
      const white = this.textures.get(WHITE_TEXTURE);
      this.batcher.draw(
        white,
        { left: 0, top: 0, right: this.width, bottom: this.height, u0: 0, v0: 0, u1: 1, v1: 1 },
        0x000000,
        black,
        "normal",
      );
    }
    this.batcher.flush();
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.destroy();
    this.canvas.remove();
  }
}
