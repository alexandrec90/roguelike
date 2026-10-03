/**
 * How a draw combines with what is already there.
 *
 * Every texture this engine holds is **premultiplied** - colour already scaled
 * by its alpha - so "over" is `src + dst·(1 − srcα)` and a tint or a fade is one
 * multiply of all four channels. The three modes are the ones the game uses,
 * with Phaser's exact factors so a frame drawn here matches one drawn there:
 *
 * - `normal`: paint over.
 * - `add`: light. `ONE, DST_ALPHA` rather than `ONE, ONE` - on an opaque target
 *   the two are the same, and into a cleared target the first stamp lands as
 *   itself rather than being added to transparent black twice.
 * - `multiply`: darken by what is drawn, which is how the lighting and cloud
 *   passes lay the ambient over the world.
 */

export type BlendMode = "normal" | "add" | "multiply";

/** A `blendFunc` pair, by GL enum name so it can be checked without a context. */
export interface BlendFactors {
  readonly src: "ONE" | "DST_COLOR";
  readonly dst: "ONE_MINUS_SRC_ALPHA" | "DST_ALPHA";
}

export const BLEND_FACTORS: Readonly<Record<BlendMode, BlendFactors>> = {
  normal: { src: "ONE", dst: "ONE_MINUS_SRC_ALPHA" },
  add: { src: "ONE", dst: "DST_ALPHA" },
  multiply: { src: "DST_COLOR", dst: "ONE_MINUS_SRC_ALPHA" },
};

/** Apply a mode to a context: `blendFunc` with the factors above. */
export function applyBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  const factors = BLEND_FACTORS[mode];
  gl.blendFunc(gl[factors.src], gl[factors.dst]);
}

/**
 * The colour a draw leaves, per channel, 0..1 - the blend equation on the CPU,
 * so the modes' meaning is pinned by a test rather than by a screenshot.
 */
export function blendChannel(mode: BlendMode, src: number, srcAlpha: number, dst: number, dstAlpha: number): number {
  const factors = BLEND_FACTORS[mode];
  const s = factors.src === "ONE" ? 1 : dst;
  const d = factors.dst === "ONE_MINUS_SRC_ALPHA" ? 1 - srcAlpha : dstAlpha;
  return Math.min(1, src * s + dst * d);
}
