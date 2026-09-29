/**
 * Asset-lab entries: Campfire, flames, spells and their impacts.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Every entry is a filmstrip *sampled* from the same simulation the game steps
 * — the flame automaton, the campfire, the fireball, the explosion, the decals
 * — at fixed deltas from a fixed seed, so a capture reproduces byte for byte
 * and what the lab shows is what the scene draws. Nothing here is drawn.
 */

import { AUTHORED, type AssetEntry, type PaletteVariant } from "../asset-types";
import { cloudToSprite, inkHex, INK_TOKENS, type CloudFrame, type InkId, type PixelCloud } from "../ink";
import type { PixelSpriteSource } from "../pixel-art";
import { campfireCloud, campfireGround, createCampfire, stepCampfire } from "../fire/campfire";
import { createDecal, decalCloud, type DecalKind } from "../fire/decals";
import { createExplosion, explosionCloud, stepExplosion } from "../fire/explosion";
import { fireballCloud, flyFireball, launchFireball } from "../fire/fireball";
import { createFlame, flameCloud, settleFlame, stepFlame, type FlameSpec } from "../fire/flame";
import { createFrostNova, frostNovaCloud, stepFrostNova } from "../fire/frost-nova";

const STEP_MS = 16;

function frames(clouds: readonly PixelCloud[], frame: CloudFrame): PixelSpriteSource[] {
  return clouds.map((cloud) => cloudToSprite(cloud, frame));
}

/**
 * A palette swap built from an ink map, keeping only the tokens every frame
 * uses — a swap aimed at a token some frames lack is a registry error, and a
 * flame's white core is not in every frame of it.
 */
export function inkSwap(
  id: string,
  label: string,
  sprites: readonly PixelSpriteSource[],
  map: Partial<Record<InkId, InkId>>,
): PaletteVariant {
  const overrides: Record<string, string> = {};
  for (const [from, to] of Object.entries(map) as [InkId, InkId][]) {
    const token = INK_TOKENS[from];
    if (sprites.every((sprite) => token in sprite.palette)) {
      overrides[token] = inkHex(to);
    }
  }
  return { id, label, overrides };
}

const ARCANE_FIRE: Partial<Record<InkId, InkId>> = {
  "fire-1": "arcane-0",
  "fire-2": "arcane-1",
  "fire-3": "arcane-2",
  "fire-4": "arcane-3",
  "fire-5": "arcane-3",
  "fire-6": "arcane-4",
};

const FROST_FIRE: Partial<Record<InkId, InkId>> = {
  "fire-1": "frost-0",
  "fire-2": "frost-1",
  "fire-3": "frost-2",
  "fire-4": "frost-3",
  "fire-5": "frost-3",
  "fire-6": "frost-4",
};

function fireVariants(sprites: readonly PixelSpriteSource[]): PaletteVariant[] {
  return [
    AUTHORED,
    inkSwap("arcane", "Arcane fire", sprites, ARCANE_FIRE),
    inkSwap("frostfire", "Frostfire", sprites, FROST_FIRE),
  ];
}

function flameStrip(spec: FlameSpec, count: number, everyMs: number): PixelCloud[] {
  const flame = createFlame(spec);
  settleFlame(flame, 1200);
  return Array.from({ length: count }, () => {
    stepFlame(flame, everyMs);
    return flameCloud(flame);
  });
}

function flameEntry(): AssetEntry {
  const sprites = frames(flameStrip({ width: 12, height: 22, seed: 7 }, 16, 60), {
    width: 20,
    height: 26,
    originX: 10,
    originY: 24,
  });
  return {
    id: "fire-flame",
    label: "Flame (heat automaton)",
    category: "effect",
    frames: sprites,
    frameDurationMs: 60,
    variants: fireVariants(sprites),
    notes: "fire/flame.ts: heat advected up a 12x22 grid, cooled by a rising noise map. 60 ms apart.",
  };
}

function brazierEntry(): AssetEntry {
  const sprites = frames(flameStrip({ width: 20, height: 30, seed: 9 }, 12, 60), {
    width: 28,
    height: 34,
    originX: 14,
    originY: 32,
  });
  return {
    id: "fire-flame-large",
    label: "Flame, brazier size",
    category: "effect",
    frames: sprites,
    frameDurationMs: 60,
    variants: fireVariants(sprites),
    notes: "The same automaton at 20x30: the noise grain scales with the grid.",
  };
}

function campfireEntry(): AssetEntry {
  const fire = createCampfire(5);
  let elapsed = 0;
  const run = (ms: number): void => {
    for (let spent = 0; spent < ms; spent += STEP_MS) {
      elapsed += STEP_MS;
      stepCampfire(fire, STEP_MS, { wind: 0.35 });
    }
  };
  run(2400);
  const clouds = Array.from({ length: 16 }, () => {
    run(64);
    return [...campfireGround(fire, elapsed), ...campfireCloud(fire, elapsed)];
  });
  const sprites = frames(clouds, { width: 64, height: 86, originX: 32, originY: 74 });
  return {
    id: "fire-campfire",
    label: "Campfire",
    category: "prop",
    frames: sprites,
    frameDurationMs: 64,
    variants: fireVariants(sprites),
    notes: "Lit SDF stones and logs (baked), the flame automaton, embers, smoke puffs, ash bed and warm pool.",
  };
}

