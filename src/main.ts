import Phaser from "phaser";

import "./style.css";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";
import { integerScale, letterbox } from "./game/integer-scale";

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  width: GAME_SIZE.width,
  height: GAME_SIZE.height,
  backgroundColor: "#08090c",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  antialiasGL: false,
  scene: DemoScene,
  fps: {
    target: 60,
    smoothStep: true,
  },
  scale: {
    // NONE, not FIT: `FIT` picks a fractional factor, and a 320x180 grid drawn
    // at 3.47x is resampled — every one-pixel highlight lands on a seam. The
    // canvas keeps its logical size and we scale it by a whole number below.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  render: {
    powerPreference: "low-power",
  },
});

/** Largest whole upscale that fits the frame, centred on integer pixels. */
function fitCanvas(): void {
  const host = game.canvas.parentElement;
  if (host === null) {
    return;
  }

  const { factor, width, height } = integerScale(
    host.clientWidth,
    host.clientHeight,
    GAME_SIZE.width,
    GAME_SIZE.height,
  );
  const { left, top } = letterbox(host.clientWidth, host.clientHeight, width, height);

  game.canvas.style.width = `${GAME_SIZE.width * factor}px`;
  game.canvas.style.height = `${GAME_SIZE.height * factor}px`;
  game.canvas.style.left = `${left}px`;
  game.canvas.style.top = `${top}px`;
}

window.addEventListener("resize", fitCanvas);
game.events.once(Phaser.Core.Events.READY, fitCanvas);

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
