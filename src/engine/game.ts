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
 *
 * Unless a scene sets a `Backdrop`. Then the world is drawn into a 320×180
 * target of its own, cleared to transparent, and *presented*: the canvas is
 * `presentScale` device pixels to a logical one, the backdrop is drawn across it
 * at that resolution, and the world is laid over it, scaled up by the same whole
 * number with nearest sampling - so every world pixel is the block it always
 * was, and only what shows through where nothing was drawn is finer.
 */

import { Batcher, type DrawTarget } from "./batcher";
import { Camera } from "./camera";
import { DEFAULT_TEXTURE, DisplayList, WHITE_TEXTURE, type RenderContext, type Stage } from "./display";
import { Input } from "./input";
import { FrameClock } from "./loop";
import type { Scene } from "./scene";
import { TextureStore, type Texture } from "./texture";

/** Where a backdrop is drawn: the whole canvas, in device pixels. */
export interface BackdropView {
  readonly width: number;
  readonly height: number;
  /** Device pixels to one logical pixel: a whole number. */
  readonly scale: number;
  /** The camera's scroll, in logical pixels: the world is drawn offset by it. */
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * What is drawn behind the world at the canvas's own resolution. Drawn first,
 * over a cleared canvas; the world covers it wherever the world drew anything.
 */
export interface Backdrop {
  render(view: BackdropView): void;
}

const WORLD_TEXTURE = "__WORLD";

/** The canvas's device pixels to a logical one: a whole number, and 1 with no backdrop to show finer. */
export function backingScale(scale: number, presenting: boolean): number {
  return presenting && Number.isFinite(scale) ? Math.max(1, Math.round(scale)) : 1;
}

/** The world's own target, and laying it over the backdrop at a whole scale. */
class Presenter {
  readonly target: DrawTarget;
  private readonly texture: Texture;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    textures: TextureStore,
    width: number,
    height: number,
  ) {
    this.texture = textures.addTarget(WORLD_TEXTURE, width, height);
    const framebuffer = gl.createFramebuffer();
    if (framebuffer === null) {
      throw new Error("Could not create the world's framebuffer");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture.glTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { framebuffer, width, height };
  }

  /** Clear the world's target to transparent, so the backdrop shows wherever nothing is drawn. */
  begin(batcher: Batcher): void {
    const gl = this.gl;
    batcher.begin(this.target);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.viewport(0, 0, this.target.width, this.target.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Clear the canvas, draw the backdrop, then the world over it; leaves the batch drawing to the canvas. */
  present(batcher: Batcher, canvas: HTMLCanvasElement, background: number, backdrop: Backdrop, view: BackdropView): void {
    const gl = this.gl;
    batcher.flush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(((background >> 16) & 0xff) / 255, ((background >> 8) & 0xff) / 255, (background & 0xff) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    backdrop.render(view);
    batcher.begin({ framebuffer: null, width: canvas.width, height: canvas.height });
    const { width, height } = this.target;
    batcher.draw(
      this.texture,
      { left: 0, top: 0, right: width * view.scale, bottom: height * view.scale, u0: 0, v0: 0, u1: width, v1: height },
      0xffffff,
      1,
      "normal",
    );
  }
}

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
  private backdrop: Backdrop | undefined;
  private presenter: Presenter | undefined;
  private presentScale = 1;
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

  /**
   * Draw behind the world at the canvas's own resolution from now on. The world
   * moves into a target of its own and is presented over it (the header).
   */
  setBackdrop(backdrop: Backdrop): void {
    this.backdrop = backdrop;
    this.presenter ??= new Presenter(this.gl, this.textures, this.width, this.height);
  }

  /**
   * Device pixels to a logical one, a whole number: the canvas's backing store
   * is resized to match. Only a backdrop has anything finer to show, so without
   * one the canvas stays at its logical size and CSS does the scaling.
   */
  setPresentScale(scale: number): void {
    const whole = backingScale(scale, this.backdrop !== undefined);
    if (whole === this.presentScale) {
      return;
    }
    this.presentScale = whole;
    this.canvas.width = this.width * whole;
    this.canvas.height = this.height * whole;
  }

  /** Draw the display list, back to front, then the fade over it. */
  render(): void {
    const gl = this.gl;
    const camera = this.camera;
    const presenter = this.backdrop === undefined ? undefined : this.presenter;
    if (presenter === undefined) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      const bg = camera.backgroundColor;
      gl.clearColor(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.batcher.begin({ framebuffer: null, width: this.width, height: this.height });
    } else {
      presenter.begin(this.batcher);
    }
    const ctx: RenderContext = {
      batcher: this.batcher,
      textures: this.textures,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    };
    for (const object of this.list.sorted()) {
      if (object.visible) {
        object.render(ctx);
      }
    }
    const scale = presenter === undefined ? 1 : this.presentScale;
    if (presenter !== undefined && this.backdrop !== undefined) {
      presenter.present(this.batcher, this.canvas, camera.backgroundColor, this.backdrop, {
        width: this.canvas.width,
        height: this.canvas.height,
        scale,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
      });
    }
    const black = camera.fadeAmount();
    if (black > 0) {
      const white = this.textures.get(WHITE_TEXTURE);
      this.batcher.draw(
        white,
        { left: 0, top: 0, right: this.width * scale, bottom: this.height * scale, u0: 0, v0: 0, u1: 1, v1: 1 },
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
