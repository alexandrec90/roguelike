/**
 * A bush: the same volumetric body, small, springy, and **burnable**.
 *
 * This is the prop that demonstrates the two halves of the answer together. Its
 * shape and light come from `procgen/volume.ts` — the chestnut's mechanism at a
 * quarter of the size — and its fire comes from `burnable.ts`, which builds a
 * heat graph over whatever pixels the body happens to have produced.
 *
 * The bush never says which pixel is a twig and which is a leaf. `burnable.ts`
 * reads that off the **ink**: pixels drawn from the canopy ramp catch instantly
 * and burn out fast, the darker interior is slower, and the fire crawls the
 * body's real occupancy rather than a bounding box. Setting a new prop alight
 * is therefore not a feature that has to be built per prop — it is `ignite`,
 * and the object burns the way its materials say it should.
 *
 * Left alone it just sways. `ignite()` is what a fire spell calls.
 */

import type { PixelCloud } from "../ink";
import {
  burnInk,
  burningPoints,
  igniteAt,
  makeBurnable,
  stepBurn,
  type Burnable,
} from "../burnable";
import { detailOf, type SceneryEnv, type SceneryInstance, type ScenerySpecies } from "../scenery";
import { curlFlow } from "../procgen/noise";
import { createMotes, moteCloud, stepMotes, type MoteField } from "../procgen/motes";
import { lobeRing, volumeCloud, type Lobe } from "../procgen/volume";
import { INK_RAMPS } from "../shading";
import { createSway, stepSway, windAt, type Sway } from "../wind";

class Bush implements SceneryInstance {
  private readonly lobes: readonly Lobe[];
  private readonly sway: Sway;
  private readonly embers: MoteField;
  private burning: Burnable | null = null;
  private lean = 0;

  constructor(private readonly seed: number) {
    this.lobes = lobeRing(4, { x: 0, y: -7, radiusX: 6, radiusY: 3.5 }, { min: 4, max: 6.5 }, seed);
    // A bush is small and stiff: it shivers rather than swinging.
    this.sway = createSway({ frequency: 1.1, damping: 0.4, response: 1.1 });
    this.embers = createMotes({
      capacity: 30,
      seed: seed ^ 0x8f2,
      lifeMs: 620,
      lifeJitterMs: 420,
      spawnIntervalMs: 34,
      gravity: -0.00006,
      drag: 0.998,
    });
  }

  /** Light it. This is what a fire spell landing on the bush calls. */
  ignite(x = 0, y = -7): void {
    this.burning ??= makeBurnable(this.render(0, { x: -0.6, y: -0.8 }), {
      cellSize: 3,
      seed: this.seed,
    });
    igniteAt(this.burning, x, y);
  }

  get alight(): boolean {
    return this.burning !== null && burningPoints(this.burning).length > 0;
  }

  step(dtMs: number, env: SceneryEnv): void {
    this.lean = stepSway(this.sway, dtMs, windAt(env.elapsedMs, env.fieldX, env.fieldY - 7, env.wind));
    if (this.burning === null) {
      return;
    }
    stepBurn(this.burning, dtMs, { wet: env.weather?.rain ?? 0 });
    const points = burningPoints(this.burning);
    stepMotes(this.embers, dtMs, {
      spawn: (roll) => {
        const at = points[Math.floor(roll() * points.length)];
        return at === undefined ? null : { x: at.x, y: at.y, vy: -0.004 - roll() * 0.005 };
      },
      force: (mote) => {
        const swirl = curlFlow(mote.x / 7, mote.y / 7, env.elapsedMs / 950, this.seed, 0.5);
        return { x: swirl.x * 0.00014, y: swirl.y * 0.0001 };
      },
    });
  }

  cloud(env: SceneryEnv): PixelCloud {
    const body = this.render(this.lean, env.light, env);
    if (this.burning === null) {
      return body;
    }
    const burnt = burnInk(this.burning, body, env.elapsedMs);
    for (const pixel of moteCloud(this.embers, INK_RAMPS.ember)) {
      burnt.push(pixel);
    }
    return burnt;
  }

  private render(
    lean: number,
    light: { readonly x: number; readonly y: number },
    env?: SceneryEnv,
  ): PixelCloud {
    const detail = env === undefined ? detailOf({} as SceneryEnv) : detailOf(env);
    return volumeCloud(
      {
        lobes: this.lobes.map((lobe) => ({ ...lobe, x: lobe.x + lean })),
        weld: 1.6,
        warp: {
          amplitudeX: 3.4,
          amplitudeY: 2.6,
          scale: 3.2,
          seed: this.seed,
          drift: (env?.elapsedMs ?? 0) / 1100 + lean * 0.5,
          octaves: detail.warpOctaves,
        },
      },
      {
        ramp: INK_RAMPS.canopy,
        light,
        ambient: 0.06,
        occlusion: 0.2,
        dither: detail.dither,
        normalEpsilon: detail.normalEpsilon,
        flat: detail.flat,
      },
      { bottom: 0 },
    );
  }
}

/** Narrowed handle for the callers that need to set one alight. */
export type BushInstance = SceneryInstance & { ignite: (x?: number, y?: number) => void; alight: boolean };

export const BUSH: ScenerySpecies = {
  id: "bush",
  kind: "prop",
  label: "Bush — SDF body, burnable",
  technique: "volume body + burnable.ts heat graph over its own pixels",
  notes:
    "The chestnut's body at a quarter scale, on a stiff fast spring so it shivers instead of " +
    "swinging. Its fire is not built into it: burnable.ts lays a graph over whatever pixels it " +
    "drew and reads how readily each cell burns off the ink, so leaves catch instantly and the " +
    "dark interior smoulders. Rain is a term in the same rule. Any object that can produce a " +
    "cloud can be set alight this way — including the hero.",
  footprint: { width: 36, height: 24, originX: 18, originY: 21 },
  create: (seed) => new Bush(seed),
};
