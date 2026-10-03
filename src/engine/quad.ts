/**
 * Where an image's four corners land, and which texels they show. Pure.
 *
 * The rule is Phaser's, kept so nothing moves by a pixel in the port: the
 * origin is a share of the *whole* frame, a crop shows its own rectangle at the
 * place it occupied in the frame, a flip turns the picture about its origin,
 * and the corners are rounded to whole pixels only when nothing is scaled - a
 * scaled image keeps its exact edges.
 */

/** A rectangle of a texture, in texels, top-left origin. */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface QuadInput {
  readonly x: number;
  readonly y: number;
  readonly originX: number;
  readonly originY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  /** The frame being drawn, within its texture. */
  readonly frame: FrameRect;
  /** A part of the frame, in frame coordinates; the whole frame when undefined. */
  readonly crop: FrameRect | undefined;
  /** The camera's scroll, subtracted from every corner. */
  readonly scrollX: number;
  readonly scrollY: number;
}

/** Screen corners (left, top, right, bottom) and texel corners (u0, v0, u1, v1) - texels, not 0..1. */
export interface Quad {
  left: number;
  top: number;
  right: number;
  bottom: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export function emptyQuad(): Quad {
  return { left: 0, top: 0, right: 0, bottom: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
}

/**
 * Fill `out` with where `input` lands, or return undefined when nothing of it
 * shows (an empty crop). `out` is reused across a frame's draws, so a frame of
 * a thousand images allocates nothing here.
 */
export function imageQuad(input: QuadInput, out: Quad = emptyQuad()): Quad | undefined {
  const { frame, crop } = input;
  const partX = crop?.x ?? 0;
  const partY = crop?.y ?? 0;
  const width = Math.min(crop?.width ?? frame.width, frame.width - partX);
  const height = Math.min(crop?.height ?? frame.height, frame.height - partY);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const originX = input.originX * frame.width;
  const originY = input.originY * frame.height;
  // Local corners, relative to the object's position, before scale and flip.
  let x0 = -originX + partX;
  let y0 = -originY + partY;
  let signX = 1;
  let signY = 1;
  if (input.flipX) {
    x0 += -frame.width + originX * 2;
    signX = -1;
  }
  if (input.flipY) {
    y0 += -frame.height + originY * 2;
    signY = -1;
  }
  const sx = input.scaleX * signX;
  const sy = input.scaleY * signY;
  const px = input.x - input.scrollX;
  const py = input.y - input.scrollY;
  let a = px + x0 * sx;
  let b = px + (x0 + width) * sx;
  let c = py + y0 * sy;
  let d = py + (y0 + height) * sy;
  if (input.scaleX === 1 && input.scaleY === 1) {
    a = Math.round(a);
    b = Math.round(b);
    c = Math.round(c);
    d = Math.round(d);
  }
  // Keep left < right with the texels swapped, so a flip is just a reversed span.
  let u0 = frame.x + partX;
  let u1 = u0 + width;
  let v0 = frame.y + partY;
  let v1 = v0 + height;
  if (a > b) {
    [a, b] = [b, a];
    [u0, u1] = [u1, u0];
  }
  if (c > d) {
    [c, d] = [d, c];
    [v0, v1] = [v1, v0];
  }
  out.left = a;
  out.top = c;
  out.right = b;
  out.bottom = d;
  out.u0 = u0;
  out.v0 = v0;
  out.u1 = u1;
  out.v1 = v1;
  return out;
}
