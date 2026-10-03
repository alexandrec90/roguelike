import "./style.css";
import { Game } from "./engine";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";
import { readSceneOptions } from "./game/scene-options";
import { coverOffset, integerCoverScale } from "./game/integer-scale";
import { HelpOverlay } from "./game/help-overlay";
import { MapOverlay, wantsMap } from "./game/map-overlay";
import { visibleHeight } from "./game/viewport";

// Every knob the address bar can turn — the sky split, the strafe radius, the
// time of day and the weather — is read in `scene-options.ts`. An unreadable
// value falls back rather than blanking the game.
const query = new URLSearchParams(window.location.search);
// `?map=1` stacks the debug instrument over the canvas. Off on every other
// load, because the page is the game world and nothing else unless asked.
const showMap = wantsMap(query.get("map"));

// Held rather than built inline: the layout below has to tell it how much of
// the render target survived the window's crop.
const scene = new DemoScene(readSceneOptions(query));

const host = gameHost();

function gameHost(): HTMLElement {
  const element = document.getElementById("game");
  if (element === null) {
    throw new Error("The page has no #game element to draw into");
  }
  return element;
}

// WebGL2 or nothing: every per-pixel pass, and `pixelHash` itself, is GLSL ES
// 3.00 - shifts, xors and unsigned integers ES 1.00 does not have.
const game = new Game({
  parent: host,
  width: GAME_SIZE.width,
  height: GAME_SIZE.height,
  backgroundColor: "#1b2440",
  scene,
});

/** Whole-number cover scale with centred sides and a horizon-pinned top edge. */
function coverCanvas(): void {
  const { factor, width } = integerCoverScale(host.clientWidth, host.clientHeight, GAME_SIZE.width, GAME_SIZE.height);
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
game.once("ready", () => {
  coverCanvas();
  scene.setMap(MapOverlay.attach(host, showMap));
  HelpOverlay.attach(host);
});

// `?bench=1` walks the fixed route and reports what each layer cost; `&sync=1`
// drains the GPU every frame so its time is counted too.
if (query.get("bench") === "1") {
  void import("./game/bench-runner").then(({ runBench }) =>
    runBench(
      {
        scene,
        gl: game.gl,
        onFrame: (start, end) => {
          game.on("prestep", start);
          game.on("postrender", end);
        },
      },
      { sync: query.get("sync") === "1" },
    ),
  );
}

// A handle for a browser-driving agent profiling the dev build; never shipped.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game; __scene: DemoScene }).__game = game;
  (window as unknown as { __game: Game; __scene: DemoScene }).__scene = scene;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy());
}
