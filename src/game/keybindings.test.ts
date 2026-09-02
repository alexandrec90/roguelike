import { describe, expect, it } from "vitest";

import {
  actionForButton,
  actionForKey,
  DEFAULT_KEYBINDINGS,
  DIRECTIONS,
  GAME_ACTIONS,
  mouseButtonOf,
  validateKeybindings,
  type Keybindings,
} from "./keybindings";

describe("the default control map", () => {
  it("moves on WASD and on the arrows, which are the same four actions", () => {
    expect(["KeyW", "ArrowUp"].map((code) => actionForKey(code))).toEqual(["north", "north"]);
    expect(["KeyS", "ArrowDown"].map((code) => actionForKey(code))).toEqual(["south", "south"]);
    expect(["KeyA", "ArrowLeft"].map((code) => actionForKey(code))).toEqual(["west", "west"]);
    expect(["KeyD", "ArrowRight"].map((code) => actionForKey(code))).toEqual(["east", "east"]);
  });

  it("attacks on space and on either mouse button", () => {
    expect(actionForKey("Space")).toBe("attack");
    expect(actionForButton("left")).toBe("attack");
    expect(actionForButton("right")).toBe("attack");
  });

  it("leaves the scroll wheel alone — a stray middle click is not a swing", () => {
    expect(actionForButton("middle")).toBeUndefined();
  });

  it("claims nothing it was not given", () => {
    expect(actionForKey("KeyQ")).toBeUndefined();
    expect(actionForKey("F5")).toBeUndefined();
  });

  it("binds every action, and binds no input twice", () => {
    expect(validateKeybindings(DEFAULT_KEYBINDINGS)).toEqual([]);
    expect(GAME_ACTIONS).toHaveLength(DIRECTIONS.length + 1);
  });

  it("names the mouse buttons the DOM numbers", () => {
    expect([0, 1, 2].map(mouseButtonOf)).toEqual(["left", "middle", "right"]);
    expect(mouseButtonOf(3)).toBeUndefined();
    expect(mouseButtonOf(-1)).toBeUndefined();
  });
});

describe("validating a rebinding", () => {
  it("reports an action nothing can trigger", () => {
    const orphaned: Keybindings = { ...DEFAULT_KEYBINDINGS, north: { keys: [] } };
    expect(validateKeybindings(orphaned)).toEqual(["north has no input bound to it"]);
  });

  it("accepts an action bound only to a mouse button", () => {
    const mouseOnly: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      attack: { keys: [], buttons: ["left"] },
    };
    expect(validateKeybindings(mouseOnly)).toEqual([]);
  });

  it("reports a key two actions both claim — the loser would never fire", () => {
    const clashing: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      south: { keys: ["KeyS", "KeyW"] },
    };
    expect(validateKeybindings(clashing)).toEqual(["key KeyW is bound to both north and south"]);
  });

  it("reports a mouse button two actions both claim", () => {
    const clashing: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      north: { keys: ["KeyW"], buttons: ["left"] },
    };
    expect(validateKeybindings(clashing)).toEqual([
      "left mouse button is bound to both north and attack",
    ]);
  });

  it("resolves against the map it is given, not the default one", () => {
    const vim: Keybindings = { ...DEFAULT_KEYBINDINGS, north: { keys: ["KeyK"] } };
    expect(actionForKey("KeyK", vim)).toBe("north");
    expect(actionForKey("KeyW", vim)).toBeUndefined();
  });
});
