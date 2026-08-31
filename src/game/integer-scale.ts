/**
 * Integer upscaling for the fixed 320x180 render target.
 *
 * The visual contract in CLAUDE.md is "render the world at 320x180, then
 * nearest-neighbor upscale the whole canvas by an integer factor and letterbox
 * the remainder". A fractional fit (Phaser's `Scale.FIT`) breaks that: it
 * resamples logical pixels onto non-integer device pixels, so a 1px highlight
 * becomes 1.4px on one row and 0.6px on the next. Everything here is pure so the
 * factor can be asserted in tests instead of eyeballed in a browser.
 */

export interface ScaleResult {
  /** Whole-number upscale factor, never below 1. */
  readonly factor: number;
  /** Upscaled canvas size in device-independent pixels. */
  readonly width: number;
  readonly height: number;
}

export interface IntegerScaleOptions {
  /** Upper bound on the factor; useful for the lab's manual zoom control. */
  readonly maxFactor?: number;
}

/**
 * Largest integer factor at which `baseWidth x baseHeight` still fits inside
 * `availableWidth x availableHeight`.
 *
 * Returns 1 when even a single copy does not fit: an undersized viewport should
 * clip or letterbox, never resample.
 */
export function integerScale(
  availableWidth: number,
  availableHeight: number,
  baseWidth: number,
  baseHeight: number,
  options: IntegerScaleOptions = {},
): ScaleResult {
  if (baseWidth <= 0 || baseHeight <= 0) {
    throw new Error("Base size must be positive");
  }

  const maxFactor = options.maxFactor ?? Number.POSITIVE_INFINITY;
  if (maxFactor < 1) {
    throw new Error("maxFactor must be at least 1");
  }

  const fitted = Math.min(
    Math.floor(availableWidth / baseWidth),
    Math.floor(availableHeight / baseHeight),
  );
  const factor = Math.min(Math.max(fitted, 1), maxFactor);

  return { factor, width: baseWidth * factor, height: baseHeight * factor };
}

/**
 * Letterbox offsets that centre an upscaled canvas on integer pixel boundaries.
 *
 * Centring on a half pixel is the other common way to smear a pixel-art canvas,
 * so the remainder is split with the extra pixel going to the right/bottom.
 */
export function letterbox(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number,
): { readonly left: number; readonly top: number } {
  return {
    left: Math.floor(Math.max(availableWidth - contentWidth, 0) / 2),
    top: Math.floor(Math.max(availableHeight - contentHeight, 0) / 2),
  };
}
