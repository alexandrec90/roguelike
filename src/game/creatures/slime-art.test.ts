import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import {
  bodyCacheSize,
  bodyField,
  packKey,
  SLIME_HALF_WIDTH,
  SLIME_HEIGHT,
  slimeBody,
  slimeBubbles,
  slimeEyes,
  squashScale,
} from "./slime-art";
import { SLIME_INKS, SLIME_VARIANTS } from "./slime-palette";

const LIGHT = { x: -0.6, y: -0.8 };

describe("the body field", () => {
  it("is inside above the foot and cut flat at the ground", () => {
    const field = bodyField(0);
    expect(field(0, -4)).toBeLessThan(0);
    expect(field(0, 2)).toBeGreaterThan(0);
    expect(field(20, -4)).toBeGreaterThan(0);
  });

  it("keeps roughly its volume when squashed: wider as it gets shorter", () => {
    expect(squashScale(-0.3).sx).toBeGreaterThan(1);
    expect(squashScale(0.3).sx).toBeLessThan(1);
  });
});

describe("a slime body", () => {
  it("is about 14 px across and 10 tall at rest, standing on its foot", () => {
    const bounds = cloudBounds(slimeBody({ variant: "green", squash: 0, light: LIGHT }).cloud);
    expect(bounds).not.toBeNull();
    if (bounds === null) return;
    const width = bounds.right - bounds.left + 1;
    const height = bounds.bottom - bounds.top + 1;
    expect(width).toBeGreaterThanOrEqual(12);
    expect(width).toBeLessThanOrEqual(SLIME_HALF_WIDTH * 2 + 2);
    expect(height).toBeGreaterThanOrEqual(SLIME_HEIGHT - 1);
    expect(height).toBeLessThanOrEqual(SLIME_HEIGHT + 2);
    expect(bounds.bottom).toBe(0);
  });

  it("gets taller stretched and shorter squashed", () => {
    const tall = cloudBounds(slimeBody({ variant: "green", squash: 0.3, light: LIGHT }).cloud);
    const flat = cloudBounds(slimeBody({ variant: "green", squash: -0.3, light: LIGHT }).cloud);
    expect(tall?.top ?? 0).toBeLessThan(flat?.top ?? 0);
    expect((flat?.right ?? 0) - (flat?.left ?? 0)).toBeGreaterThan((tall?.right ?? 0) - (tall?.left ?? 0));
  });

  it("wears its variant's outline and glint", () => {
    for (const variant of SLIME_VARIANTS) {
      const inks = new Set(slimeBody({ variant, squash: 0, light: LIGHT }).cloud.map((pixel) => pixel.ink));
      expect(inks.has(SLIME_INKS[variant].outline)).toBe(true);
      expect(inks.has(SLIME_INKS[variant].glint)).toBe(true);
    }
  });

  it("puts the glint on the side the light comes from", () => {
    const glintX = (lightX: number): number => {
      const body = slimeBody({ variant: "green", squash: 0, light: { x: lightX, y: -0.8 } });
      const glints = body.cloud.filter((pixel) => pixel.ink === SLIME_INKS.green.glint);
      return glints.reduce((sum, pixel) => sum + pixel.x, 0) / Math.max(glints.length, 1);
    };
    expect(glintX(-0.8)).toBeLessThan(glintX(0.8));
  });

  it("re-inks pale on a hit flash", () => {
    const flash = slimeBody({ variant: "green", squash: 0, light: LIGHT, flash: true });
    const pale = new Set<string>(SLIME_INKS.green.flash);
    const share = flash.cloud.filter((pixel) => pale.has(pixel.ink)).length / flash.cloud.length;
    expect(share).toBeGreaterThan(0.9);
  });

  it("is smaller on the horizon roll: the same field sampled finer, not a shrunk sprite", () => {
    const near = slimeBody({ variant: "green", squash: 0, light: LIGHT }).cloud.length;
    const far = slimeBody({ variant: "green", squash: 0, light: LIGHT, scale: 0.5 }).cloud.length;
    expect(far).toBeLessThan(near / 2);
    expect(far).toBeGreaterThan(0);
  });

  it("is cached: the same look is the same object, and a near-identical squash shares it", () => {
    const a = slimeBody({ variant: "frost", squash: 0.1, light: LIGHT });
    const b = slimeBody({ variant: "frost", squash: 0.101, light: LIGHT });
    expect(b).toBe(a);
    expect(bodyCacheSize()).toBeGreaterThan(0);
  });
});

describe("eyes", () => {
  const open = slimeEyes({ squash: 0, lookX: 0, lookY: 0, state: "open", lightX: -1 });

  it("are two dark eyes with a glint each, and a blush", () => {
    expect(open.filter((pixel) => pixel.ink === "void")).toHaveLength(6);
    expect(open.filter((pixel) => pixel.ink === "foam")).toHaveLength(2);
  });

  it("follow a look by a pixel", () => {
    const right = slimeEyes({ squash: 0, lookX: 1, lookY: 0, state: "open", lightX: -1 });
    expect(right.map((pixel) => pixel.x - 1)).toEqual(open.map((pixel) => pixel.x));
  });

  it("close to a line on a blink and squeeze on a squint", () => {
    const blink = slimeEyes({ squash: 0, lookX: 0, lookY: 0, state: "blink", lightX: -1 });
    const squint = slimeEyes({ squash: 0, lookX: 0, lookY: 0, state: "squint", lightX: -1 });
    expect(new Set(blink.filter((p) => p.ink === "void").map((p) => p.y)).size).toBe(1);
    expect(squint.every((pixel) => pixel.ink === "void")).toBe(true);
  });
});

describe("bubbles", () => {
  it("only ever show inside the body", () => {
    const body = slimeBody({ variant: "green", squash: 0, light: LIGHT });
    for (let t = 0; t < 8000; t += 97) {
      for (const bubble of slimeBubbles(body, "green", 1234, t)) {
        expect(body.interior.has(packKey(bubble.x, bubble.y))).toBe(true);
      }
    }
  });
});
