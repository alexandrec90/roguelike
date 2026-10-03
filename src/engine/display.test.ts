import { describe, expect, it } from "vitest";

import type { Batcher } from "./batcher";
import { DisplayList, Image, WHITE_TEXTURE, type RenderContext, type Stage } from "./display";
import type { Quad } from "./quad";
import { Graphics, Rectangle, drawFills } from "./shapes";
import { Texture, type TextureStore } from "./texture";

/** A texture with no GL behind it: the display list only reads its size and frames. */
function fakeTexture(key: string, width: number, height: number, flipY = false): Texture {
  return new Texture(key, {} as WebGL2RenderingContext, {} as WebGLTexture, width, height, flipY);
}

interface Draw {
  readonly key: string;
  readonly quad: Quad;
  readonly tint: number;
  readonly alpha: number;
  readonly blend: string;
}

function stage(): { stage: Stage; ctx: RenderContext; draws: Draw[] } {
  const textures = new Map<string, Texture>([
    ["sheet", fakeTexture("sheet", 32, 16)],
    [WHITE_TEXTURE, fakeTexture(WHITE_TEXTURE, 1, 1)],
  ]);
  textures.get("sheet")?.add("cell", 8, 0, 8, 8);
  const store = { get: (key: string) => textures.get(key) } as unknown as TextureStore;
  const draws: Draw[] = [];
  const batcher = {
    draw: (texture: Texture, quad: Quad, tint: number, alpha: number, blend: string) =>
      draws.push({ key: texture.key, quad: { ...quad }, tint, alpha, blend }),
  } as unknown as Batcher;
  const list = new DisplayList();
  return { stage: { textures: store, list, batcher }, ctx: { batcher, textures: store, scrollX: 0, scrollY: 0 }, draws };
}

describe("DisplayList", () => {
  it("draws by depth, and in the order added where depths tie", () => {
    const { stage: s } = stage();
    const a = new Image(s, 0, 0, "sheet").setDepth(5);
    const b = new Image(s, 0, 0, "sheet").setDepth(1);
    const c = new Image(s, 0, 0, "sheet").setDepth(5);
    const d = new Image(s, 0, 0, "sheet").setDepth(1);
    expect(s.list.sorted()).toEqual([b, d, a, c]);
    c.setDepth(0);
    expect(s.list.sorted()[0]).toBe(c);
  });

  it("forgets a destroyed object", () => {
    const { stage: s } = stage();
    const image = new Image(s, 0, 0, "sheet");
    image.destroy();
    expect(s.list.list).toHaveLength(0);
  });
});

describe("Image", () => {
  it("defaults to a centred origin and the whole texture, as Phaser's did", () => {
    const { stage: s } = stage();
    const image = new Image(s, 16, 8, "sheet");
    expect(image.bounds()).toEqual({ left: 0, top: 0, right: 32, bottom: 16 });
  });

  it("switches frames and sizes to them", () => {
    const { stage: s } = stage();
    const image = new Image(s, 0, 0, "sheet", "cell").setOrigin(0, 0);
    expect([image.width, image.height]).toEqual([8, 8]);
    image.setFrame("missing");
    expect(image.width).toBe(32);
  });

  it("draws with its tint, alpha and blend, from its frame's texels", () => {
    const { stage: s, ctx, draws } = stage();
    new Image(s, 4, 2, "sheet", "cell").setOrigin(0, 0).setTint(0x336699).setAlpha(0.5).setBlendMode("add").render(ctx);
    expect(draws).toEqual([
      {
        key: "sheet",
        quad: { left: 4, top: 2, right: 12, bottom: 10, u0: 8, v0: 0, u1: 16, v1: 8 },
        tint: 0x336699,
        alpha: 0.5,
        blend: "add",
      },
    ]);
  });

  it("draws nothing when fully transparent or cropped away", () => {
    const { stage: s, ctx, draws } = stage();
    new Image(s, 0, 0, "sheet").setAlpha(0).render(ctx);
    new Image(s, 0, 0, "sheet").setCrop(0, 0, 0, 4).render(ctx);
    expect(draws).toHaveLength(0);
  });

  it("reports whether it is cropped, and drops the crop when asked", () => {
    const { stage: s } = stage();
    const image = new Image(s, 0, 0, "sheet").setCrop(0, 0, 4, 4);
    expect(image.isCropped).toBe(true);
    expect(image.setCrop().isCropped).toBe(false);
  });
});

