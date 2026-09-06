/**
 * The lab's whole view state, and its round trip through a URL.
 *
 * Everything the lab shows — which asset, which palette swap, which frame, at
 * which zoom, over which ground — is in one plain object that a query string
 * can carry. That is what makes a capture reproducible: a screenshot is only
 * evidence if the exact view it was taken from can be reopened, by a person or
 * by an agent driving the browser.
 *
 * Nothing here throws on bad input. A hand-edited URL naming an asset that has
 * since been renamed should open the lab on something, not on an error page.
 */

import { ASSET_REGISTRY, AUTHORED_VARIANT_ID, findAsset, findVariant } from "../game/asset-registry";
import type { AssetEntry } from "../game/asset-registry";

export type BackgroundMode = "duo" | "checker" | "contrast";

/**
 * - `duo`: dark ground beside light ground — the everyday readability check.
 * - `checker`: magenta checker under both panes — shows stray or missing alpha.
 * - `contrast`: pure black beside pure white — the extremes a real level never
 *   reaches, where thin outlines break first.
 */
export const BACKGROUND_MODES: readonly BackgroundMode[] = ["duo", "checker", "contrast"];

/** Only whole factors: a pixel-art inspector that resamples is lying. */
export const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8];

export interface LabState {
  readonly assetId: string;
  readonly variantId: string;
  readonly frame: number;
  readonly playing: boolean;
  readonly timeMs: number;
  readonly zoom: number;
  readonly background: BackgroundMode;
  readonly grid: boolean;
  readonly bounds: boolean;
  readonly tiled: boolean;
}

export function normalizeLabState(
  patch: Partial<LabState> = {},
  registry: readonly AssetEntry[] = ASSET_REGISTRY,
): LabState {
  const entry = resolveEntry(patch.assetId, registry);
  const variant = findVariant(entry, patch.variantId ?? "") ?? entry.variants[0];
  const frameCount = Math.max(entry.frames.length, 1);
  const requested = Math.trunc(patch.frame ?? 0);

  return {
    assetId: entry.id,
    variantId: variant?.id ?? AUTHORED_VARIANT_ID,
    frame: ((requested % frameCount) + frameCount) % frameCount,
    playing: patch.playing ?? true,
    timeMs: Math.max(patch.timeMs ?? 0, 0),
    zoom: snapZoom(patch.zoom ?? 4),
    background: BACKGROUND_MODES.find((mode) => mode === patch.background) ?? "duo",
    grid: patch.grid ?? false,
    bounds: patch.bounds ?? false,
    // Terrain opens tiled, because a tile's seams are the first thing to check
    // and the only thing a single copy cannot show. Nothing else can be tiled
    // at all: a hero repeated nine times is a state a stale URL can ask for and
    // an inspector should never enter.
    tiled: entry.category === "tile" ? (patch.tiled ?? true) : false,
  };
}

export function parseLabState(
  search: string,
  registry: readonly AssetEntry[] = ASSET_REGISTRY,
): LabState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  return normalizeLabState(
    {
      assetId: params.get("asset") ?? undefined,
      variantId: params.get("variant") ?? undefined,
      frame: readNumber(params.get("frame")),
      playing: readFlag(params.get("play")),
      timeMs: readNumber(params.get("t")),
      zoom: readNumber(params.get("zoom")),
      background: (params.get("bg") ?? undefined) as BackgroundMode | undefined,
      grid: readFlag(params.get("grid")),
      bounds: readFlag(params.get("bounds")),
      tiled: readFlag(params.get("tile")),
    },
    registry,
  );
}

export function serializeLabState(state: LabState): string {
  const params = new URLSearchParams({
    asset: state.assetId,
    variant: state.variantId,
    frame: String(state.frame),
    zoom: String(state.zoom),
    bg: state.background,
    play: state.playing ? "1" : "0",
    t: String(Math.round(state.timeMs)),
    grid: state.grid ? "1" : "0",
    bounds: state.bounds ? "1" : "0",
    tile: state.tiled ? "1" : "0",
  });

  return `?${params.toString()}`;
}

/** Nearest allowed zoom, so a stale or hand-typed factor still lands on a whole step. */
export function snapZoom(zoom: number): number {
  const steps = [...ZOOM_STEPS];
  const first = steps[0] ?? 1;

  return steps.reduce(
    (best, step) => (Math.abs(step - zoom) < Math.abs(best - zoom) ? step : best),
    first,
  );
}

function resolveEntry(assetId: string | undefined, registry: readonly AssetEntry[]): AssetEntry {
  const fallback = registry[0];
  if (fallback === undefined) {
    throw new Error("The asset registry is empty; the lab has nothing to show");
  }
  return findAsset(assetId ?? "", registry) ?? fallback;
}

function readNumber(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readFlag(raw: string | null): boolean | undefined {
  if (raw === null) {
    return undefined;
  }
  if (raw === "1" || raw === "true") {
    return true;
  }
  if (raw === "0" || raw === "false") {
    return false;
  }
  return undefined;
}
