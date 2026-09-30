/**
 * Asset-lab entries: Slimes and whatever else walks the planet.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Every slime strip here is sampled from the running simulation
 * (`creatures/slime-frames.ts`) — nothing is drawn — so the lab's hop is the
 * game's hop, down to the droplets. The palette variants re-ink one material
 * family as another, which is also how a new colour of slime can be previewed
 * before it earns an entry in `slime-palette.ts`.
 */

import { AUTHORED, type AssetEntry } from "../asset-types";
import type { PixelSpriteSource } from "../pixel-art";
import type { Family } from "../palette";
import {
  emergeFrames,
  familySwap,
  hopFrames,
  idleFrames,
  strikeFrames,
} from "../creatures/slime-frames";

function slimeEntry(
  id: string,
  label: string,
  frames: readonly PixelSpriteSource[],
  frameDurationMs: number,
  family: Family,
  notes: string,
): AssetEntry {
  const swapTo: Family = family === "slime" ? "arcane" : "slime";
  return {
    id,
    label,
    category: "actor",
    frames,
    frameDurationMs,
    notes,
    variants: [AUTHORED, familySwap(frames, family, swapTo, `Re-inked as ${swapTo}`)],
  };
}

export const CREATURE_ASSETS: readonly AssetEntry[] = [
  slimeEntry(
    "slime-idle",
    "Slime — idle (volume)",
    idleFrames("green", 16, 110),
    110,
    "slime",
    "An SDF jelly lit per pixel: outline, nucleus, bounce light and a specular glint are all " +
      "conditions on one field sample. Breathing is a term on the squash; eyes glance and blink.",
  ),
  slimeEntry(
    "slime-hop",
    "Slime — hop (squash & stretch)",
    hopFrames("green", 32),
    32,
    "slime",
    "Windup squat, stretched take-off, a ballistic arc that leaves its shadow behind, a landing " +
      "slap and the spring's wobble after. Only the spring's target and two velocity kicks are authored.",
  ),
  slimeEntry(
    "slime-hurt",
    "Slime — hit (flash, knockback)",
    strikeFrames("green", false, 32, 640),
    32,
    "slime",
    "Run through the real sim with one steel Strike: pale flash, squint, knockback slide, goo.",
  ),
  slimeEntry(
    "slime-death",
    "Slime — death (melt, puddle)",
    strikeFrames("green", true, 64, 2300),
    64,
    "slime",
    "meltCloud — the transform that melts the hero — then the puddle dries away pixel by pixel.",
  ),
  slimeEntry(
    "slime-emerge",
    "Slime — respawn (melt reversed)",
    emergeFrames("green", 12, 60),
    60,
    "slime",
    "A restocked den: the death melt played backwards, so a new slime rises out of its own puddle.",
  ),
  slimeEntry("slime-fire", "Fire slime — hop", hopFrames("fire", 48), 48, "fire",
    "The fire ramp, opaque, with a white-hot nucleus. It glows in game (a LightSource)."),
  slimeEntry("slime-frost", "Frost slime — hop", hopFrames("frost", 48), 48, "frost",
    "The frost ramp. Immune to frost, takes double from fire."),
  slimeEntry("slime-arcane", "Arcane slime — hop", hopFrames("arcane", 48), 48, "arcane",
    "The arcane ramp with a bright nucleus; it glows faintly in game."),
];
