/**
 * The clouds, as impostor puffs in the sky band.
 *
 * Where each cloud is, and what puffs it is made of, is the shared sky's
 * (`sky-clouds.ts`): the same decks, slots and growth with overcast the pixel
 * skin paints, at the same bearings on the same panorama, drifting at the same
 * rate. What this skin does differently is only the drawing - each puff a ball
 * (`impostor.ts`), lit from the sun's direction and billowing, cut flat where
 * the deck's base is, instead of three dithered tones.
 *
 * The panorama turns continuously here, not in whole pixels: there is no pixel
 * grid for a cloud to shimmer against.
 */

import { cloudTones, CLOUD_DECKS, deckClouds, FLATTEN, SKY_DRIFT, type CloudDeck } from "../../game/sky-clouds";
import { PANORAMA_WIDTH, wrapPanorama } from "../../game/panorama";
import type { Atmosphere } from "../../game/atmosphere";
import type { ImpostorBuilder } from "./impostor";
import type { Rgb } from "./mesh";
import { hash01, seedOf } from "./palette";
import type { LowpolyView } from "./placement";

/** How much a puff swells and shrinks as it billows, as a share of its radius. */
const BREATH = 0.07;

/** Every on-screen cloud puff of every deck, farthest deck first, into `out`. */
export function skyPuffs(
  out: ImpostorBuilder,
  view: LowpolyView,
  atmosphere: Pick<Atmosphere, "skyTop" | "skyHorizon" | "ambient" | "overcast">,
  turn: number,
  elapsedMs: number,
  decks: readonly CloudDeck[] = CLOUD_DECKS,
): void {
  const lit = unit(cloudTones(atmosphere).lit);
  const seconds = elapsedMs / 1000;
  const bearing = (turn / (Math.PI * 2)) * PANORAMA_WIDTH;
  for (const deck of decks) {
    const base = view.layout.skyHeight * deck.base;
    const start = bearing + seconds * SKY_DRIFT * deck.drift;
    for (const cloud of deckClouds(deck, atmosphere.overcast)) {
      const centre = wrapPanorama(cloud.x - start);
      const reach = cloud.halfWidth + 2;
      for (const at of [centre, centre - PANORAMA_WIDTH]) {
        if (at + reach < 0 || at - reach > view.width) {
          continue;
        }
        cloud.puffs.forEach((puff, index) => {
          const seed = hash01(seedOf(deck.seed, cloud.x, index));
          const swell = 1 + BREATH * Math.sin(seconds * 0.35 + seed * 6.283);
          const radius = puff.radius * swell;
          out.skyPuff({
            x: at + puff.x,
            y: base + cloud.sag - puff.lift,
            base: base + cloud.sag,
            radiusX: radius,
            radiusY: radius * FLATTEN,
            colour: lit,
            seed,
            alpha: deck.alpha,
          });
        });
      }
    }
  }
}

/** The hour's shade tone for a cloud's side away from the sun, 0..1. */
export function cloudShadeOf(atmosphere: Pick<Atmosphere, "skyTop" | "skyHorizon" | "ambient" | "overcast">): Rgb {
  return unit(cloudTones(atmosphere).shade);
}

function unit(colour: { readonly r: number; readonly g: number; readonly b: number }): Rgb {
  return [colour.r / 255, colour.g / 255, colour.b / 255];
}
