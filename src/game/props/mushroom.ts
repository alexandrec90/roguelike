/**
 * A mushroom ring: the volumetric body with a **cycled ramp** inside it.
 *
 * The caps are the same lit volume as everything else. What this one adds is
 * the cheapest animation in the whole pipeline — `cycleRamp`, rotating the ink
 * order per tick over a body that never changes shape. The glow appears to
 * travel through the flesh of the cap, and not one pixel was recomputed to make
 * it happen.
 *
 * That combination is the recipe for anything that pulses rather than moves: a
 * rune, an enchanted weapon, a health crystal, lava, a portal, poison in a
 * wound. Build the shape once with `volumeCloud`, then re-ink it per tick.
 *
 * The ring itself is data: a seeded ellipse of caps at slightly different sizes,
 * with the phase of the glow offset per cap so the ring shimmers around itself
 * instead of blinking as one.
 */

import { cloudBounds, type PixelCloud } from "../ink";
import { detailOf, type SceneryEnv, type SceneryInstance, type ScenerySpecies } from "../scenery";
import { volumeCloud } from "../procgen/volume";
import { cycleRamp, INK_RAMPS } from "../shading";
import { pixelHash } from "../transforms";

interface Cap {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly stem: number;
  readonly phase: number;
}

/** Caps around a foreshortened ellipse, because the ring lies on the ground. */
function ring(seed: number): Cap[] {
  const count = 5 + Math.floor(pixelHash(0, 0, seed, 1) * 3);
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2 + pixelHash(index, 0, seed, 2) * 0.5;
    return {
      x: Math.round(Math.cos(angle) * 11),
      // The ring is a circle on the ground, so its depth is foreshortened to
      // three quarters — the same ratio every ground shape in the game uses.
      y: Math.round(Math.sin(angle) * 4) - 2,
      radius: 2.4 + pixelHash(index, 0, seed, 3) * 1.8,
      stem: 2 + Math.round(pixelHash(index, 0, seed, 4) * 3),
      phase: pixelHash(index, 0, seed, 5),
    };
  });
}

class MushroomRing implements SceneryInstance {
  private readonly caps: readonly Cap[];

  constructor(private readonly seed: number) {
    this.caps = ring(seed);
  }

  cloud(env: SceneryEnv): PixelCloud {
    const detail = detailOf(env);
    const cloud: PixelCloud = [];
    // Painter's order down the screen, so a near cap covers the far one behind
    // it rather than the ring reading as a flat scatter.
    const sorted = [...this.caps].sort((a, b) => a.y - b.y);

    for (const cap of sorted) {
      for (let y = 0; y < cap.stem; y += 1) {
        cloud.push({ x: cap.x, y: cap.y - y, ink: "bone" });
      }
      const glow = cycleRamp(INK_RAMPS.arcane, env.elapsedMs / 260 + cap.phase * 4);
      const head = volumeCloud(
        {
          lobes: [{ x: cap.x, y: cap.y - cap.stem - cap.radius * 0.4, radius: cap.radius }],
          weld: 0.6,
          warp: { amplitudeX: 1.2, amplitudeY: 0.8, scale: 2.4, seed: this.seed, drift: 0, octaves: 1 },
        },
        {
          ramp: glow,
          light: env.light,
          ambient: 0.35,
          occlusion: 0.24,
          dither: detail.dither,
          normalEpsilon: detail.normalEpsilon,
          flat: detail.flat,
        },
      );
      for (const pixel of head) {
        cloud.push(pixel);
      }
    }
    return trimBelowGround(cloud);
  }
}

/** Caps sit on the ground; nothing may hang under it. */
function trimBelowGround(cloud: PixelCloud): PixelCloud {
  const bounds = cloudBounds(cloud);
  if (bounds === null) {
    return cloud;
  }
  return cloud.filter((pixel) => pixel.y <= 0);
}

export const MUSHROOM_RING: ScenerySpecies = {
  id: "mushroom-ring",
  kind: "prop",
  label: "Mushroom ring — cycled ramp",
  technique: "volume body + cycleRamp re-inking a static cloud per tick",
  notes:
    "The caps are the same lit volume the chestnut is. The glow is cycleRamp rotating the arcane " +
    "ramp's ink order per tick over a shape that never changes — the cheapest animation available, " +
    "and the recipe for anything that pulses instead of moving: runes, lava, enchanted weapons, " +
    "poison. Each cap's phase is offset so the ring shimmers around itself rather than blinking.",
  footprint: { width: 36, height: 20, originX: 18, originY: 17 },
  create: (seed) => new MushroomRing(seed),
};
