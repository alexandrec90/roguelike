/**
 * Every visual effect a skin lays over the world, as a switch the Options
 * panel flips while the game runs (and keeps in the address as `?off=rain,shake`,
 * so a reload or a shared link opens the same way).
 *
 * The look is still being decided, so each effect can be taken away to judge the
 * picture without it - and to read what it costs. That second use is the
 * contract: **an effect that is off does no work.** It is not drawn and then
 * hidden; its layer is not stepped, its particles are not emitted, its pass is
 * not run and its shader code is not compiled in. A frame with an effect off is
 * the frame the game would be without it, so `?bench=1` (or a GPU timer) taken
 * on it is that frame's real cost.
 *
 * **Switches change mid-run.** One `EffectSwitches` is made per page load
 * (`main.ts`), handed to the panel and to the skin, and flipped in place; so a
 * layer asks `on("…")` every frame rather than once when it is made, and an
 * effect switched off clears what it had on screen.
 *
 * An effect is presentation only. Switching one off never changes what
 * *happens* - the rain still soaks the ground, the slimes still take the blow -
 * because the simulation under every skin reads none of this. Hit stop is not
 * here for that reason: it stops the world's clock, so it is part of the fight.
 *
 * What is world rather than effect - the ground, the landforms, the trees, the
 * water's body, the hero, the slimes, the spells, the sky's gradient and the
 * hour's light - has no switch: without it there is no game to look at.
 *
 * Adding an effect is a row here and an `on("…")` at the one place its work
 * starts. `effects.test.ts` fails a row no skin reads.
 */

import type { SkinId } from "../skins/skin";

export type EffectId =
  | "lights"
  | "cloud-shadows"
  | "sky-clouds"
  | "stars"
  | "rain"
  | "mist"
  | "lightning"
  | "reflections"
  | "ripples"
  | "spray"
  | "motes"
  | "grass"
  | "sway"
  | "shadows"
  | "decals"
  | "particles"
  | "scarf"
  | "trail"
  | "shake";

export interface Effect {
  readonly id: EffectId;
  /** What the panel calls it. */
  readonly label: string;
  /** The skins that draw it; the panel offers it only under those. */
  readonly skins: readonly SkinId[];
  /** What it is, in a line: the panel's tooltip. */
  readonly what: string;
}

const BOTH: readonly SkinId[] = ["pixel", "lowpoly"];
const PIXEL: readonly SkinId[] = ["pixel"];

/** Every effect, in the order the panel lists them: the sky down to the hero. */
export const EFFECTS: readonly Effect[] = [
  { id: "lights", label: "Light pools", skins: PIXEL, what: "Pools and haloes round fires, spells, the burning blade and fireflies" },
  { id: "cloud-shadows", label: "Cloud shadows", skins: PIXEL, what: "Shadows of clouds drifting over the field" },
  { id: "sky-clouds", label: "Sky clouds", skins: PIXEL, what: "The cumulus in the band above the horizon" },
  { id: "stars", label: "Stars", skins: PIXEL, what: "The night sky's stars and their twinkle" },
  { id: "rain", label: "Rain", skins: BOTH, what: "Falling streaks and the splashes they throw on dry ground" },
  { id: "mist", label: "Rain mist", skins: PIXEL, what: "The grey veil rain draws over the horizon" },
  { id: "lightning", label: "Lightning", skins: PIXEL, what: "Bolts, their flash, their light and their kick" },
  { id: "reflections", label: "Reflections", skins: BOTH, what: "What the water mirrors, and the sky's glints on it" },
  { id: "ripples", label: "Ripples", skins: BOTH, what: "Rings in the water from rain, footsteps and landings" },
  { id: "spray", label: "Wading spray", skins: PIXEL, what: "Water thrown up by a footfall in the shallows" },
  { id: "motes", label: "Fireflies and pollen", skins: PIXEL, what: "The motes drifting over the field" },
  { id: "grass", label: "Grass tufts", skins: PIXEL, what: "The tufts growing on the field" },
  { id: "sway", label: "Wind sway", skins: BOTH, what: "Grass and trees leaning in the wind and parting round feet" },
  { id: "shadows", label: "Cast shadows", skins: BOTH, what: "The shadows under the hero, the slimes and the scenery" },
  { id: "decals", label: "Ground marks", skins: PIXEL, what: "Scorch, goo and frost left on the ground" },
  { id: "particles", label: "Particles", skins: PIXEL, what: "Blade fire, hit sparks, slime goo, campfire embers and smoke" },
  { id: "scarf", label: "Scarf", skins: PIXEL, what: "The cloth tail on the hero's neck" },
  { id: "trail", label: "Sword trail", skins: BOTH, what: "The crescent a swing leaves behind the blade" },
  { id: "shake", label: "Screen shake", skins: BOTH, what: "The camera's kick from blasts and thunder" },
];

/**
 * Which effects are drawn, now. Flipped in place by the panel, so read it every
 * frame. Two with the same effects off are equal as values, so options holding
 * them compare by what they mean.
 */
export class EffectSwitches {
  private readonly disabled: Set<EffectId>;

  constructor(off: Iterable<EffectId>) {
    this.disabled = new Set(off);
  }

  /** The ones switched off, in table order. */
  get off(): readonly EffectId[] {
    return EFFECTS.map((effect) => effect.id).filter((id) => this.disabled.has(id));
  }

  on(id: EffectId): boolean {
    return !this.disabled.has(id);
  }

  /** Switch one on or off; every layer sees it on its next frame. */
  set(id: EffectId, on: boolean): void {
    if (on) {
      this.disabled.delete(id);
    } else {
      this.disabled.add(id);
    }
  }
}

/** Switches with exactly `off` turned off. */
export function effectSwitches(off: Iterable<EffectId>): EffectSwitches {
  return new EffectSwitches(off);
}

/**
 * Everything on: what loads with no `?off=`, and the default a layer made
 * without switches reads. Shared, so never `set` - make your own with
 * `effectSwitches([])` to flip.
 */
export const ALL_EFFECTS: EffectSwitches = effectSwitches([]);

/**
 * Read `?off=`: a comma-separated list of effect ids, any case, any spaces.
 * An id the table does not know is dropped rather than failing the load.
 */
export function parseEffectsOff(raw: string | null): EffectSwitches {
  const known = new Set<string>(EFFECTS.map((effect) => effect.id));
  const ids = (raw ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is EffectId => known.has(part));
  return effectSwitches(ids);
}

/** The `?off=` value for these ids, in table order; `""` when none is off. */
export function formatEffectsOff(off: Iterable<EffectId>): string {
  return effectSwitches(off).off.join(",");
}

/** The effects `skin` draws, in table order. */
export function effectsFor(skin: SkinId): readonly Effect[] {
  return EFFECTS.filter((effect) => effect.skins.includes(skin));
}
