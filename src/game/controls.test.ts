import { describe, expect, it } from "vitest";

import {
  createControls,
  heldDirection,
  isHeld,
  nextDirection,
  pressButton,
  pressKey,
  releaseAll,
  releaseButton,
  releaseKey,
  spendAttack,
  spendDirection,
  wantsAttack,
} from "./controls";
import { DEFAULT_KEYBINDINGS, type Keybindings } from "./keybindings";

describe("holding a direction", () => {
  it("holds it until it is released", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    expect(heldDirection(controls)).toBe("east");
    releaseKey(controls, "KeyD");
    expect(heldDirection(controls)).toBeUndefined();
  });

  it("reads an arrow key as the same action as its letter", () => {
    const controls = createControls();
    pressKey(controls, "ArrowLeft");
    expect(heldDirection(controls)).toBe("west");
  });

  it("does not release an action a second source is still holding", () => {
    const controls = createControls();
    pressKey(controls, "KeyA");
    pressKey(controls, "ArrowLeft");
    releaseKey(controls, "KeyA");
    expect(heldDirection(controls)).toBe("west");
    releaseKey(controls, "ArrowLeft");
    expect(heldDirection(controls)).toBeUndefined();
  });

  it("gives the newest press the field, and hands it back on release", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyW");
    expect(heldDirection(controls)).toBe("north");
    releaseKey(controls, "KeyW");
    expect(heldDirection(controls)).toBe("east");
  });

  it("ignores the keyboard's auto-repeat: a held key is one press", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    pressKey(controls, "KeyW");
    pressKey(controls, "KeyD"); // OS repeat, not a new press
    expect(heldDirection(controls)).toBe("north");
  });

  it("says whether it took the input, so an unbound key keeps its browser job", () => {
    const controls = createControls();
    expect(pressKey(controls, "KeyW")).toBe(true);
    expect(pressKey(controls, "F5")).toBe(false);
    expect(releaseKey(controls, "F5")).toBe(false);
  });
});

describe("a direction tapped faster than a frame", () => {
  it("still owes a step after the key is already back up", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    releaseKey(controls, "KeyW");
    // Both events landed between two `update` calls: nothing is held now.
    expect(heldDirection(controls)).toBeUndefined();
    expect(nextDirection(controls)).toBe("north");
  });

  it("is owed exactly once — the frame that walks it clears the debt", () => {
    const controls = createControls();
    pressKey(controls, "KeyD");
    releaseKey(controls, "KeyD");
    spendDirection(controls);
    expect(nextDirection(controls)).toBeUndefined();
  });

  it("never overrides the key the player is leaning on", () => {
    const controls = createControls();
    pressKey(controls, "KeyW");
    releaseKey(controls, "KeyW");
    pressKey(controls, "KeyS");
    expect(nextDirection(controls)).toBe("south");
    releaseKey(controls, "KeyS");
    expect(nextDirection(controls)).toBe("south");
  });

  it("is dropped by a lost focus, like everything else held", () => {
    const controls = createControls();
    pressKey(controls, "ArrowUp");
    releaseKey(controls, "ArrowUp");
    releaseAll(controls);
    expect(nextDirection(controls)).toBeUndefined();
  });

  it("is not created by the attack key", () => {
    const controls = createControls();
    pressKey(controls, "Space");
    expect(nextDirection(controls)).toBeUndefined();
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

  it("takes either mouse button, and survives releasing one of two", () => {
    const controls = createControls();
    pressButton(controls, "left");
    pressButton(controls, "right");
    releaseButton(controls, "left");
    spendAttack(controls);
    expect(wantsAttack(controls)).toBe(true);
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
    expect(heldDirection(controls)).toBeUndefined();
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
    expect(heldDirection(controls)).toBeUndefined();
    pressKey(controls, "KeyK");
    expect(heldDirection(controls)).toBe("north");

    pressButton(controls, "middle");
    expect(wantsAttack(controls)).toBe(true);
  });
});
