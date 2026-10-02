import { describe, expect, it } from "vitest";

import {
  aimAt,
  createControls,
  currentAim,
  heldHeading,
  isHeld,
  nextHeading,
  pressButton,
  pressKey,
  releaseAll,
  releaseButton,
  releaseKey,
  spendAttack,
  spendCast,
  spendEnchant,
  spendHeading,
  wantsAttack,
  wantsCast,
  wantsEnchant,
} from "./controls";
import { DEFAULT_KEYBINDINGS, type Keybindings } from "./keybindings";
import { facingYaw } from "./player";
import { DEPTH_RATIO } from "./projection";

describe("aiming", () => {
  it("aims nowhere until the pointer first moves", () => {
    expect(currentAim(createControls())).toBeUndefined();
  });

  it("aims at the cursor, and keeps aiming there once it stops moving", () => {
    const controls = createControls();
    aimAt(controls, 0, 40);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("south"), 9);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("south"), 9);
    aimAt(controls, -30, -30 * DEPTH_RATIO);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("northwest"), 9);
  });

  it("is not snapped to the eight headings: the cursor is free", () => {
    const controls = createControls();
    // Ten degrees off east on the ground, which the eight would have rounded away.
    const angle = (10 * Math.PI) / 180;
    aimAt(controls, Math.cos(angle), Math.sin(angle) * DEPTH_RATIO);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("east") - angle, 9);
  });

  it("measures the angle on the ground, not on the foreshortened screen", () => {
    const controls = createControls();
    // Equal on the ground is squashed on screen: this reads as a true diagonal.
    aimAt(controls, 20, 20 * DEPTH_RATIO);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("southeast"), 9);
    // 10 across and 20 down is 63 degrees below level on screen, but 26.7 down
    // on the ground: steeper, so nearer to facing the viewer.
    aimAt(controls, 10, 20);
    expect(currentAim(controls)).toBeCloseTo(Math.atan2(10, 20 / DEPTH_RATIO), 9);
    expect(currentAim(controls)).toBeLessThan(Math.atan2(10, 20));
  });

  it("keeps its aim with the cursor dead on his chest", () => {
    const controls = createControls();
    aimAt(controls, 5, 0);
    aimAt(controls, 0, 0);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("east"), 9);
  });

  it("survives the window losing focus, because nothing was held", () => {
    const controls = createControls();
    aimAt(controls, -5, 0);
    releaseAll(controls);
    expect(currentAim(controls)).toBeCloseTo(facingYaw("west"), 9);
  });

  it("does not move the legs", () => {
    const controls = createControls();
    aimAt(controls, 10, 0);
    expect(nextHeading(controls)).toBeUndefined();
  });
});

describe("holding a direction", () => {
  it("holds it until it is released", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    expect(heldHeading(controls)).toBe("east");
    releaseKey(controls, "KeyD");
    expect(heldHeading(controls)).toBeUndefined();
  });

  it("reads an arrow key as the same action as its letter", () => {
    const controls = createControls();
    pressKey(controls, "ArrowLeft");
    expect(heldHeading(controls)).toBe("west");
  });

  it("does not release an action a second source is still holding", () => {
    const controls = createControls();
    pressKey(controls, "KeyA");
    pressKey(controls, "ArrowLeft");
    releaseKey(controls, "KeyA");
    expect(heldHeading(controls)).toBe("west");
    releaseKey(controls, "ArrowLeft");
    expect(heldHeading(controls)).toBeUndefined();
  });

  it("adds a second axis to the first rather than taking the field from it", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyW");
    expect(heldHeading(controls)).toBe("northeast");
    releaseKey(controls, "KeyW");
    expect(heldHeading(controls)).toBe("east");
  });

  it("ignores the keyboard's auto-repeat: a held key is one press", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyW");
    pressKey(controls, "KeyD"); // OS repeat, not a new press
    expect(heldHeading(controls)).toBe("northeast");
  });

  it("says whether it took the input, so an unbound key keeps its browser job", () => {
    const controls = createControls();
    expect(pressKey(controls, "KeyW")).toBe(true);
    expect(pressKey(controls, "F5")).toBe(false);
    expect(releaseKey(controls, "F5")).toBe(false);
  });
});

