/**
 * The engine: a WebGL2 sprite renderer, shader passes, input and a loop -
 * everything the game needs from a framework, and nothing it does not.
 *
 * | Module | Owns |
 * | --- | --- |
 * | `game.ts` | the canvas, the context, the loop, the frame's draw |
 * | `scene.ts` | what a layer is handed: `add`, `textures`, `input`, `cameras` |
 * | `display.ts` | `Image`, `Blitter`, and the depth-sorted list |
 * | `shapes.ts` | `Graphics` and `Rectangle`: fills from the white texture |
 * | `render-target.ts` | `RenderTarget`, an image drawn into: the lighting passes |
 * | `batcher.ts` | every quad of a frame in as few draw calls as textures and blends allow |
 * | `pass.ts` | a fragment shader over a target of its own, run on demand |
 * | `texture.ts` | pictures, targets and named frames |
 * | `quad.ts`, `blend.ts`, `camera.ts`, `loop.ts` | the pure parts: corners, blend factors, fades, deltas |
 * | `input.ts` | DOM keys and pointers, untranslated |
 */

export { applyBlend, BLEND_FACTORS, blendChannel, type BlendMode } from "./blend";
export { Camera, fadeLevel } from "./camera";
export {
  Blitter,
  Bob,
  colorOf,
  DEFAULT_TEXTURE,
  DisplayList,
  GameObject,
  Image,
  WHITE_TEXTURE,
  type Box,
} from "./display";
export { createContext, Game, type GameConfig, type GameEvent } from "./game";
export { Input, Keyboard, type Pointer } from "./input";
export { FrameClock } from "./loop";
export { ShaderPass, type PassOptions, type UniformValue } from "./pass";
export { imageQuad, type FrameRect, type Quad } from "./quad";
export { RenderTarget, type StampConfig } from "./render-target";
export { Factory, Scene, uniqueKey } from "./scene";
export { Graphics, Rectangle, type RectangleSpec } from "./shapes";
export { BASE_FRAME, rawTexture, Texture, TextureStore } from "./texture";
