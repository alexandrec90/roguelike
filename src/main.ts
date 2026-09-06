import Phaser from "phaser";

import "./style.css";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";
import { parseSkyFraction } from "./game/horizon";
import { coverOffset, integerCoverScale } from "./game/integer-scale";
import { visibleHeight } from "./game/viewport";

// The 95/5 horizon split is a framing decision, so it is retunable without a
// rebuild: `?horizon=0.08` or `?horizon=8%`. An unreadable value falls back to
// the default rather than blanking the game.
const skyFraction = parseSkyFraction(
  new URLSearchParams(window.location.search).get("horizon"),
);

// Held rather than built inline: the layout below has to tell it how much of
// the render target survived the window's crop.
const scene = new DemoScene(skyFraction);

/**
 * The one place the renderer's context is decided.
 *
 * Phaser 4.2 asks for `'webgl'` and would give us a WebGL1 context, where the
 * scenery shader cannot run at all: GLSL ES 1.00 has no unsigned integers and
 * no bitwise operators, and `pixelHash` — the lattice every procedural body is
 * built on — is nothing but shifts, xors and a wrapping 32-bit multiply. The
 * usual float-hash substitute is a *different* lattice, which is a different
 * warp and a visibly different tree: an art fork wearing an optimisation's
 * clothes.
 *
 * Phaser does accept a context of our own (`game.config.context`), and it runs
 * on WebGL2 without complaint, so we make one and hand it over. Its own shaders
 * are GLSL ES 1.00 and compile there unchanged; ours are `#version 300 es` and
 * compile there too.
 *
 * A machine without WebGL2 gets `null` here, Phaser makes its own WebGL1
 * context as it always did, and `SceneryLayer` notices and falls back to the
 * CPU path — the same picture, more slowly.
 */
function webgl2Canvas(): { canvas: HTMLCanvasElement; context: WebGL2RenderingContext } | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  return context === null ? null : { canvas, context };
}

const webgl2 = webgl2Canvas();

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  ...(webgl2 === null
    ? {}
    : {
        canvas: webgl2.canvas,
        // Phaser publishes `context` as a CanvasRenderingContext2D, but its
        // WebGL renderer reads this very field as the GL context — see
        // "Did they provide their own context?" in WebGLRenderer#init. The
        // runtime is right and the type is wrong, so the cast is narrowed to
        // this one field rather than loosening the whole config.
        context: webgl2.context as unknown as CanvasRenderingContext2D,
      }),
  width: GAME_SIZE.width,
  height: GAME_SIZE.height,
  backgroundColor: "#1b2440",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  antialiasGL: false,
  scene,
  fps: {
    target: 60,
    smoothStep: true,
  },
  scale: {
    // NONE, not ENVELOP: Phaser may pick a fractional factor, while the cover
    // layout below keeps every logical pixel at a uniform whole-number size.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  render: {
    powerPreference: "low-power",
  },
});

/** Whole-number cover scale with centred sides and a horizon-pinned top edge. */
function coverCanvas(): void {
  const host = game.canvas.parentElement;
  if (host === null) {
    return;
  }

  const { factor, width } = integerCoverScale(
    host.clientWidth,
    host.clientHeight,
    GAME_SIZE.width,
    GAME_SIZE.height,
  );
  const { left, top } = coverOffset(host.clientWidth, width);

  game.canvas.style.width = `${GAME_SIZE.width * factor}px`;
  game.canvas.style.height = `${GAME_SIZE.height * factor}px`;
  game.canvas.style.left = `${left}px`;
  game.canvas.style.top = `${top}px`;

  // The top edge is pinned, so a short window clips the *near* rows — the ones
  // the hero would otherwise be standing on. Tell the scene how much playfield
  // is left and it re-centres him in it.
  scene.setVisibleHeight(visibleHeight(host.clientHeight, factor, GAME_SIZE.height));
}

window.addEventListener("resize", coverCanvas);
game.events.once(Phaser.Core.Events.READY, coverCanvas);

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
