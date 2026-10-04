import { describe, expect, it } from "vitest";

import { buttonLabel, helpRows, keyLabel } from "./controls-help";
import { COMMANDS, DEFAULT_KEYBINDINGS, type Keybindings } from "./keybindings";

describe("key labels", () => {
  it("names keys the way a player says them", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Digit3")).toBe("3");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("Slash")).toBe("?");
    expect(keyLabel("F1")).toBe("F1");
    expect(buttonLabel("right")).toBe("Right click");
  });
});

describe("the controls reminder", () => {
  const rows = helpRows();

  it("groups the direction keys into the sets a hand rests on", () => {
    expect(rows[0]!.inputs).toEqual(["W A S D", "↑ ← ↓ →"]);
  });

  it("lists every command, with its keys and buttons, then how to close it", () => {
    expect(rows).toHaveLength(COMMANDS.length + 3);
    const fireball = rows.find((row) => row.label.includes("fireball"))!;
    expect(fireball.inputs).toEqual(["Q", "Right click"]);
    const swing = rows.find((row) => row.label.includes("Swing"))!;
    expect(swing.inputs).toEqual(["Space", "Left click"]);
    expect(rows[rows.length - 1]!.inputs).toEqual(["H", "?", "F1"]);
  });

  it("names the skin switch, which is a key but not a game action", () => {
    const skin = rows.find((row) => row.label.includes("skin"))!;
    expect(skin.inputs).toEqual(["F2"]);
  });

  it("follows the binding table, so a rebinding changes the reminder", () => {
    const rebound: Keybindings = { ...DEFAULT_KEYBINDINGS, frost: { keys: ["KeyR"] } };
    const frost = helpRows(rebound).find((row) => row.label.includes("Frost"))!;
    expect(frost.inputs).toEqual(["R"]);
  });
});
