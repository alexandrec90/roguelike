import { describe, expect, it } from "vitest";

import {
  alightNodes,
  burnProgress,
  createHeat,
  ignite,
  IGNITION,
  isAlight,
  isSpent,
  stepHeat,
  type HeatField,
  type HeatNode,
} from "./heat";

/** A line of identical nodes: the simplest thing a fire can travel along. */
function chain(length: number, fuel = 2, resistance = 0.5): HeatNode[] {
  return Array.from({ length }, (_unused, index) => ({
    neighbours: [index - 1, index + 1].filter((n) => n >= 0 && n < length),
    fuel,
    resistance,
  }));
}

function burn(field: HeatField, totalMs: number, options = {}): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 16) {
    stepHeat(field, 16, options);
  }
}

describe("creating a heat field", () => {
  it("starts cold, with each node holding its own fuel", () => {
    const field = createHeat(chain(4, 3));
    expect(field.heat).toEqual([0, 0, 0, 0]);
    expect(field.fuel).toEqual([3, 3, 3, 3]);
  });

  it("lights the nodes it was told to", () => {
    const field = createHeat(chain(4), [2]);
    expect(isAlight(field, 2)).toBe(true);
    expect(isAlight(field, 0)).toBe(false);
  });

  it("ignores an ignition index that is not a node", () => {
    expect(() => createHeat(chain(2), [99, -1])).not.toThrow();
  });
});

describe("spreading", () => {
  it("travels along the graph, one neighbour at a time", () => {
    const field = createHeat(chain(6), [0]);
    burn(field, 1500);
    const reached = alightNodes(field);
    expect(reached).toContain(1);
    expect(reached).not.toContain(5);
    burn(field, 4000);
    expect(alightNodes(field).length).toBeGreaterThan(reached.length);
  });

  it("cannot reach a node the graph does not connect", () => {
    const island: HeatNode[] = [
      { neighbours: [1], fuel: 2, resistance: 0 },
      { neighbours: [0], fuel: 2, resistance: 0 },
      { neighbours: [], fuel: 2, resistance: 0 },
    ];
    const field = createHeat(island, [0]);
    burn(field, 6000);
    expect(isAlight(field, 2)).toBe(false);
  });

  it("catches faster where resistance is lower — twigs before trunks", () => {
    const timeToLight = (resistance: number): number => {
      const field = createHeat(
        [
          { neighbours: [1], fuel: 5, resistance: 0 },
          { neighbours: [0], fuel: 5, resistance },
        ],
        [0],
      );
      for (let elapsed = 0; elapsed < 20_000; elapsed += 16) {
        stepHeat(field, 16);
        if (isAlight(field, 1)) {
          return elapsed;
        }
      }
      return Number.POSITIVE_INFINITY;
    };
    expect(timeToLight(0)).toBeLessThan(timeToLight(4));
  });

  it("never lights a node with no fuel, however long the fire sits on it", () => {
    const stone: HeatNode[] = [
      { neighbours: [1], fuel: 4, resistance: 0 },
      { neighbours: [0], fuel: 0, resistance: 8 },
    ];
    const field = createHeat(stone, [0]);
    burn(field, 20_000);
    expect(isAlight(field, 1)).toBe(false);
  });

  it("spreads evenly in both directions rather than racing down the indices", () => {
    // Double buffering is what this asserts: updating in place makes the fire
    // run toward higher indices and look pulled rather than spreading.
    const field = createHeat(chain(9), [4]);
    burn(field, 2500);
    const alight = alightNodes(field);
    const below = alight.filter((index) => index < 4).length;
    const above = alight.filter((index) => index > 4).length;
    expect(Math.abs(below - above)).toBeLessThanOrEqual(1);
  });
});

describe("burning out", () => {
  it("consumes fuel and goes to char, keeping the node in the graph", () => {
    const field = createHeat(chain(2, 0.4), [0]);
    burn(field, 20_000);
    expect(isSpent(field, 0)).toBe(true);
    expect(isAlight(field, 0)).toBe(false);
    expect(field.nodes).toHaveLength(2);
  });

  it("reports how far the fire has got", () => {
    const field = createHeat(chain(5, 1), [0]);
    expect(burnProgress(field)).toBe(0);
    burn(field, 12_000);
    const part = burnProgress(field);
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThanOrEqual(1);
  });

  it("reports zero progress for a graph that cannot burn at all", () => {
    expect(burnProgress(createHeat(chain(3, 0)))).toBe(0);
  });
});

describe("water fighting fire", () => {
  it("slows the spread when the fuel is wet", () => {
    const spreadBy = (wet: number): number => {
      const field = createHeat(chain(8), [0]);
      burn(field, 4000, { wet });
      return alightNodes(field).length;
    };
    expect(spreadBy(1)).toBeLessThan(spreadBy(0));
  });

  it("bleeds heat out of a node that has not caught yet", () => {
    const field = createHeat(chain(3), []);
    ignite(field, 1, IGNITION * 0.8);
    burn(field, 3000, { wet: 1 });
    expect(field.heat[1] ?? 1).toBeLessThan(IGNITION * 0.8);
  });

  it("takes wetness per node, so one damp branch stops a fire", () => {
    const field = createHeat(chain(5), [0]);
    burn(field, 6000, { wet: (index: number) => (index === 2 ? 1 : 0) });
    expect(isAlight(field, 4)).toBe(false);
  });
});

describe("stepping", () => {
  it("clamps a backgrounded tab's delta instead of burning the tree down", () => {
    const field = createHeat(chain(8), [0]);
    stepHeat(field, 120_000);
    expect(alightNodes(field).length).toBeLessThan(4);
  });

  it("does nothing for a zero delta", () => {
    const field = createHeat(chain(4), [0]);
    const before = JSON.stringify(field.heat);
    stepHeat(field, 0);
    expect(JSON.stringify(field.heat)).toBe(before);
  });

  it("is reproducible", () => {
    const trace = (): string => {
      const field = createHeat(chain(10), [0]);
      burn(field, 5000);
      return JSON.stringify(field.heat);
    };
    expect(trace()).toBe(trace());
  });
});