function fireballEntry(): AssetEntry {
  const ball = launchFireball({ x: 10, y: 10 }, { x: 1, y: 0.25 }, { x: 10, y: 10, turn: 0 }, 3);
  const clouds: PixelCloud[] = [];
  for (let index = 0; index < 14; index += 1) {
    for (let spent = 0; spent < 64; spent += STEP_MS) {
      flyFireball(ball, STEP_MS, () => false);
    }
    clouds.push(fireballCloud(ball));
  }
  const sprites = frames(clouds, { width: 150, height: 56, originX: 12, originY: 44 });
  return {
    id: "fire-fireball",
    label: "Fireball in flight",
    category: "effect",
    frames: sprites,
    frameDurationMs: 64,
    variants: fireVariants(sprites),
    notes: "Lit core, lick-and-smoke trail, sparks, ground shadow. Flies 7 tiles/s; bursts at 8 tiles.",
  };
}

function explosionStrip(count: number, everyMs: number, skipMs: number): PixelCloud[] {
  const explosion = createExplosion(11);
  for (let spent = 0; spent < skipMs; spent += 15) {
    stepExplosion(explosion, 15, 0.3);
  }
  return Array.from({ length: count }, () => {
    const cloud = explosionCloud(explosion);
    for (let spent = 0; spent < everyMs; spent += 15) {
      stepExplosion(explosion, 15, 0.3);
    }
    return cloud;
  });
}

const EXPLOSION_FRAME: CloudFrame = { width: 72, height: 80, originX: 36, originY: 58 };

/** Every 30 ms, so 0, 60, 120, 240 and 480 ms are frames 0, 2, 4, 8 and 16. */
function explosionEntry(): AssetEntry {
  const sprites = frames(explosionStrip(18, 30, 0), EXPLOSION_FRAME);
  return {
    id: "fire-explosion",
    label: "Fireball burst",
    category: "effect",
    frames: sprites,
    frameDurationMs: 30,
    variants: fireVariants(sprites),
    notes: "Frames are 30 ms apart: 0/60/120/240/480 ms are frames 0/2/4/8/16. Flash, blob, shock ring, licks, debris, smoke.",
  };
}

/** The burst's second act: its smoke column rolling up and drifting off. */
function aftermathEntry(): AssetEntry {
  const sprites = frames(explosionStrip(18, 60, 540), EXPLOSION_FRAME);
  return {
    id: "fire-explosion-smoke",
    label: "Fireball burst, smoke",
    category: "effect",
    frames: sprites,
    frameDurationMs: 60,
    variants: [
      AUTHORED,
      inkSwap("steam", "Steam", sprites, { "smoke-0": "frost-1", "smoke-1": "frost-2", "smoke-2": "frost-3", "smoke-3": "foam" }),
    ],
    notes: "540 ms to 1.6 s after the burst, 60 ms apart: the column of puffs, bent by the wind.",
  };
}

function decalEntry(kind: DecalKind, ages: readonly number[], swaps: readonly [string, string, Partial<Record<InkId, InkId>>][]): AssetEntry {
  const decal = createDecal({ x: 0, y: 0 }, kind, 9, 0);
  const sprites = frames(
    ages.map((age) => decalCloud(decal, age)),
    { width: 48, height: 28, originX: 24, originY: 14 },
  );
  return {
    id: `decal-${kind}`,
    label: `Decal: ${kind}, ageing`,
    category: "effect",
    frames: sprites,
    frameDurationMs: 400,
    variants: [AUTHORED, ...swaps.map(([id, label, map]) => inkSwap(id, label, sprites, map))],
    notes: `fire/decals.ts. Frames at ${ages.join(", ")} ms of its life.`,
  };
}

function frostNovaEntry(): AssetEntry {
  const nova = createFrostNova(21);
  const clouds: PixelCloud[] = [];
  for (let index = 0; index < 24; index += 1) {
    clouds.push(frostNovaCloud(nova));
    for (let spent = 0; spent < 30; spent += 15) {
      stepFrostNova(nova, 15);
    }
  }
  const sprites = frames(clouds, { width: 80, height: 56, originX: 40, originY: 32 });
  return {
    id: "frost-nova",
    label: "Frost nova",
    category: "effect",
    frames: sprites,
    frameDurationMs: 30,
    variants: [AUTHORED, inkSwap("arcane", "Arcane nova", sprites, { "frost-3": "arcane-3", "frost-4": "arcane-4" })],
    notes: "SDF ring (180 ms), ice shards along the ring normal, Voronoi crack decal. 30 ms apart.",
  };
}

export const FIRE_ASSETS: readonly AssetEntry[] = [
  flameEntry(),
  brazierEntry(),
  campfireEntry(),
  fireballEntry(),
  explosionEntry(),
  aftermathEntry(),
  frostNovaEntry(),
  decalEntry("scorch", [0, 1000, 2000, 3500, 5000, 6000, 7000, 7800], [
    ["ashen", "Ashen", { "shadow-soft": "smoke-2", shadow: "smoke-1", "earth-0": "stone-1", "bark-0": "stone-0" }],
  ]),
  decalEntry("goo", [0, 2000, 4400, 5600, 6800, 7600], [
    ["blood", "Blood", { "slime-1": "crimson-1", "slime-3": "crimson-2" }],
  ]),
  decalEntry("frost", [0, 800, 1600, 2000, 2300, 2600], [
    ["arcane", "Arcane", { "frost-1": "arcane-1", "frost-2": "arcane-2", "frost-3": "arcane-3", "frost-4": "arcane-4" }],
  ]),
];
