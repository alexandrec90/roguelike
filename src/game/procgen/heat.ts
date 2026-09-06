/**
 * Heat spreading over a graph: the burning birch, generalised to anything.
 *
 * The birch's fire was a number per limb and a three-line rule — a hot node
 * heats its neighbours, burns its fuel, and goes to char. Nothing in that rule
 * is about branches. Hand it any graph of nodes with neighbours and fuel and it
 * is the same fire: a bush's lobes, a signpost's planks, a grid of grass cells,
 * the pixels of a corpse, the rungs of a ladder.
 *
 * That is why it lives here rather than in the tree. When the player throws
 * fire at something, the question "does this burn, and how does the flame move
 * across it" should have one answer in the codebase, and adding a burnable
 * object should be a matter of saying what its nodes are — which is what
 * `burnable.ts` does for anything that can produce a pixel cloud.
 *
 * It is also the first working piece of the effect field described in
 * `procedural-effects.md`: `wet` is already a term in the rule, so rain
 * fighting a fire is a value, not a new system.
 */

export interface HeatNode {
  /** Indices of the nodes this one can pass heat to. Usually symmetric. */
  readonly neighbours: readonly number[];
  /** How long it burns once alight. Zero is non-combustible — stone, metal, water. */
  readonly fuel: number;
  /**
   * How hard it is to light, from 0 (tinder) up. Thin twigs are near zero and
   * catch instantly; a wet trunk is high and smoulders for a long time.
   */
  readonly resistance: number;
}

export interface HeatField {
  readonly nodes: readonly HeatNode[];
  /** 0..1 per node. Above `IGNITION` the node is alight. */
  readonly heat: number[];
  /** Remaining fuel per node; at zero the node is spent and goes to char. */
  readonly fuel: number[];
}

/** Heat above this and a node is alight: spreading, glowing, shedding embers. */
export const IGNITION = 0.34;

export interface HeatOptions {
  /** Fuel consumed per millisecond by an alight node. */
  readonly burnRate?: number;
  /** Heat delivered per millisecond to a neighbour, before resistance. */
  readonly spreadRate?: number;
  /**
   * Wetness per node, 0..1, or a constant. Divides the heat a node receives and
   * bleeds heat away from one already alight — which is rain putting a fire out
   * rather than a separate extinguishing system.
   */
  readonly wet?: number | ((index: number) => number);
  /** Longest delta integrated in one call. */
  readonly maxStepMs?: number;
}

const DEFAULTS: Required<Omit<HeatOptions, "wet">> = {
  burnRate: 0.00007,
  spreadRate: 0.00045,
  maxStepMs: 100,
};

export function createHeat(nodes: readonly HeatNode[], ignited: readonly number[] = []): HeatField {
  const heat = nodes.map(() => 0);
  const fuel = nodes.map((node) => node.fuel);
  for (const index of ignited) {
    if (index >= 0 && index < heat.length) {
      heat[index] = 1;
    }
  }
  return { nodes, heat, fuel };
}

/** Set a node alight — a fire spell landing, a torch touched to kindling. */
export function ignite(field: HeatField, index: number, amount = 1): void {
  const current = field.heat[index];
  if (current === undefined) {
    return;
  }
  field.heat[index] = Math.min(1, current + amount);
}

/**
 * Advance the fire.
 *
 * Double-buffered: every node reads this step's heat and writes the next
 * step's, so the fire spreads at the same rate in every direction. Updating in
 * place instead makes it race down whichever way the node indices happen to
 * run, which on a tree means the flame always climbs toward higher-numbered
 * limbs and looks like it is being pulled rather than spreading.
 */
export function stepHeat(field: HeatField, dtMs: number, options: HeatOptions = {}): void {
  const { burnRate, spreadRate, maxStepMs } = { ...DEFAULTS, ...options };
  const delta = Math.min(Math.max(dtMs, 0), maxStepMs);
  if (delta === 0) {
    return;
  }
  const wetAt = wetness(options.wet);
  const next = [...field.heat];

  field.heat.forEach((heat, index) => {
    const node = field.nodes[index];
    if (node === undefined) {
      return;
    }
    const wet = wetAt(index);
    // Every branch reads `next[index]`, never `heat`, because a neighbour
    // earlier in this same pass may already have deposited heat there. Writing
    // `heat` back would erase it, and the fire would never spread from a node
    // to any higher-indexed neighbour at all — which is precisely what happened
    // and what the "travels along the graph" test now pins down.
    const carried = next[index] ?? heat;
    if (heat <= IGNITION) {
      // A damp node loses what little heat it has picked up, which is why rain
      // stops a fire from starting rather than only from spreading.
      next[index] = Math.max(0, carried - wet * 0.0004 * delta);
      return;
    }
    const remaining = field.fuel[index] ?? 0;
    if (remaining <= 0) {
      next[index] = Math.max(0, carried - burnRate * delta * 3);
      return;
    }
    field.fuel[index] = remaining - burnRate * delta * (1 + wet);
    spread(field, next, index, { delta, spreadRate, wetAt });
  });

  next.forEach((value, index) => {
    field.heat[index] = Math.min(1, Math.max(0, value));
  });
}

interface SpreadTerms {
  readonly delta: number;
  readonly spreadRate: number;
  readonly wetAt: (index: number) => number;
}

/**
 * Deliver heat to every neighbour, symmetrically.
 *
 * An earlier version damped the spread toward lower-numbered nodes, meaning to
 * express "fire climbs outward faster than it runs back down the trunk". That
 * is a real effect, but array index order is not what encodes it — for a graph
 * that is not a tree it means nothing at all, and even for a tree it is an
 * accident of how the skeleton was built. **Resistance already says it
 * properly**: a thick trunk resists, thin twigs do not, so the flame runs to
 * the extremities because of what they are made of rather than because of where
 * they sit in an array.
 */
function spread(field: HeatField, next: number[], index: number, terms: SpreadTerms): void {
  const node = field.nodes[index];
  if (node === undefined) {
    return;
  }
  for (const neighbour of node.neighbours) {
    const target = field.nodes[neighbour];
    if (target === undefined || target.fuel <= 0) {
      continue;
    }
    const gain =
      (terms.spreadRate * terms.delta) /
      (Math.max(0.4, 1 + target.resistance) * (1 + terms.wetAt(neighbour) * 4));
    next[neighbour] = (next[neighbour] ?? 0) + gain;
  }
}

function wetness(wet: HeatOptions["wet"]): (index: number) => number {
  if (wet === undefined) {
    return () => 0;
  }
  if (typeof wet === "number") {
    return () => Math.min(Math.max(wet, 0), 1);
  }
  return (index) => Math.min(Math.max(wet(index), 0), 1);
}

export function isAlight(field: HeatField, index: number): boolean {
  return (field.heat[index] ?? 0) > IGNITION;
}

/** Spent means burnt out: the node has a silhouette but no fuel and no glow. */
export function isSpent(field: HeatField, index: number): boolean {
  return (field.fuel[index] ?? 0) <= 0;
}

export function alightNodes(field: HeatField): number[] {
  const alight: number[] = [];
  field.heat.forEach((heat, index) => {
    if (heat > IGNITION) {
      alight.push(index);
    }
  });
  return alight;
}

/** How far the fire has got, 0..1 — for scorch reach, smoke volume, scoring. */
export function burnProgress(field: HeatField): number {
  const total = field.nodes.reduce((sum, node) => sum + node.fuel, 0);
  if (total === 0) {
    return 0;
  }
  const left = field.fuel.reduce((sum, value) => sum + Math.max(0, value), 0);
  return Math.min(Math.max(1 - left / total, 0), 1);
}
