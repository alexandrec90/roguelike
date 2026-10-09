/**
 * The low-poly skin's own address-bar knobs: how it draws, never what happens.
 *
 * | Key | Values | Meaning |
 * | --- | --- | --- |
 * | `res` | `low` | draw at ~180 scanlines and blow each pixel up whole (`lowResCanvas`), instead of at the window's own resolution |
 * | `leaves` | `impostor` | tree and bush crowns as round impostor balls (`impostor.ts`), instead of tiers of faceted plates |
 * | `volume` | `1` | volcano smoke and clouds raymarched through a density field, instead of shaded as lit balls |
 *
 * `gpu` and `msaa` are `backend.ts`'. Every parser falls back rather than
 * throwing: a typo starts the default look, never a blank page.
 */

import { LOGICAL_HEIGHT } from "./placement";

export type Resolution = "full" | "low";
export type Leaves = "mesh" | "impostor";

export interface LookOptions {
  readonly resolution: Resolution;
  readonly leaves: Leaves;
  /** Smoke and clouds raymarched as volumes rather than shaded as balls. */
  readonly volume: boolean;
}

export function parseResolution(raw: string | null): Resolution {
  return raw?.trim().toLowerCase() === "low" ? "low" : "full";
}

export function parseLeaves(raw: string | null): Leaves {
  return raw?.trim().toLowerCase() === "impostor" ? "impostor" : "mesh";
}

export function parseVolume(raw: string | null): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

export function readLookOptions(query: URLSearchParams): LookOptions {
  return {
    resolution: parseResolution(query.get("res")),
    leaves: parseLeaves(query.get("leaves")),
    volume: parseVolume(query.get("volume")),
  };
}

/**
 * The drawing buffer and its on-screen size for `?res=low`, from the window in
 * CSS pixels and the device's pixel ratio.
 *
 * Each logical pixel becomes a whole square of `factor` device pixels - the
 * factor that puts the frame nearest `LOGICAL_HEIGHT` scanlines tall - so no
 * pixel is a different size from its neighbour. The buffer covers the window
 * (it is rounded up), and the canvas overhangs its right and bottom edges by
 * less than one logical pixel, which the host clips.
 */
export function lowResCanvas(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): { width: number; height: number; factor: number; cssWidth: number; cssHeight: number } {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const deviceWidth = Math.max(cssWidth, 1) * ratio;
  const deviceHeight = Math.max(cssHeight, 1) * ratio;
  const factor = Math.max(1, Math.round(deviceHeight / LOGICAL_HEIGHT));
  const width = Math.ceil(deviceWidth / factor);
  const height = Math.ceil(deviceHeight / factor);
  return { width, height, factor, cssWidth: (width * factor) / ratio, cssHeight: (height * factor) / ratio };
}
