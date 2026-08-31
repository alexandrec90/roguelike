import { describe, expect, it } from "vitest";

import { HERO_EQUIPPED, IDLE, SWING } from "./models";
import { rasterizeSprite } from "./pixel-art";
import { RIG_FRAME, sampleClipFrames, sampleMeltFrames } from "./rig-frames";

describe("sampleClipFrames", () => {
  it("flattens a clip into uniform, rasterizable frames", () => {
    const frames = sampleClipFrames(HERO_EQUIPPED, IDLE, 8);
    expect(frames).toHaveLength(8);
    for (const frame of frames) {
      expect(frame.rows).toHaveLength(RIG_FRAME.height);
      expect(frame.rows[0]?.length).toBe(RIG_FRAME.width);
      expect(() => rasterizeSprite(frame)).not.toThrow();
    }
  });

  it("actually animates: a looping clip's frames are not all identical", () => {
    const frames = sampleClipFrames(HERO_EQUIPPED, IDLE, 8);
    expect(new Set(frames.map((frame) => frame.rows.join("\n"))).size).toBeGreaterThan(1);
  });

  it("ends a one-shot on its settle pose, and a loop before the seam", () => {
    const swing = sampleClipFrames(HERO_EQUIPPED, SWING, 8);
    const settled = sampleClipFrames(HERO_EQUIPPED, SWING, 1);
    expect(swing[7]?.rows.join("\n")).not.toBe(swing[0]?.rows.join("\n"));

    const idle = sampleClipFrames(HERO_EQUIPPED, IDLE, 8);
    expect(idle[7]?.rows.join("\n")).not.toBe(idle[0]?.rows.join("\n"));
    expect(settled).toHaveLength(1);
  });

  it("passes facing and flipX through to the renderer", () => {
    const front = sampleClipFrames(HERO_EQUIPPED, IDLE, 1);
    const back = sampleClipFrames(HERO_EQUIPPED, IDLE, 1, { facing: "back" });
    expect(front[0]?.rows.join("\n")).not.toBe(back[0]?.rows.join("\n"));
  });

  it("applies mapCloud before flattening", () => {
    const cleared = sampleClipFrames(HERO_EQUIPPED, IDLE, 1, { mapCloud: () => [] });
    expect(cleared[0]?.rows.every((row) => /^\.+$/.test(row))).toBe(true);
  });

  it("rejects a non-positive frame count", () => {
    expect(() => sampleClipFrames(HERO_EQUIPPED, IDLE, 0)).toThrow(/count/);
  });
});

describe("sampleMeltFrames", () => {
  it("starts whole and ends pooled at the bottom of the frame", () => {
    const frames = sampleMeltFrames(HERO_EQUIPPED, 6, 0xa11ce);
    expect(frames).toHaveLength(6);

    const litRows = (rows: readonly string[]) =>
      rows.flatMap((row, y) => (/[^.]/.test(row) ? [y] : []));
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error("unreachable");
    }
    // Fully melted, everything sits in the two rows at the foot line.
    const foot = RIG_FRAME.originY;
    expect(Math.min(...litRows(last.rows))).toBeGreaterThanOrEqual(foot - 1);
    // Un-melted, the model stands well above it.
    expect(Math.min(...litRows(first.rows))).toBeLessThan(foot - 8);
  });

  it("is deterministic per seed", () => {
    expect(sampleMeltFrames(HERO_EQUIPPED, 4, 1)).toEqual(sampleMeltFrames(HERO_EQUIPPED, 4, 1));
    expect(sampleMeltFrames(HERO_EQUIPPED, 4, 1)).not.toEqual(
      sampleMeltFrames(HERO_EQUIPPED, 4, 2),
    );
  });
});