describe("Graphics", () => {
  it("fills from the white texture in the fill colour", () => {
    const { stage: s, ctx, draws } = stage();
    const gfx = new Graphics(s).fillStyle(0xff8800, 0.25).fillRect(3, 4, 1, 1);
    gfx.render(ctx);
    expect(draws[0]).toMatchObject({ key: WHITE_TEXTURE, tint: 0xff8800, alpha: 0.25 });
    expect(draws[0]?.quad).toMatchObject({ left: 3, top: 4, right: 4, bottom: 5 });
    gfx.clear();
    draws.length = 0;
    gfx.render(ctx);
    expect(draws).toHaveLength(0);
  });

  it("strokes a rectangle with the line centred on its edges", () => {
    const { stage: s, ctx, draws } = stage();
    // The lab's idiom: a half-pixel inset makes a one-pixel line land on whole pixels.
    new Graphics(s).lineStyle(1, 0xffffff).strokeRect(10.5, 20.5, 9, 4).render(ctx);
    const boxes = draws.map((draw) => [draw.quad.left, draw.quad.top, draw.quad.right, draw.quad.bottom]);
    expect(boxes).toEqual([
      [10, 20, 20, 21],
      [10, 24, 20, 25],
      [10, 21, 11, 24],
      [19, 21, 20, 24],
    ]);
  });

  it("draws straight lines and refuses slanted ones", () => {
    const { stage: s, ctx, draws } = stage();
    const gfx = new Graphics(s).lineStyle(1, 0xffffff).lineBetween(4.5, 0, 4.5, 10);
    gfx.render(ctx);
    expect(draws[0]?.quad).toMatchObject({ left: 4, top: 0, right: 5, bottom: 10 });
    expect(() => gfx.lineBetween(0, 0, 3, 3)).toThrow(/horizontal and vertical/);
  });
});

describe("Rectangle", () => {
  it("covers its box from its origin", () => {
    const { stage: s, ctx, draws } = stage();
    const rect = new Rectangle(s, { x: 0, y: 0, width: 320, height: 180, color: 0xaabbcc, alpha: 1 }).setOrigin(0, 0);
    expect(rect.bounds()).toEqual({ left: 0, top: 0, right: 320, bottom: 180 });
    expect(rect.color).toBe(0xaabbcc);
    rect.setAlpha(0.3).render(ctx);
    expect(draws[0]).toMatchObject({ tint: 0xaabbcc, alpha: 0.3 });
  });

  it("centres on its position by default, as Phaser's did", () => {
    const { stage: s } = stage();
    expect(new Rectangle(s, { x: 10, y: 10, width: 4, height: 2, color: 0, alpha: 1 }).bounds()).toEqual({
      left: 8,
      top: 9,
      right: 12,
      bottom: 11,
    });
  });
});

describe("drawFills", () => {
  it("offsets each fill and scales its alpha by the owner's", () => {
    const { ctx, draws } = stage();
    drawFills(ctx, [{ x: 1, y: 2, width: 3, height: 4, color: 0x123456, alpha: 0.5 }], 10, 20, 0.5, "multiply");
    expect(draws).toEqual([
      {
        key: WHITE_TEXTURE,
        quad: { left: 11, top: 22, right: 14, bottom: 26, u0: 0, v0: 0, u1: 1, v1: 1 },
        tint: 0x123456,
        alpha: 0.25,
        blend: "multiply",
      },
    ]);
  });
});

describe("Texture frames", () => {
  it("falls back to the whole texture for an unknown frame", () => {
    const texture = fakeTexture("t", 4, 2);
    texture.add(0, 0, 0, 2, 2);
    expect(texture.frame("0")).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(texture.frame("nope")).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(texture.frameNames()).toEqual(["0"]);
  });
});
