import Phaser from "phaser";

import "./style.css";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";
import { parseSkyFraction } from "./game/horizon";
import { centerCrop, integerCoverScale } from "./game/integer-scale";

// The 95/5 horizon split is a framing decision, so it is retunable without a
// rebuild: `?horizon=0.08` or `?horizon=8%`. An unreadable value falls back to
// the default rather than blanking the game.
const skyFraction = parseSkyFraction(
  new URLSearchParams(window.location.search).get("horizon"),
);

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
  scene: new DemoScene(skyFraction),
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

/** Whole-number cover scale, centred so the host clips excess canvas evenly. */
function coverCanvas(): void {
  const host = game.canvas.parentElement;
  if (host === null) {
    return;
  }

  const { factor, width, height } = integerCoverScale(
    host.clientWidth,
    host.clientHeight,
    GAME_SIZE.width,
    GAME_SIZE.height,
  );
  const { left, top } = centerCrop(host.clientWidth, host.clientHeight, width, height);

  game.canvas.style.width = `${GAME_SIZE.width * factor}px`;
  game.canvas.style.height = `${GAME_SIZE.height * factor}px`;
  game.canvas.style.left = `${left}px`;
  game.canvas.style.top = `${top}px`;
}

window.addEventListener("resize", coverCanvas);
game.events.once(Phaser.Core.Events.READY, coverCanvas);

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
