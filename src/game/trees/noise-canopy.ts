/**
 * Species 3 — the crown as an **animated noise field**, thresholded per pixel.
 *
 * There is no foliage geometry at all. For every pixel in the crown's box the
 * species asks one question: is `falloff(x, y) * fbm(x, y, t)` above the leaf
 * threshold? Pixels just over it are leaf; pixels well over it are leaf in the
 * light; everything else is sky. The canopy's outline is therefore a level set
 * that never repeats and never has to be drawn.
 *
 * The wind enters twice, and the two are worth telling apart:
 *
 * - **Advection** — the noise domain is *scrolled* sideways, so the pattern
 *   travels through the crown. That is what a gust looks like crossing a tree:
 *   a wave of turning leaves, not a shape moving.
 * - **Displacement** — the whole crown is offset by a spring, so the mass
 *   leans. Advection without displacement looks like TV static in a bag;
 *   displacement without advection looks like a sprite being dragged.
 *
 * The third time axis (`t` in the fBm) is neither: it makes the field evolve in
 * place, which is the individual leaf flutter under the travelling gust.
 */

import { strokeLine, type PixelCloud } from "../ink";
import { fbm3 } from "../procgen/noise";
import { INK_RAMPS, rampInk } from "../shading";
import { createSway, stepSway, windAt, type Sway } from "../wind";
import { barkInk, rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const CROWN_Y = -30;
const CROWN_RX = 19;
const CROWN_RY = 13;
const LEAF_THRESHOLD = 0.52;

class NoiseCanopy implements SceneryInstance {
  private readonly crownSway: Sway;
  private readonly trunkSway: Sway;
  private lean = 0;
  private trunkLean = 0;

  constructor(private readonly seed: number) {
    this.crownSway = createSway({ frequency: 0.42, damping: 0.26, response: 4.2 });
    this.trunkSway = createSway({ frequency: 0.3, damping: 0.42, response: 1.8 });
  }

  step(dtMs: number, env: SceneryEnv): void {
    const drive = windAt(env.elapsedMs, env.fieldX, env.fieldY + CROWN_Y, env.wind);
    this.lean = stepSway(this.crownSway, dtMs, drive);
    this.trunkLean = stepSway(this.trunkSway, dtMs, drive);
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    this.drawTrunk(cloud);
    this.drawCrown(cloud, env);
    return rooted(cloud);
  }

  private drawTrunk(cloud: PixelCloud): void {
    const wood: PixelCloud = [];
    const lean = Math.round(this.trunkLean);
    strokeLine(wood, { x: 0, y: -1 }, { x: lean, y: CROWN_Y + 6 }, "steel", 3);
    strokeLine(wood, { x: lean, y: CROWN_Y + 8 }, { x: lean - 8, y: CROWN_Y - 1 }, "steel", 2);
    strokeLine(wood, { x: lean, y: CROWN_Y + 8 }, { x: lean + 9, y: CROWN_Y + 1 }, "steel", 2);
    for (const pixel of wood) {
      cloud.push({ x: pixel.x, y: pixel.y, ink: barkInk(pixel.x, pixel.y, this.seed, INK_RAMPS.bone) });
    }
  }

  private drawCrown(cloud: PixelCloud, env: SceneryEnv): void {
    const centreX = Math.round(this.lean);
    // The travelling term: subtracting from the sample x scrolls the pattern
    // downwind through a crown that is itself only leaning.
    const scroll = env.elapsedMs / 260 + this.lean * 3;
    for (let y = CROWN_Y - CROWN_RY; y <= CROWN_Y + CROWN_RY; y += 1) {
      for (let x = centreX - CROWN_RX; x <= centreX + CROWN_RX; x += 1) {
        const density = this.densityAt(x - centreX, y, scroll, env.elapsedMs);
        if (density < LEAF_THRESHOLD) {
          continue;
        }
        // Spread over a wide window and biased low: bone is a highlight on a
        // handful of top leaves, never the body of the canopy.
        const level = Math.min(Math.max((density - LEAF_THRESHOLD) / 0.85, 0), 1);
        cloud.push({ x, y, ink: rampInk(INK_RAMPS.canopy, level, { x, y }) });
      }
    }
  }

  private densityAt(dx: number, y: number, scroll: number, elapsedMs: number): number {
    const dy = y - CROWN_Y;
    // A soft-shouldered ellipse rather than a hard one: raising the falloff to
    // a power keeps the middle solid and lets only the rim be eaten by noise,
    // which is the difference between a canopy and a cloud of leaves.
    const radial = 1 - ((dx * dx) / (CROWN_RX * CROWN_RX) + (dy * dy) / (CROWN_RY * CROWN_RY));
    if (radial <= 0) {
      return 0;
    }
    const falloff = Math.min(radial * 1.35, 1) ** 0.8;
    const churn = fbm3((dx - scroll) / 4.6, dy / 3.4, elapsedMs / 900, this.seed, { octaves: 3 });
    // Light from above: the top of the mass is brighter before the ramp is
    // even consulted, which is cheaper than a second shading pass and reads
    // the same at four ink steps.
    const overhead = 0.1 * (1 - (dy + CROWN_RY) / (CROWN_RY * 2));
    // Weighted toward the noise, so the rim is torn rather than elliptical.
    return falloff * (0.3 + churn * 0.85) + overhead;
  }
}

export const NOISE_CANOPY: ScenerySpecies = {
  id: "noise-canopy",
  kind: "tree",
  label: "Beech — noise-field canopy",
  technique: "3-octave fBm thresholded per pixel, domain scrolled by the wind",
  notes:
    "No foliage geometry: every crown pixel is a threshold test against fBm. The domain scrolls " +
    "downwind so a gust crosses the tree as a wave of turning leaves, a spring leans the whole " +
    "mass, and the noise's own time axis flutters it in place. Three separate motions, no frames.",
  footprint: { width: 78, height: 56, originX: 39, originY: 55 },
  create: (seed) => new NoiseCanopy(seed),
};
