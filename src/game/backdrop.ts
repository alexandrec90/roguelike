/**
 * A backdrop: a picture of *where you are* for the band above the field.
 *
 * Outdoors that band is the sky and the horizon lip, drawn by their own layers
 * (`sky-layer.ts`, `roll-ground-layer.ts`) and named `OUTDOORS` here. Anywhere
 * else - a cave now, a portal's far side, open air, deep water later - is a
 * `Backdrop`: something that paints the band into a buffer for a heading and a
 * clock, says what light it gives off, and says what colour the world is lit
 * by while you are there. `backdrop-layer.ts` draws whichever is current and
 * hands the change between two of them to `horizon-transition.ts`.
 *
 * Like the sky, a backdrop lives at a bearing: it is handed the panorama
 * offset (`panorama.ts`), so strafing - which turns the world - sweeps it by
 * the exact angle, and a lap brings it back round.
 */

import type { LightSource } from "./lights";
import type { PixelBuffer } from "./pixel-buffer";

/** The id of the sky and the lip: not a `Backdrop`, because other layers draw it. */
export const OUTDOORS = "outdoors";

export interface BackdropView {
  /** The band's size: the render target's width, down to the flat field's first scanline. */
  readonly width: number;
  readonly height: number;
  /** How far the panorama has turned, whole pixels (`bearingOffset`). */
  readonly offset: number;
  readonly elapsedMs: number;
}

export interface Backdrop {
  readonly id: string;
  /** The multiply colour the world is lit by in this place, in place of the hour's. */
  readonly ambient: string;
  /**
   * What to compare to know the last paint still stands; equal keys skip the
   * paint. Anything that moves (a flame, a drift) belongs in it.
   */
  signature(view: BackdropView): string;
  /** The band, opaque, into a buffer of exactly `view.width` x `view.height`. */
  paint(buffer: PixelBuffer, view: BackdropView): void;
  /** The light it gives off this instant, screen pixels in the band's own coordinates. */
  lights(view: BackdropView): LightSource[];
}
