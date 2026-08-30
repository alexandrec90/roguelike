import Phaser from "phaser";

import "./style.css";
import { DemoScene, GAME_SIZE } from "./game/demo-scene";

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
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    powerPreference: "low-power",
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