describe("two directions at once", () => {
  it("reads up and right as one diagonal, whichever went down first", () => {
    const first = createControls();
    pressKey(first, "KeyW");
    pressKey(first, "KeyD");
    expect(heldHeading(first)).toBe("northeast");

    const second = createControls();
    pressKey(second, "ArrowRight");
    pressKey(second, "ArrowUp");
    expect(heldHeading(second)).toBe("northeast");
  });

  it("covers all four diagonals", () => {
    const corners: readonly (readonly [string, string, string])[] = [
      ["KeyW", "KeyD", "northeast"],
      ["KeyW", "KeyA", "northwest"],
      ["KeyS", "KeyD", "southeast"],
      ["KeyS", "KeyA", "southwest"],
    ];
    for (const [vertical, horizontal, heading] of corners) {
      const controls = createControls();
      pressKey(controls, vertical);
      pressKey(controls, horizontal);
      expect(heldHeading(controls)).toBe(heading);
    }
  });

  it("keeps newest-wins within one axis, so opposites do not cancel", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyA");
    expect(heldHeading(controls)).toBe("west");
    releaseKey(controls, "KeyA");
    expect(heldHeading(controls)).toBe("east");
  });

  it("resolves each axis on its own when three keys are down", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyA");
    // North is unopposed; west is the newer of the two horizontals.
    expect(heldHeading(controls)).toBe("northwest");
  });

  it("falls back to the surviving cardinal when one axis is released", () => {
    const controls = createControls();
    pressKey(controls, "ArrowDown");
    pressKey(controls, "ArrowLeft");
    expect(heldHeading(controls)).toBe("southwest");
    releaseKey(controls, "ArrowDown");
    expect(heldHeading(controls)).toBe("west");
    releaseKey(controls, "ArrowLeft");
    expect(heldHeading(controls)).toBeUndefined();
  });
});

describe("a direction tapped faster than a frame", () => {
  it("still owes a step after the key is already back up", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    releaseKey(controls, "KeyW");
    // Both events landed between two `update` calls: nothing is held now.
    expect(heldHeading(controls)).toBeUndefined();
    expect(nextHeading(controls)).toBe("north");
  });

  it("is owed exactly once — the frame that walks it clears the debt", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    releaseKey(controls, "KeyD");
    spendHeading(controls);
    expect(nextHeading(controls)).toBeUndefined();
  });

  it("never overrides the key the player is leaning on", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    releaseKey(controls, "KeyW");
    pressKey(controls, "KeyS");
    expect(nextHeading(controls)).toBe("south");
    releaseKey(controls, "KeyS");
    expect(nextHeading(controls)).toBe("south");
  });

  it("is dropped by a lost focus, like everything else held", () => {
    const controls = createControls();
    pressKey(controls, "ArrowUp");
    releaseKey(controls, "ArrowUp");
    releaseAll(controls);
    expect(nextHeading(controls)).toBeUndefined();
  });

  it("joins two taps in the same frame into the diagonal they mean", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    pressKey(controls, "KeyD");
    releaseKey(controls, "KeyW");
    releaseKey(controls, "KeyD");
    expect(heldHeading(controls)).toBeUndefined();
    expect(nextHeading(controls)).toBe("northeast");
  });

  it("lets a later tap reverse the axis it shares, and leave the other alone", () => {
    const controls = createControls();
    for (const code of ["KeyW", "KeyD", "KeyS"]) {
      pressKey(controls, code);
      releaseKey(controls, code);
    }
    // North was owed, then east joined it, then south took the vertical back.
    expect(nextHeading(controls)).toBe("southeast");
  });

  it("is not created by the attack key", () => {
    const controls = createControls();
    pressKey(controls, "Space");
    expect(nextHeading(controls)).toBeUndefined();
  });
});

