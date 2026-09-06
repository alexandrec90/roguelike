/**
 * Species 6 — a **cellular automaton** burning up a tree, with embers on a flow
 * field. The Noita-shaped one: the fire is state in the world, not an overlay.
 *
 * Every limb of a grown skeleton carries one number, its heat. The rule is
 * three lines: a hot limb heats its neighbours in the graph, heat decays, and a
 * limb whose fuel runs out goes to char. Fire therefore *climbs* the tree along
 * its actual structure — up the trunk, out along whichever limb is thickest,
 * stalling where the branch is thin — and it is impossible for the flame to be
 * somewhere the tree is not, because the automaton has no coordinates of its
 * own.
 *
 * Everything visible falls out of that one number: the ink is an ember ramp
 * indexed by heat, the ember motes spawn from limbs above the ignition
 * threshold and rise on a curl field, and the scorch under the tree is a decal
 * grown from total heat delivered.
 *
 * The point of building it this way is the extension: rain wetting a limb is a
 * term in the same rule, a fire spell is an injection into it, and neither
 * needs new art.
 */

import { strokeLine, type InkId, type PixelCloud } from "../ink";
import { curlFlow } from "../procgen/noise";
import { growSkeleton, type Limb } from "../procgen/growth";
import {
  alightNodes,
  createHeat,
  isAlight,
  isSpent,
  stepHeat,
  type HeatField,
  type HeatNode,
} from "../procgen/heat";
import { createMotes, moteCloud, stepMotes, type MoteField } from "../procgen/motes";
import { INK_RAMPS, rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { windAt } from "../wind";
import { emberInk } from "../burnable";
import { rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

class EmberBirch implements SceneryInstance {
  private readonly limbs: readonly Limb[];
  private readonly fire: HeatField;
  private readonly embers: MoteField;

  constructor(private readonly seed: number) {
    this.limbs = growSkeleton({
      seed: seed + 3,
      crownY: -27,
      crownRadiusX: 12,
      crownRadiusY: 10,
      attractors: 120,
      maxLimbs: 180,
      tropism: 0.42,
    });
    // The skeleton *is* the heat graph: a limb's neighbours are its parent and
    // its children, so the fire can only travel where the wood goes. Thickness
    // becomes both fuel and resistance, which is why the flame runs out to the
    // twigs in a second and sits on the trunk for half a minute.
    this.fire = createHeat(branchNodes(this.limbs), [0]);
    this.embers = createMotes({
      capacity: 46,
      seed: seed ^ 0xe3b,
      lifeMs: 780,
      lifeJitterMs: 620,
      spawnIntervalMs: 26,
      gravity: -0.000055,
      drag: 0.9982,
    });
  }

  step(dtMs: number, env: SceneryEnv): void {
    // Rain fights the fire because wetness is a term in the shared rule, not
    // because this species knows anything about weather.
    stepHeat(this.fire, dtMs, { wet: env.weather?.rain ?? 0 });
    const alight = alightNodes(this.fire)
      .map((index) => ({ index, limb: this.limbs[index] }))
      .filter((entry): entry is { index: number; limb: Limb } => entry.limb !== undefined);

    const gust = windAt(env.elapsedMs, env.fieldX, env.fieldY - 20, env.wind);
    stepMotes(this.embers, dtMs, {
      spawn: (roll) => {
        const pick = alight[Math.floor(roll() * alight.length)];
        if (pick === undefined) {
          return null;
        }
        return { x: pick.limb.x + (roll() - 0.5) * 2, y: pick.limb.y, vy: -0.004 - roll() * 0.006 };
      },
      // A curl field is what stops a column of embers reading as a fountain:
      // they circulate in the thermal instead of all going the same way up.
      force: (mote) => {
        const swirl = curlFlow(mote.x / 9, mote.y / 9, env.elapsedMs / 1100, this.seed, 0.5);
        return { x: swirl.x * 0.00016 + gust * 0.00002, y: swirl.y * 0.00012 };
      },
    });
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    this.scorch(cloud);
    this.limbs.forEach((limb, index) => {
      const parent = limb.parent < 0 ? undefined : this.limbs[limb.parent];
      if (parent === undefined) {
        return;
      }
      const heat = this.fire.heat[index] ?? 0;
      const spent = isSpent(this.fire, index);
      const wood: PixelCloud = [];
      strokeLine(
        wood,
        { x: Math.round(parent.x), y: Math.round(parent.y) },
        { x: Math.round(limb.x), y: Math.round(limb.y) },
        "steel",
        limb.thickness > 1.6 ? 3 : limb.thickness > 0.9 ? 2 : 1,
      );
      // The flame's flicker is a per-frame reroll of the hash's salt, which is
      // the cheapest animation in the file and the only one that should be
      // allowed to be this fast.
      const flicker = Math.floor(env.elapsedMs / 90);
      for (const pixel of wood) {
        cloud.push({
          x: pixel.x,
          y: pixel.y,
          ink: limbInk(pixel, heat, spent, this.seed + flicker, isAlight(this.fire, index)),
        });
      }
    });
    for (const pixel of moteCloud(this.embers, INK_RAMPS.ember)) {
      cloud.push(pixel);
    }
    return rooted(cloud);
  }

  /** A decal, not a sprite: total heat delivered decides how far the char reaches. */
  private scorch(cloud: PixelCloud): void {
    const burnt = alightNodes(this.fire).length;
    const reach = Math.min(3 + burnt * 0.35, 13);
    for (let x = -reach; x <= reach; x += 1) {
      for (let y = -Math.round(reach * 0.4); y <= 0; y += 1) {
        const distance = Math.hypot(x / reach, y / (reach * 0.4));
        if (distance > 1 || pixelHash(x, y, this.seed, 21) < distance * 0.85) {
          continue;
        }
        cloud.push({ x, y, ink: distance > 0.72 ? "deep" : "void" });
      }
    }
  }
}

/** Char, ember or unburnt wood — one ramp lookup off the automaton's number. */
function limbInk(
  at: { readonly x: number; readonly y: number },
  heat: number,
  spent: boolean,
  seed: number,
  alight: boolean,
): InkId {
  const { x, y } = at;
  if (!alight) {
    // Char is deep, not void. A burnt limb still has a silhouette, and drawing
    // it in the background colour deletes the tree rather than blackening it --
    // which is what the screen showed and no unit test could.
    return spent ? "deep" : rampInk(INK_RAMPS.bone, 0.08 + pixelHash(x, y, seed, 4) * 0.3, { x, y });
  }
  // One rule for what fire looks like, shared with every other burning thing.
  return emberInk(at, heat, seed);
}

/** Parent and children as neighbours; thickness as fuel and as resistance. */
function branchNodes(limbs: readonly Limb[]): HeatNode[] {
  const children: number[][] = limbs.map(() => []);
  limbs.forEach((limb, index) => {
    children[limb.parent]?.push(index);
  });
  return limbs.map((limb, index) => ({
    neighbours: [...(children[index] ?? []), ...(limb.parent >= 0 ? [limb.parent] : [])],
    fuel: 0.5 + limb.thickness * 0.9,
    resistance: limb.thickness * 0.8,
  }));
}

export const EMBER_BIRCH: ScenerySpecies = {
  id: "ember-birch",
  kind: "tree",
  label: "Birch — burning (automaton)",
  technique: "heat automaton over the branch graph + curl-field embers + scorch decal",
  notes:
    "One number per limb. A hot limb heats its neighbours, burns its fuel and goes to char, so the " +
    "fire climbs the tree's real structure — fast into thin twigs, slow on the trunk. Embers spawn " +
    "only from limbs that are actually alight and rise on a curl field so the column circulates. " +
    "Rain wetting a limb would be one more term in the same rule.",
  footprint: { width: 70, height: 54, originX: 35, originY: 53 },
  create: (seed) => new EmberBirch(seed),
};
