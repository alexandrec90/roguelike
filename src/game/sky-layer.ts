/**
 * The band above the horizon, and the 360 degrees of it you cannot see at once.
 *
 * Everything up here lives at a *bearing* rather than at a screen x, and
 * `panorama.ts` converts. That single change is what makes the planet read as
 * round: strafe and the ridge, the clouds and the stars slide together by the
 * same whole number of pixels, and come back round to where they started after
 * one lap of the sideways circle. It is also the only part of the world that
 * shows the turn *continuously* — the ground turns in whole tiles once a step,
 * the sky gets the exact angle every frame, and the eye reads the sky.
 *
 * What it looks like is the atmosphere's decision (`atmosphere.ts`): the
 * gradient from zenith to horizon, the sun or moon riding the same screen-space
 * arc the whole world is lit from, how much cloud there is and how it is lit,
 * whether the stars are out, and the haze the far ground dissolves into. The sky
 * is the one genuinely continuous gradient in the game, so it is the one place
 * colours are *computed* rather than picked from the palette — resolved to the
 * pixel grid with the same Bayer matrix everything else is dithered with.
 *
 * Drawn as one `PixelSurface`, re-rendered only when something it shows has
 * changed: the bearing, the light, or the clouds' slow drift.
 *
 *     sky gradient     dithered, zenith to horizon
 *     stars            at a bearing; fade in at dusk
 *     sun / moon       on the light's arc, in screen space like the light
 *     clouds           cumulus on two decks at a bearing, drifting (`sky-clouds.ts`)
 *     far ridge        seamless noise profile, hazed
 *     near ridge       the same, nearer and darker
 *
 * It stops at the horizon line. Below it, over the roll, is ground rather than
 * sky - the field carried over the lip, at the same depth - and that is
 * `roll-ground-layer.ts`, which borrows only the haze colour from here.
 */

import type { Scene } from "../engine";

import type { Atmosphere } from "./atmosphere";
import type { HorizonLayout } from "./horizon";
import { bearingOffset } from "./panorama";
import { PixelSurface } from "./pixel-surface";
import { HORIZON_DEPTH } from "./projection";
import type { SkyStyle } from "./scene-options";
import { SKY_DRIFT } from "./sky-clouds";
import { HdSkyLayer } from "./sky-hd-layer";
import { SkyPainter } from "./sky-paint";

/** The sky is re-rendered at most this often for the clouds' drift, ms. */
const CLOUD_TICK_MS = 200;

export class SkyLayer {
  private surface!: PixelSurface;
  private painter!: SkyPainter;
  private rendered = "";
  private readonly ridgesOnly: boolean;
  /** The air at the screen's own resolution, behind the world (`?sky=hd`), or undefined. */
  private hd: HdSkyLayer | undefined;

  /**
   * `hd` leaves the air out of the pixel band - gradient, stars, sun and
   * clouds - and the rest of it transparent, and has `sky-hd-layer.ts` draw the
   * air behind the world at the screen's own resolution instead.
   */
  constructor(style: SkyStyle = "pixel") {
    this.ridgesOnly = style === "hd";
  }

  create(scene: Scene, layout: HorizonLayout, width: number): void {
    this.surface = new PixelSurface(scene, width, Math.max(layout.skyHeight, 1), "sky");
    this.surface.image.setDepth(HORIZON_DEPTH);
    this.painter = new SkyPainter(this.surface.buffer, layout, this.ridgesOnly);
    if (this.ridgesOnly) {
      this.hd = new HdSkyLayer();
      this.hd.create(scene, layout, width);
    }
  }

  /** One frame of sky for a heading, a time of day and a clock. */
  update(turn: number, atmosphere: Atmosphere, elapsedMs: number): void {
    this.hd?.update(turn, atmosphere, elapsedMs);
    const offset = bearingOffset(turn);
    // Nothing on the ridges drifts or twinkles: they repaint only for a turn or the light.
    const tick = this.ridgesOnly ? 0 : Math.floor(elapsedMs / CLOUD_TICK_MS);
    const signature = `${offset}|${atmosphere.hours.toFixed(2)}|${atmosphere.overcast.toFixed(2)}|${tick}`;
    if (signature === this.rendered) {
      return;
    }
    this.rendered = signature;
    const drift = (tick * CLOUD_TICK_MS * SKY_DRIFT) / 1000;
    this.painter.paint(atmosphere, offset, elapsedMs, drift);
    this.surface.touch().commit();
  }
}