describe("the attack input", () => {
  it("is wanted from a press and stays wanted until it is spent", () => {
    const controls = createControls();
    pressKey(controls, "Space");
    releaseKey(controls, "Space");
    // Tapped during a swing the player could not act on: still owed one.
    expect(wantsAttack(controls)).toBe(true);
    expect(wantsAttack(controls)).toBe(true);
    spendAttack(controls);
    expect(wantsAttack(controls)).toBe(false);
  });

  it("keeps wanting one while the button is held down", () => {
    const controls = createControls();
    pressButton(controls, "left");
    spendAttack(controls);
    expect(wantsAttack(controls)).toBe(true);
    releaseButton(controls, "left");
    expect(wantsAttack(controls)).toBe(false);
  });

  it("takes the mouse and space together, and survives releasing one of two", () => {
    const controls = createControls();
    pressButton(controls, "left");
    pressKey(controls, "Space");
    releaseButton(controls, "left");
    spendAttack(controls);
    expect(wantsAttack(controls)).toBe(true);
  });

  it("is not triggered by the right button any more — that is the cast", () => {
    const controls = createControls();
    pressButton(controls, "right");
    expect(wantsAttack(controls)).toBe(false);
    expect(wantsCast(controls)).toBe(true);
  });
});

describe("the cast input", () => {
  it("queues a tap and keeps wanting while held, on the sword's terms", () => {
    const controls = createControls();
    pressKey(controls, "KeyQ");
    releaseKey(controls, "KeyQ");
    expect(wantsCast(controls)).toBe(true);
    spendCast(controls);
    expect(wantsCast(controls)).toBe(false);

    pressButton(controls, "right");
    spendCast(controls);
    expect(wantsCast(controls)).toBe(true);
    releaseButton(controls, "right");
    expect(wantsCast(controls)).toBe(false);
  });

  it("never touches the attack queue, or the heading", () => {
    const controls = createControls();
    pressKey(controls, "KeyQ");
    expect(wantsAttack(controls)).toBe(false);
    expect(nextHeading(controls)).toBeUndefined();
  });
});

describe("the enchant input", () => {
  it("owes exactly one toggle per press, however long the key is held", () => {
    const controls = createControls();
    pressKey(controls, "KeyF");
    expect(wantsEnchant(controls)).toBe(true);
    spendEnchant(controls);
    // Still held, and auto-repeat keydowns arriving: no second toggle.
    pressKey(controls, "KeyF");
    expect(wantsEnchant(controls)).toBe(false);
    releaseKey(controls, "KeyF");
    pressKey(controls, "KeyF");
    expect(wantsEnchant(controls)).toBe(true);
  });

  it("is dropped by a lost focus", () => {
    const controls = createControls();
    pressKey(controls, "KeyF");
    pressKey(controls, "KeyQ");
    releaseAll(controls);
    expect(wantsEnchant(controls)).toBe(false);
    expect(wantsCast(controls)).toBe(false);
  });

  it("ignores an unbound button, and an event with no button at all", () => {
    const controls = createControls();
    expect(pressButton(controls, "middle")).toBe(false);
    expect(pressButton(controls, undefined)).toBe(false);
    expect(releaseButton(controls, undefined)).toBe(false);
    expect(wantsAttack(controls)).toBe(false);
  });
});

describe("losing focus", () => {
  it("drops everything held, so an alt-tab does not walk into a wall forever", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    pressButton(controls, "left");
    releaseAll(controls);
    expect(heldHeading(controls)).toBeUndefined();
    expect(isHeld(controls, "attack")).toBe(false);
    expect(wantsAttack(controls)).toBe(false);
  });
});

describe("a rebound control map", () => {
  it("is the only thing that decides what a key means", () => {
    const vim: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      north: { keys: ["KeyK"] },
      attack: { keys: ["KeyF"], buttons: ["middle"] },
    };
    const controls = createControls(vim);

    pressKey(controls, "KeyW");
    expect(heldHeading(controls)).toBeUndefined();
    pressKey(controls, "KeyK");
    expect(heldHeading(controls)).toBe("north");

    pressButton(controls, "middle");
    expect(wantsAttack(controls)).toBe(true);
  });
});
