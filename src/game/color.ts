/**
 * Colour arithmetic for the parts of the frame that are drawn rather than
 * authored — the sky ramp and the haze over the horizon roll.
 *
 * Authored art keeps its palette as hex strings, so these speak hex too and
 * round to whole channels: a gradient blended in floats and handed to a
 * 320x180 target would band anyway, and this way the exact colour of every
 * scanline is assertable in a test.
 */

const HEX = /^#[0-9a-f]{6}$/i;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  if (!HEX.test(hex)) {
    throw new Error(`Expected a #rrggbb colour, got '${hex}'`);
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** `t` of 0 is `from`, 1 is `to`; anything outside is clamped. */
export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

/**
 * Sample a multi-stop ramp at `t` in [0, 1].
 *
 * Stops are evenly spaced; a ramp is a short authored list, so uneven stops
 * would be a knob nobody has needed yet.
 */
export function sampleRamp(ramp: readonly string[], t: number): string {
  const first = ramp[0];
  if (first === undefined) {
    throw new Error("A colour ramp needs at least one stop");
  }
  if (ramp.length === 1) {
    return first;
  }

  const k = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const index = Math.min(Math.floor(k), ramp.length - 2);
  const from = ramp[index];
  const to = ramp[index + 1];
  if (from === undefined || to === undefined) {
    throw new Error("Colour ramp sampled out of range");
  }
  return mixHex(from, to, k - index);
}

/** Phaser's fill colours are numbers, not strings. */
export function hexToInt(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}
