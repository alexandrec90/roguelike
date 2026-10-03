import { describe, expect, it } from "vitest";

import type Phaser from "phaser";

import { createBuffer, type PixelBuffer } from "./pixel-buffer";
import { installFrames, installStrip, packFrames } from "./pixel-surface";

function filled(width: number, height: number, value: number): PixelBuffer {
  const buffer = createBuffer(width, height);
  buffer.data.fill(value);
  return buffer;
}

/** A texture manager that records what was installed, and the frames added to it. */
function recorder(): {
  manager: Phaser.Textures.TextureManager;
  installed: Map<string, { width: number; height: number; data: Uint8Array; frames: string[] }>;
} {
  const installed = new Map<string, { width: number; height: number; data: Uint8Array; frames: string[] }>();
  const manager = {
    exists: (key: string) => installed.has(key),
    addUint8Array: (key: string, data: Uint8Array, width: number, height: number) => {
      const entry = { width, height, data, frames: [] as string[] };
      installed.set(key, entry);
      return { add: (name: string) => entry.frames.push(name) };
    },
  };
  return { manager: manager as unknown as Phaser.Textures.TextureManager, installed };
}

describe("packFrames", () => {
  it("lays pictures side by side, top-aligned, each where its frame says", () => {
    const packed = packFrames([filled(2, 3, 10), filled(3, 1, 20)]);
    expect(packed.width).toBe(5);
    expect(packed.height).toBe(3);
    expect(packed.frames).toEqual([
      { x: 0, width: 2, height: 3 },
      { x: 2, width: 3, height: 1 },
    ]);
    const at = (x: number, y: number): number => packed.data[(y * packed.width + x) * 4] ?? -1;
    expect(at(1, 2)).toBe(10);
    expect(at(2, 0)).toBe(20);
    // Below the shorter picture is empty.
    expect(at(2, 1)).toBe(0);
  });

  it("is a Uint8Array, which Phaser uploads directly", () => {
    expect(packFrames([filled(1, 1, 5)]).data).toBeInstanceOf(Uint8Array);
  });
});

describe("installing pictures", () => {
  it("installs a set as one texture with a frame per picture, once", () => {
    const { manager, installed } = recorder();
    expect(installFrames(manager, "set", [filled(2, 2, 1), filled(1, 4, 2)])).toBe(true);
    expect(installed.get("set")?.frames).toEqual(["0", "1"]);
    expect(installed.get("set")?.width).toBe(3);
    expect(installFrames(manager, "set", [filled(2, 2, 1)])).toBe(false);
    expect(installFrames(manager, "none", [])).toBe(false);
  });

  it("refuses a strip whose frames differ in size", () => {
    const { manager } = recorder();
    expect(() => installStrip(manager, "strip", [filled(2, 2, 1), filled(3, 2, 1)])).toThrow(/expected 2x2/);
  });
});
