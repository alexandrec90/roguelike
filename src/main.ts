import Phaser from "phaser";

import "./style.css";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";
import { parseSkyFraction } from "./game/horizon";
import { parseStrafeRadius } from "./game/planet";
import { coverOffset, integerCoverScale } from "./game/integer-scale";
import { visibleHeight } from "./game/viewport";

// Two framing decisions, both retunable without a rebuild. `?horizon=0.08` (or
// `?horizon=8%`) moves the 95/5 sky split; `?radius=64` widens the circle a
// sideways walk runs around, which is what sets how hard the world turns under
// a strafe. An unreadable value falls back rather than blanking the game.
const query = new URLSearchParams(window.location.search);
const skyFraction = parseSkyFraction(query.get("horizon"));
const strafeRadius = parseStrafeRadius(query.get("radius"));

// Held rather than built inline: the layout below has to tell it how much of
// the render target survived the window's crop.
const scene = new DemoScene(skyFraction, strafeRadius);

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
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
