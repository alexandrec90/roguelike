/**
 * Flat fills: `Graphics` for a handful of pixels a frame, `Rectangle` for one
 * box that behaves like an image (a lightning flash over the whole frame).
 *
 * Both draw from the 1×1 white texture, tinted, in the same batch as every
 * image, so a few dozen fireflies cost a few dozen quads and no draw call of
 * their own. Hundreds of pixels a frame belong in a `PixelSurface` instead
 * (`.claude/rules/rendering.md`).
 */

import type { BlendMode } from "./blend";
import { GameObject, WHITE_TEXTURE, type Box, type RenderContext, type Stage } from "./display";
import { emptyQuad } from "./quad";

/** A filled rectangle, in the owner's coordinates. */
export interface Fill {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
  readonly alpha: number;
}

const fillQuad = emptyQuad();

/** Draw a run of fills from the white texture, offset by (x, y). Shared by shapes and render targets. */
export function drawFills(ctx: RenderContext, fills: readonly Fill[], x: number, y: number, alpha: number, blend: BlendMode): void {
  const white = ctx.textures.get(WHITE_TEXTURE);
  for (const fill of fills) {
    fillQuad.left = x + fill.x - ctx.scrollX;
    fillQuad.top = y + fill.y - ctx.scrollY;
    fillQuad.right = fillQuad.left + fill.width;
    fillQuad.bottom = fillQuad.top + fill.height;
    fillQuad.u0 = 0;
    fillQuad.v0 = 0;
    fillQuad.u1 = 1;
    fillQuad.v1 = 1;
    ctx.batcher.draw(white, fillQuad, fill.color, fill.alpha * alpha, blend);
  }
}

export class Graphics extends GameObject {
  private readonly fills: Fill[] = [];
  private fillColor = 0xffffff;
  private fillAlpha = 1;
  private lineWidth = 1;
  private lineColor = 0xffffff;
  private lineAlpha = 1;

  fillStyle(color: number, alpha = 1): this {
    this.fillColor = color;
    this.fillAlpha = alpha;
    return this;
  }

  lineStyle(width: number, color: number, alpha = 1): this {
    this.lineWidth = width;
    this.lineColor = color;
    this.lineAlpha = alpha;
    return this;
  }

  fillRect(x: number, y: number, width: number, height: number): this {
    this.fills.push({ x, y, width, height, color: this.fillColor, alpha: this.fillAlpha });
    return this;
  }

  /** A rectangle's outline, the line centred on its edges as Phaser strokes it. */
  strokeRect(x: number, y: number, width: number, height: number): this {
    const half = this.lineWidth / 2;
    const line = this.lineWidth;
    const color = this.lineColor;
    const alpha = this.lineAlpha;
    this.fills.push(
      { x: x - half, y: y - half, width: width + line, height: line, color, alpha },
      { x: x - half, y: y + height - half, width: width + line, height: line, color, alpha },
      { x: x - half, y: y + half, width: line, height: height - line, color, alpha },
      { x: x + width - half, y: y + half, width: line, height: height - line, color, alpha },
    );
    return this;
  }

  /**
   * A horizontal or vertical line, `lineWidth` thick and centred on the path.
   * Nothing here draws at an angle - a slanted line would be antialiased or
   * stair-stepped, and the pixel contract wants neither - so a slanted one is
   * refused rather than approximated.
   */
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    const half = this.lineWidth / 2;
    const color = this.lineColor;
    const alpha = this.lineAlpha;
    if (y1 === y2) {
      this.fills.push({ x: Math.min(x1, x2), y: y1 - half, width: Math.abs(x2 - x1), height: this.lineWidth, color, alpha });
    } else if (x1 === x2) {
      this.fills.push({ x: x1 - half, y: Math.min(y1, y2), width: this.lineWidth, height: Math.abs(y2 - y1), color, alpha });
    } else {
      throw new Error("Graphics.lineBetween draws only horizontal and vertical lines");
    }
    return this;
  }

  clear(): this {
    this.fills.length = 0;
    return this;
  }

  render(ctx: RenderContext): void {
    drawFills(ctx, this.fills, this.x, this.y, this.alpha, this.blendMode);
  }
}

/** Where a rectangle stands and what it is filled with. */
export interface RectangleSpec {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
  /** The fill's own opacity, multiplied by the object's `alpha`. */
  readonly alpha: number;
}

export class Rectangle extends GameObject {
  originX = 0.5;
  originY = 0.5;
  readonly width: number;
  readonly height: number;
  private readonly fill: Fill;

  constructor(stage: Stage, spec: RectangleSpec) {
    super(stage);
    this.x = spec.x;
    this.y = spec.y;
    this.width = spec.width;
    this.height = spec.height;
    this.fill = { x: 0, y: 0, width: spec.width, height: spec.height, color: spec.color, alpha: spec.alpha };
  }

  get color(): number {
    return this.fill.color;
  }

  setOrigin(x: number, y = x): this {
    this.originX = x;
    this.originY = y;
    return this;
  }

  override bounds(): Box {
    const left = this.x - this.originX * this.width;
    const top = this.y - this.originY * this.height;
    return { left, top, right: left + this.width, bottom: top + this.height };
  }

  render(ctx: RenderContext): void {
    const box = this.bounds();
    drawFills(ctx, [this.fill], Math.round(box.left), Math.round(box.top), this.alpha, this.blendMode);
  }
}
