import { describe, expect, it } from "vitest";

import { BLEND_FACTORS, blendChannel } from "./blend";
import { fadeLevel, Camera } from "./camera";
import { FrameClock, MAX_DELTA_MS, SMOOTHING_FRAMES } from "./loop";
import { packColor } from "./batcher";
import { pixelProjection } from "./pass";
import { imageQuad, type QuadInput } from "./quad";

const FRAME = { x: 10, y: 20, width: 8, height: 6 };

function input(overrides: Partial<QuadInput> = {}): QuadInput {
  return {
    x: 100,
    y: 50,
    originX: 0,
    originY: 0,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    flipY: false,
    frame: FRAME,
    crop: undefined,
    scrollX: 0,
    scrollY: 0,
    ...overrides,
  };
}

describe("imageQuad", () => {
  it("places a frame at its position with its texels", () => {
    expect(imageQuad(input())).toEqual({ left: 100, top: 50, right: 108, bottom: 56, u0: 10, v0: 20, u1: 18, v1: 26 });
  });

  it("measures the origin as a share of the frame, as Phaser did", () => {
    const quad = imageQuad(input({ originX: 0.5, originY: 1 }));
    expect([quad?.left, quad?.top, quad?.right, quad?.bottom]).toEqual([96, 44, 104, 50]);
  });

  it("rounds an unscaled image's corners to whole pixels", () => {
    // An odd frame centred lands on a half pixel; it is snapped, not smeared.
    const quad = imageQuad(input({ x: 10.4, y: 3.6 }));
    expect([quad?.left, quad?.top]).toEqual([10, 4]);
    expect((quad?.right ?? 0) - (quad?.left ?? 0)).toBe(8);
  });

  it("keeps a scaled image's exact edges", () => {
    const quad = imageQuad(input({ x: 0.5, scaleX: 2, scaleY: 3 }));
    expect([quad?.left, quad?.right, quad?.bottom]).toEqual([0.5, 16.5, 50 + 18]);
  });

  it("shows a crop where it sat in the frame", () => {
    const quad = imageQuad(input({ crop: { x: 2, y: 1, width: 3, height: 2 } }));
    expect(quad).toEqual({ left: 102, top: 51, right: 105, bottom: 53, u0: 12, v0: 21, u1: 15, v1: 23 });
  });

  it("clips a crop to the frame, and shows nothing for an empty one", () => {
    expect(imageQuad(input({ crop: { x: 6, y: 0, width: 10, height: 6 } }))?.right).toBe(108);
    expect(imageQuad(input({ crop: { x: 0, y: 0, width: 0, height: 6 } }))).toBeUndefined();
    expect(imageQuad(input({ crop: { x: 8, y: 0, width: 4, height: 6 } }))).toBeUndefined();
  });

  it("turns a flip into a reversed span over the same rectangle", () => {
    const quad = imageQuad(input({ flipX: true }));
    expect([quad?.left, quad?.right]).toEqual([100, 108]);
    expect([quad?.u0, quad?.u1]).toEqual([18, 10]);
  });

  it("subtracts the camera's scroll", () => {
    expect(imageQuad(input({ scrollX: 3, scrollY: -2 }))?.left).toBe(97);
    expect(imageQuad(input({ scrollX: 3, scrollY: -2 }))?.top).toBe(52);
  });

  it("fills the output it is given rather than making one", () => {
    const out = { left: 0, top: 0, right: 0, bottom: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
    expect(imageQuad(input(), out)).toBe(out);
  });
});

describe("blend modes", () => {
  it("paints over with premultiplied 'over'", () => {
    expect(blendChannel("normal", 0.5, 0.5, 1, 1)).toBeCloseTo(1);
    expect(blendChannel("normal", 0.2, 1, 0.9, 1)).toBeCloseTo(0.2);
  });

  it("adds light onto an opaque target, and lands as itself on a clear one", () => {
    expect(blendChannel("add", 0.3, 1, 0.4, 1)).toBeCloseTo(0.7);
    expect(blendChannel("add", 0.3, 1, 0.4, 0)).toBeCloseTo(0.3);
    expect(blendChannel("add", 0.8, 1, 0.8, 1)).toBe(1);
  });

  it("multiplies by an opaque layer", () => {
    expect(blendChannel("multiply", 0.5, 1, 0.8, 1)).toBeCloseTo(0.4);
    // White leaves the world alone, which is how the cloud pass leaves the sky clear.
    expect(blendChannel("multiply", 1, 1, 0.37, 1)).toBeCloseTo(0.37);
  });

  it("names every mode's factors", () => {
    expect(Object.keys(BLEND_FACTORS).sort()).toEqual(["add", "multiply", "normal"]);
  });
});

describe("packColor", () => {
  it("premultiplies the tint by the alpha, little-endian RGBA", () => {
    expect(packColor(0xffffff, 1)).toBe(0xffffffff);
    expect(packColor(0xff0000, 1)).toBe(0xff0000ff);
    const half = packColor(0x804020, 0.5);
    expect(half & 0xff).toBe(64);
    expect((half >>> 8) & 0xff).toBe(32);
    expect((half >>> 16) & 0xff).toBe(16);
    expect(half >>> 24).toBe(128);
  });

  it("clamps alpha to 0..1", () => {
    expect(packColor(0xffffff, 2)).toBe(packColor(0xffffff, 1));
    expect(packColor(0xffffff, -1)).toBe(0);
  });
});

describe("pixelProjection", () => {
  it("takes the target's top-left to clip (-1, 1) and bottom-right to (1, -1)", () => {
    const m = pixelProjection(320, 180);
    const apply = (x: number, y: number) => [m[0]! * x + m[12]!, m[5]! * y + m[13]!];
    expect(apply(0, 0)).toEqual([-1, 1]);
    const [x, y] = apply(320, 180);
    // The matrix is Float32, so the far corner is exact only to float precision.
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(-1, 6);
  });
});

describe("fades", () => {
  it("runs linearly from one level to another", () => {
    const fade = { from: 1, to: 0, startMs: 100, durationMs: 200 };
    expect(fadeLevel(fade, 50)).toBe(1);
    expect(fadeLevel(fade, 200)).toBeCloseTo(0.5);
    expect(fadeLevel(fade, 400)).toBe(0);
    expect(fadeLevel(undefined, 0)).toBe(0);
  });

  it("jumps at once for a zero-length fade, as the scene's opening black does", () => {
    const camera = new Camera();
    camera.tick(10);
    camera.fadeOut(0);
    expect(camera.fadeAmount()).toBe(1);
    camera.fadeIn(250);
    camera.tick(135);
    expect(camera.fadeAmount()).toBeCloseTo(0.5);
    camera.tick(1000);
    expect(camera.fadeAmount()).toBe(0);
  });

  it("parses a background colour", () => {
    expect(new Camera().setBackgroundColor("#1b2440").backgroundColor).toBe(0x1b2440);
  });
});

describe("FrameClock", () => {
  it("is zero on the first frame, then the gap", () => {
    const clock = new FrameClock();
    expect(clock.tick(1000)).toBe(0);
    expect(clock.tick(1016)).toBe(16);
  });

  it("averages jitter away", () => {
    const clock = new FrameClock();
    clock.tick(0);
    clock.tick(10);
    expect(clock.tick(32)).toBe(16);
  });

  it("never steps more than the cap, and forgets old gaps", () => {
    const clock = new FrameClock();
    clock.tick(0);
    expect(clock.tick(60_000)).toBe(MAX_DELTA_MS);
    for (let frame = 1; frame <= SMOOTHING_FRAMES; frame += 1) {
      clock.tick(60_000 + frame * 16);
    }
    expect(clock.tick(60_000 + (SMOOTHING_FRAMES + 1) * 16)).toBe(16);
  });

  it("starts over after a reset", () => {
    const clock = new FrameClock();
    clock.tick(0);
    clock.tick(50);
    clock.reset();
    expect(clock.tick(5000)).toBe(0);
  });
});
