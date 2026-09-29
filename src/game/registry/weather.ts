/**
 * Asset-lab entries: Rain, splashes, puddles and what they reflect.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 */

import { AUTHORED, type AssetEntry, type PaletteVariant } from "../asset-types";
import { INK_TOKENS, type InkId } from "../ink";
import type { PixelSpriteSource } from "../pixel-art";
import { sampleBoltFrames, sampleRainFrames, sampleSplashFrames, sampleWaterScene } from "../water/lab";

/**
 * A palette swap on `ink` — or, if some frame never uses that ink, on the
 * first token every frame shares — so a variant can never target a token the
 * art does not have (`validateRegistry` would reject it).
 */
function swap(frames: readonly PixelSpriteSource[], ink: InkId, id: string, label: string, hex: string): PaletteVariant {
  const inEvery = (token: string): boolean => frames.every((frame) => token in frame.palette);
  const wanted = INK_TOKENS[ink];
  const first = frames[0];
  const token = inEvery(wanted)
    ? wanted
    : Object.keys(first?.palette ?? {}).find((candidate) => candidate !== "." && inEvery(candidate));
  return { id, label, overrides: token === undefined ? {} : { [token]: hex } };
}

function puddleAt(id: string, label: string, hours: number): AssetEntry {
  const frames = sampleWaterScene(hours, 8);
  return {
    id,
    label,
    category: "prop",
    frames,
    frameDurationMs: 400,
    notes:
      "A seeded puddle in a patch of field, the hero at its far edge. The body mirrors the sky " +
      "(horizon colour at the back, overhead at the front) dithered between real inks, so it " +
      "follows the time of day; the far lip is dark, the front edge sheer, the ground round it damp.",
    variants: [AUTHORED, swap(frames, "water", "tar", "Tar edge", "#1a0f18")],
  };
}

const RAIN = sampleRainFrames(10);
const SPLASH = sampleSplashFrames(6);
const BOLT = sampleBoltFrames(6);

export const WEATHER_ASSETS: readonly AssetEntry[] = [
  puddleAt("puddle-dawn", "Puddle — dawn", 6.2),
  puddleAt("puddle-noon", "Puddle — noon", 13),
  puddleAt("puddle-dusk", "Puddle — dusk", 18.6),
  puddleAt("puddle-night", "Puddle — night", 23),
  {
    id: "rain-sheets",
    label: "Rain — three sheets",
    category: "effect",
    frames: RAIN,
    frameDurationMs: 64,
    notes:
      "Far, mid and near drops, each landing on its own band of field and throwing a splash " +
      "there. The game draws each sheet at its own opacity; the lab shows them at full strength.",
    variants: [AUTHORED, swap(RAIN, "frost-3", "acid", "Acid rain", "#9cf06a")],
  },
  {
    id: "rain-splash",
    label: "Rain — splash crown",
    category: "effect",
    frames: SPLASH,
    frameDurationMs: 40,
    notes: "A near drop's crown on grass: pooled particles thrown up and pulled back, dithered away.",
    variants: [AUTHORED, swap(SPLASH, "grass-2", "mud", "On mud", "#4d3825")],
  },
  {
    id: "lightning",
    label: "Lightning — strike",
    category: "effect",
    frames: BOLT,
    frameDurationMs: 50,
    notes: "White core, violet glow, seeded branches. The core holds while the glow fades.",
    variants: [AUTHORED, swap(BOLT, "arcane-4", "fire", "Fire bolt", "#ffb445")],
  },
];
