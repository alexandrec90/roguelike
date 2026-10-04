/**
 * A skin is how the game looks, and nothing else.
 *
 * Everything that decides what *happens* - the planet, the terrain, the
 * landforms and lakes, where each tree stands, how the hero walks and swings,
 * what a slime does - is renderer-free simulation under `src/game/`. A skin
 * reads that and draws it. Two skins over one seed show the same hills, the
 * same trees in the same places and the same hero walking at the same speed;
 * only the picture differs.
 *
 * What every skin owes, because it is the game's identity rather than its art
 * (`CLAUDE.md`):
 *
 * - the **pitched-back local view** - an overhead field, rows and columns
 *   axis-aligned, depth foreshortened by `DEPTH_RATIO`, the hero nailed to one
 *   point while the planet turns under him;
 * - the **treadmill-lip horizon** - the flat field bending over the horizon
 *   along `horizon.ts`'s one curve, far bodies small on the lip and sinking foot
 *   first behind it.
 *
 * A skin is chosen by `?skin=` and switched in place by `SKIN_KEYS`, which
 * reloads the page under the next one. Each skin is a lazily imported module,
 * so a load pays only for the skin it shows.
 */

export type SkinId = "pixel" | "lowpoly";

export interface SkinInfo {
  readonly id: SkinId;
  /** What the player is told it is called. */
  readonly label: string;
}

/** Every skin, in the order the switch key steps through them. The first is the default. */
export const SKINS: readonly SkinInfo[] = [
  { id: "pixel", label: "Pixel art" },
  { id: "lowpoly", label: "Low poly" },
];

export const DEFAULT_SKIN: SkinId = "pixel";

/**
 * What a skin module exports: one function that builds the game into `host`
 * from the page's query. It owns its canvas, its loop and its input wiring.
 */
export interface SkinModule {
  mount(host: HTMLElement, query: URLSearchParams): void;
}

/** Read `?skin=`; anything unknown falls back to the default rather than blanking the page. */
export function parseSkin(raw: string | null | undefined): SkinId {
  const value = raw?.trim().toLowerCase();
  return SKINS.find((skin) => skin.id === value)?.id ?? DEFAULT_SKIN;
}

/** The skin after `current`, wrapping round. */
export function nextSkin(current: SkinId): SkinId {
  const index = SKINS.findIndex((skin) => skin.id === current);
  return SKINS[(index + 1) % SKINS.length]?.id ?? DEFAULT_SKIN;
}

/**
 * The same address under another skin: every other knob in the query - the
 * time, the weather, the radius - is kept, so a comparison is like for like.
 */
export function skinHref(href: string, skin: SkinId): string {
  const url = new URL(href);
  url.searchParams.set("skin", skin);
  return url.toString();
}
