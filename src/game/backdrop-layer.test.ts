import { describe, expect, it } from "vitest";

import { OUTDOORS } from "./backdrop";
import { BackdropLayer } from "./backdrop-layer";
import { CAVE_AMBIENT, CAVE_BACKDROP } from "./cave-backdrop";
import { mixHex } from "./color";
import { beginTransition, DEFAULT_TRANSITION_MS } from "./horizon-transition";
import { CAVE } from "./realm";

const NOON = "#ffffff";

describe("BackdropLayer.ambientFor", () => {
  const layer = new BackdropLayer([CAVE_BACKDROP]);

  it("keeps the hour's light under the sky, and takes the cave's inside", () => {
    expect(layer.ambientFor(NOON, { current: OUTDOORS, transition: undefined }, 0)).toBe(NOON);
    expect(layer.ambientFor(NOON, { current: CAVE, transition: undefined }, 0)).toBe(CAVE_AMBIENT);
  });

  it("eases from one to the other across a change", () => {
    const transition = beginTransition(OUTDOORS, CAVE, "dissolve", 0);
    const state = { current: CAVE, transition };
    expect(layer.ambientFor(NOON, state, 0)).toBe(NOON);
    expect(layer.ambientFor(NOON, state, DEFAULT_TRANSITION_MS / 2)).toBe(mixHex(NOON, CAVE_AMBIENT, 0.5));
    expect(layer.ambientFor(NOON, state, DEFAULT_TRANSITION_MS)).toBe(CAVE_AMBIENT);
  });

  it("treats a backdrop it does not know as the sky", () => {
    expect(layer.ambientFor(NOON, { current: "nowhere", transition: undefined }, 0)).toBe(NOON);
  });
});
