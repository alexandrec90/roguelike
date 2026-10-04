import { describe, expect, it } from "vitest";

import {
  beginTransition,
  composeMasked,
  revealed,
  revealField,
  revealThreshold,
  transitionDone,
  transitionProgress,
  TRANSITION_STYLES,
  type MaskView,
} from "./horizon-transition";
import { blendInk, bufferPixel, createBuffer } from "./pixel-buffer";

const W = 320;
const H = 180;

describe("transitionProgress", () => {
  const change = beginTransition("a", "b", "dissolve", 1000, 800);

  it("runs from 0 at the start to 1 at the end, and holds there", () => {
    expect(transitionProgress(change, 500)).toBe(0);
    expect(transitionProgress(change, 1000)).toBe(0);
    expect(transitionProgress(change, 1400)).toBeCloseTo(0.5);
    expect(transitionProgress(change, 1800)).toBe(1);
    expect(transitionProgress(change, 9000)).toBe(1);
  });

  it("eases in and out", () => {
    expect(transitionProgress(change, 1080)).toBeLessThan(0.1);
    expect(transitionProgress(change, 1720)).toBeGreaterThan(0.9);
  });

  it("is done exactly when its time is up", () => {
    expect(transitionDone(change, 1799)).toBe(false);
    expect(transitionDone(change, 1800)).toBe(true);
  });

  it("never divides by a zero length", () => {
    expect(transitionProgress(beginTransition("a", "b", "iris", 0, 0), 1)).toBe(1);
  });
});

describe("revealThreshold", () => {
  it.each(TRANSITION_STYLES)("%s: reveals nothing at 0 and everything at 1", (style) => {
    for (let y = 0; y < H; y += 7) {
      for (let x = 0; x < W; x += 5) {
        const threshold = revealThreshold(style, x, y, W, H);
        expect(threshold).toBeGreaterThanOrEqual(0);
        expect(threshold).toBeLessThan(1);
        expect(revealed(style, x, y, W, H, 0)).toBe(false);
        expect(revealed(style, x, y, W, H, 1)).toBe(true);
      }
    }
  });

  it("opens an iris from the centre", () => {
    expect(revealThreshold("iris", W / 2, H / 2, W, H)).toBeLessThan(revealThreshold("iris", 2, 2, W, H));
  });

  it("floods from the bottom and descends from the top", () => {
    expect(revealThreshold("flood", 40, H - 1, W, H)).toBeLessThan(revealThreshold("flood", 40, 0, W, H));
    expect(revealThreshold("descend", 40, 0, W, H)).toBeLessThan(revealThreshold("descend", 40, H - 1, W, H));
  });

  it("dissolves everywhere at once: halfway, both halves of the screen are partly through", () => {
    const share = (x0: number): number => {
      let shown = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = x0; x < x0 + W / 2; x += 1) {
          shown += revealed("dissolve", x, y, W, H, 0.5) ? 1 : 0;
        }
      }
      return shown / ((W / 2) * H);
    };
    for (const half of [share(0), share(W / 2)]) {
      expect(half).toBeGreaterThan(0.2);
      expect(half).toBeLessThan(0.8);
    }
  });

  it("is what the cached field holds", () => {
    const field = revealField("flood", 32, 20);
    expect(field[5 * 32 + 7]).toBeCloseTo(revealThreshold("flood", 7, 5, 32, 20), 6);
    expect(revealField("flood", 32, 20)).toBe(field);
  });
});

describe("composeMasked", () => {
  const from = createBuffer(4, 2);
  const to = createBuffer(4, 2);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      blendInk(from, x, y, "stone-2");
      blendInk(to, x, y, "fire-5");
    }
  }
  const view = (progress: number): MaskView => ({
    style: "dissolve",
    progress,
    originX: 10,
    originY: 10,
    screenWidth: W,
    screenHeight: H,
  });

  it("shows the outgoing picture at 0 and the incoming one at 1", () => {
    const out = createBuffer(4, 2);
    composeMasked(out, from, to, view(0));
    expect(bufferPixel(out, 1, 1)).toEqual(bufferPixel(from, 1, 1));
    composeMasked(out, from, to, view(1));
    expect(bufferPixel(out, 1, 1)).toEqual(bufferPixel(to, 1, 1));
  });

  it("leaves a missing end transparent, so a layer beneath shows through", () => {
    const out = createBuffer(4, 2);
    composeMasked(out, undefined, to, view(0));
    expect(bufferPixel(out, 2, 0)[3]).toBe(0);
    composeMasked(out, from, undefined, view(1));
    expect(bufferPixel(out, 2, 0)[3]).toBe(0);
  });

  it("measures the mask on the screen, so two surfaces agree on a pixel", () => {
    const progress = 0.5;
    const out = createBuffer(4, 2);
    composeMasked(out, undefined, to, view(progress));
    for (let x = 0; x < 4; x += 1) {
      const shown = bufferPixel(out, x, 0)[3] > 0;
      expect(shown).toBe(revealed("dissolve", 10 + x, 10, W, H, progress));
    }
  });
});
