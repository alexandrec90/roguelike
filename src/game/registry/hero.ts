/**
 * Asset-lab entries: The hero as a volumetric rig, his gear, and the burning blade.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Nothing here is drawn. Every frame is `heroFigure` (the same call the game
 * makes) at a sampled clip time, so the lab shows exactly the man you play.
 */

import { AUTHORED, type AssetEntry, type PaletteVariant } from "../asset-types";
import { heroFigure, layeredPose, type FigureOptions } from "../hero/hero-figure";
import { HeroLook } from "../hero/hero-look";
import type { Heading } from "../keybindings";
import { createPlayer, facingYaw, STEP_MS, type PlayerState } from "../player";
import { cloudToSprite, INK_COLORS, INK_TOKENS, type CloudFrame, type InkId, type PixelCloud } from "../ink";
import { CAST, SWING, WALK, IDLE } from "../models";
import type { PixelSpriteSource } from "../pixel-art";
import { familyRamp, type Family } from "../palette";

/** Room for a raised blade, its flames, and a trail, foot at (24, 40). */
export const HERO_FRAME: CloudFrame = { width: 48, height: 46, originX: 24, originY: 40 };

/** Re-ink one family as another, step for step — a palette swap, not new art. */
function swapFamily(from: Family, to: Family): Record<string, string> {
  const source = familyRamp(from);
  const target = familyRamp(to);
  const overrides: Record<string, string> = {};
  source.forEach((ink, index) => {
    const replacement = target[Math.min(index, target.length - 1)] as InkId;
    overrides[INK_TOKENS[ink]] = INK_COLORS[replacement];
  });
  return overrides;
}

const RED_TUNIC: PaletteVariant = { id: "crimson-tunic", label: "Crimson tunic", overrides: swapFamily("tunic", "crimson") };
const GREEN_TUNIC: PaletteVariant = { id: "forest-tunic", label: "Forest tunic", overrides: swapFamily("tunic", "moss") };
const VARIANTS = [AUTHORED, RED_TUNIC, GREEN_TUNIC] as const;

type Tracks = Parameters<typeof layeredPose>[0];

function frames(
  count: number,
  tracksAt: (fraction: number) => Tracks,
  options: FigureOptions = {},
  after?: (cloud: PixelCloud, fraction: number) => PixelCloud,
): PixelSpriteSource[] {
  return Array.from({ length: count }, (_unused, index) => {
    const fraction = index / count;
    const tracks = tracksAt(fraction);
    const figure = heroFigure(layeredPose(tracks), { ...options, timeMs: tracks.idleMs });
    const cloud = after === undefined ? figure.cloud : after(figure.cloud, fraction);
    return cloudToSprite(cloud, HERO_FRAME);
  });
}

const idle = (f: number): Tracks => ({ idleMs: f * IDLE.durationMs });
const walk = (f: number): Tracks => ({ idleMs: f * WALK.durationMs, walkMs: f * WALK.durationMs });
const swing = (f: number): Tracks => ({ idleMs: f * SWING.durationMs, swingMs: f * SWING.durationMs });
const cast = (f: number): Tracks => ({ idleMs: f * CAST.durationMs, castMs: f * CAST.durationMs });

/**
 * A swap may only name tokens every frame uses (`validateRegistry`), and a
 * dithered ramp does not always reach every step in every pose — so each
 * entry keeps the part of the swap its own frames can honour.
 */
function fitted(variant: PaletteVariant, list: readonly PixelSpriteSource[]): PaletteVariant {
  const overrides = Object.fromEntries(
    Object.entries(variant.overrides).filter(([token]) => list.every((frame) => token in frame.palette)),
  );
  return { ...variant, overrides };
}

/** Facing away: the rig turned half round, never a drawing of his back. */
const BACK: FigureOptions = { yaw: facingYaw("north") };

/** Clockwise from facing the viewer, so the filmstrip plays as one slow turn. */
const COMPASS: readonly Heading[] = [
  "south",
  "southeast",
  "east",
  "northeast",
  "north",
  "northwest",
  "west",
  "southwest",
];

const DUSK_SUN ={ light: { x: 0.82, y: -0.57 }, elevation: 0.3 };

/**
 * Frames of the whole look — body, scarf, trail, flames, shadow — by driving
 * `HeroLook` (the class the game draws with) over a scripted player state in
 * fixed 16 ms steps, so a capture repeats exactly.
 */
function simulated(
  count: number,
  stateAt: (ms: number) => PlayerState,
  options: { readonly everyMs: number; readonly warmMs: number; readonly shadow?: boolean },
): PixelSpriteSource[] {
  const look = new HeroLook(0x1ab);
  const captured: PixelSpriteSource[] = [];
  const end = options.warmMs + count * options.everyMs;
  let next = options.warmMs;
  for (let ms = 0; ms <= end && captured.length < count; ms += 16) {
    const frame = look.frame({ player: stateAt(ms), elapsedMs: ms, deltaMs: 16, sun: DUSK_SUN });
    if (ms >= next) {
      next += options.everyMs;
      captured.push(cloudToSprite(options.shadow === true ? [...frame.shadow, ...frame.scene] : frame.scene, HERO_FRAME));
    }
  }
  return captured;
}

