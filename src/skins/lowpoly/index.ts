/**
 * The low-poly skin: the same planet and the same hero, as flat-shaded 3D
 * geometry at the window's own resolution.
 *
 * What it keeps from the pixel skin is the identity, exactly: the pitched-back
 * local view (`placement.ts`) and the treadmill-lip horizon, from the same
 * curve. What it drops is the pixel contract - no 320×180 target, no closed ink
 * set, no dither - because a skin owns its look.
 *
 * | Module | Owns |
 * | --- | --- |
 * | `placement.ts` | the projection: local view plus lip, with a depth key; the CPU twin of the vertex shader |
 * | `shaders.ts` | the GLSL: placement, flat light, haze; and the sky |
 * | `renderer.ts` | the WebGL2 context: buffers, passes, uniforms |
 * | `lowpoly-game.ts` | a frame: step the shared simulation, build the actors, draw |
 * | `world-chunks.ts` | the planet as 64 static chunks, drawn at their nearest image round the wrap |
 * | `terrain-mesh.ts`, `scenery-mesh.ts` | ground, lakes, landforms; each scenery species |
 * | `hero-mesh.ts`, `actor-mesh.ts` | the rigged hero; slimes, fireballs, bursts |
 * | `mesh.ts`, `primitives.ts`, `palette.ts` | flat-shaded triangles, the solids, the skin's colours |
 */

import { FrameClock } from "../../engine/loop";
import { aimAt, pressButton, pressKey, releaseAll, releaseButton, releaseKey } from "../../game/controls";
import { HelpOverlay } from "../../game/help-overlay";
import { mouseButtonOf } from "../../game/keybindings";
import { readSceneOptions } from "../../game/scene-options";
import { puddleField } from "../../game/water/puddle-field";
import { backendOrder, parseGpu, parseMsaa, type GpuChoice, type LowpolyBackend } from "./backend";
import { LowpolyGame } from "./lowpoly-game";
import { backingSize } from "./placement";
import { WebGlBackend } from "./renderer";
import { WebGpuBackend } from "./webgpu/webgpu-renderer";


export function mount(host: HTMLElement, query: URLSearchParams): void {
  const choice = { gpu: parseGpu(query.get("gpu")), samples: parseMsaa(query.get("msaa")) };
  void createBackend(host, choice).then(({ canvas, backend }) => start(host, canvas, backend, query));
}

/** A full-window canvas for the skin. */
function makeCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.imageRendering = "auto";
  host.appendChild(canvas);
  return canvas;
}

/**
 * The first backend that works, in `backendOrder`. Each try gets a fresh canvas:
 * a canvas keeps the first kind of context it was asked for, so one that
 * WebGPU refused cannot become a WebGL2 canvas.
 */
async function createBackend(
  host: HTMLElement,
  choice: { gpu: GpuChoice; samples: number },
): Promise<{ canvas: HTMLCanvasElement; backend: LowpolyBackend }> {
  const reasons: string[] = [];
  for (const kind of backendOrder(choice.gpu, "gpu" in navigator)) {
    const canvas = makeCanvas(host);
    try {
      const backend =
        kind === "webgpu" ? await WebGpuBackend.create(canvas, puddleField(), choice.samples) : webglBackend(canvas, choice.samples);
      console.info(`Low-poly skin: drawing with ${kind}${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`);
      return { canvas, backend };
    } catch (error) {
      canvas.remove();
      reasons.push(`${kind} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`The low-poly skin has no way to draw: ${reasons.join("; ")}`);
}

function webglBackend(canvas: HTMLCanvasElement, samples: number): LowpolyBackend {
  const gl = canvas.getContext("webgl2", { antialias: samples > 1, alpha: false, depth: true, powerPreference: "low-power" });
  if (gl === null) {
    throw new Error("no WebGL2 context");
  }
  return new WebGlBackend(gl, puddleField());
}

function start(host: HTMLElement, canvas: HTMLCanvasElement, backend: LowpolyBackend, query: URLSearchParams): void {
  const game = new LowpolyGame(backend, readSceneOptions(query));

  const fit = (): void => {
    const size = backingSize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    canvas.width = size.width;
    canvas.height = size.height;
    game.resize(host.clientWidth / Math.max(host.clientHeight, 1));
  };
  fit();
  window.addEventListener("resize", fit);
  bindInput(canvas, game);
  HelpOverlay.attach(host);

  const clock = new FrameClock();
  document.addEventListener("visibilitychange", () => clock.reset());
  const frame = (now: number): void => {
    const delta = clock.tick(now);
    if (game.ready()) {
      game.step(delta);
      game.draw(canvas.width, canvas.height);
    } else {
      game.build();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // A handle for a browser-driving agent in a dev build; never shipped.
  if (import.meta.env.DEV) {
    (window as unknown as { __lowpoly: LowpolyGame }).__lowpoly = game;
  }
}

/**
 * Keys and the mouse into the shared control state - the same translation the
 * pixel skin's hero layer does, against this skin's logical view.
 */
function bindInput(canvas: HTMLCanvasElement, game: LowpolyGame): void {
  const controls = game.hero.controls;
  window.addEventListener("keydown", (event) => {
    if (pressKey(controls, event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (releaseKey(controls, event.code)) {
      event.preventDefault();
    }
  });
  // Aim from his chest, in the logical pixels the projection is written in.
  const aim = (event: MouseEvent): void => {
    const box = canvas.getBoundingClientRect();
    const view = game.view;
    const x = ((event.clientX - box.left) / box.width) * view.width;
    const y = ((event.clientY - box.top) / box.height) * view.height;
    aimAt(controls, x - view.footX, y - (view.footY - game.heroHeight / 2));
  };
  window.addEventListener("pointermove", aim);
  canvas.addEventListener("pointerdown", (event) => {
    aim(event);
    pressButton(controls, mouseButtonOf(event.button));
  });
  window.addEventListener("pointerup", (event) => releaseButton(controls, mouseButtonOf(event.button)));
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("blur", () => releaseAll(controls));
}