const STAND = createPlayer({ x: 0, y: 0, turn: 0 });

/** Swinging on a loop from `startMs`, burning or not. */
function swingingAt(enchanted: boolean, startMs: number) {
  return (ms: number): PlayerState => ({
    ...STAND,
    enchanted,
    attackMs: ms < startMs ? undefined : (ms - startMs) % SWING.durationMs,
  });
}

/** Walking on a loop — the scarf's tail streams away from the heading. */
function walkingAt(heading: "east" | "north") {
  const gait = heading === "east" ? { forward: 0, strafe: 1 } : { forward: 1, strafe: 0 };
  return (ms: number): PlayerState => ({
    ...STAND,
    heading,
    facing: heading,
    motion: "step",
    gait,
    motionMs: ms % STEP_MS,
    steps: Math.floor(ms / STEP_MS),
  });
}

function entry(id: string, label: string, list: PixelSpriteSource[], frameMs: number, notes: string): AssetEntry {
  const variants = VARIANTS.map((variant) => (variant === AUTHORED ? variant : fitted(variant, list)));
  return { id, label, category: "actor", frames: list, frameDurationMs: frameMs, variants, notes };
}

export const HERO_ASSETS: readonly AssetEntry[] = [
  entry(
    "hero-body-idle",
    "Hero body — idle, front",
    frames(8, idle),
    175,
    "Volumetric rig: capsules and spheres on the bones, lit per pixel from their normals, " +
      "nearest surface wins, selective outline. Nothing drawn but the two eyes.",
  ),
  entry("hero-body-idle-back", "Hero body — idle, back", frames(8, idle, BACK), 175,
    "Same spheres, turned half round: the hair sphere is now the nearer one, so it is the back of his head."),
  entry("hero-facings", "Hero body — eight facings", COMPASS.flatMap((facing) => frames(1, idle, { yaw: facingYaw(facing) })), 400,
    "One skeleton turned an eighth at a time, clockwise from facing the viewer. No view was drawn: " +
      "the eyes slide round the head and hide behind it, and the sword never changes hands."),
  entry("hero-body-walk", "Hero body — walk, front", frames(8, walk), 80, "WALK on the volumetric rig."),
  entry("hero-body-walk-side", "Hero body — walk, east", frames(8, walk, { yaw: facingYaw("east") }), 80,
    "The same clip turned a quarter: a true profile, one eye showing, striding across the screen."),
  entry("hero-body-walk-back", "Hero body — walk, back", frames(8, walk, BACK), 80,
    "WALK turned half round: the sword stays in the same hand, so it crosses to the other side of the screen."),
  entry("hero-body-swing", "Hero body — swing", frames(8, swing), 65, "SWING: windup behind the head, contact in front."),
  entry("hero-body-swing-back", "Hero body — swing, back", frames(8, swing, BACK), 65, "SWING, turned half round."),
  entry("hero-body-cast", "Hero body — cast", frames(8, cast), 88, "CAST: gather, release at t=0.55."),
  entry("hero-body-flaming", "Hero body — flaming blade", frames(8, idle, { enchanted: true }), 90,
    "Enchanted: the sword bone re-inked to the fire ramp and self-lit from noise."),
  entry("hero-swing-trail", "Hero — swing with trail", simulated(8, swingingAt(false, 0), { everyMs: 32, warmMs: 144 }), 65,
    "The crescent is the SWING clip sampled at the last seven 16 ms steps, filled between " +
      "consecutive blade spans and dithered away with age. Behind him or in front by depth."),
  entry("hero-flaming-idle", "Hero — burning blade, idle", simulated(8, swingingAt(true, 1e9), { everyMs: 48, warmMs: 400 }), 48,
    "Flame licks and embers from a pooled, seeded emitter along the blade, rising and cooling down the fire ramp."),
  entry("hero-flaming-swing", "Hero — burning blade, swing", simulated(8, swingingAt(true, 300), { everyMs: 32, warmMs: 444 }), 65,
    "Flames inherit the blade's motion, so a swing flings them; the trail takes the fire ramp."),
  entry("hero-walk-east-scarf", "Hero — walking east, scarf", simulated(8, walkingAt("east"), { everyMs: 48, warmMs: 480 }), 48,
    "The scarf's tail is a Verlet chain pinned to his neck, dragged by the gait and the wind."),
  entry("hero-walk-north-scarf", "Hero — walking away, scarf", simulated(8, walkingAt("north"), { everyMs: 48, warmMs: 480 }), 48,
    "Walking away, the tail hangs down his back in front of the body — depth flips with facing."),
  entry("hero-shadow-dusk", "Hero — shadow at dusk", simulated(4, () => STAND, { everyMs: 175, warmMs: 0, shadow: true }), 175,
    "castShadow of his own cloud under a low sun, plus the contact pool under his boots."),
];
