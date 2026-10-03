/**
 * A texture drawn into, shown as an image: the lighting, glow and cloud-shadow
 * passes are three of these.
 *
 * Commands queue until `render()`, which runs them all into the target at once -
 * as a Phaser render texture's did - so a layer can build its pass across an
 * update and pay for it once. The target is a framebuffer, so its rows are
 * GL-way-up (`texture.ts`) and the batch flips it when it is shown.
 */

import type { DrawTarget } from "./batcher";
import type { BlendMode } from "./blend";
import { Image, type RenderContext, type Stage } from "./display";
import { emptyQuad, imageQuad, type QuadInput } from "./quad";
import { drawFills, type Fill } from "./shapes";

export interface StampConfig {
  readonly originX?: number;
  readonly originY?: number;
  readonly alpha?: number;
  readonly tint?: number;
  readonly blendMode?: BlendMode;
}

type TargetCommand =
  | { readonly kind: "clear" }
  | { readonly kind: "fill"; readonly fill: Fill }
  | {
      readonly kind: "stamp";
      readonly key: string;
      readonly frame: string | number | undefined;
      readonly x: number;
      readonly y: number;
      readonly config: StampConfig;
    };

const stampInput: { -readonly [K in keyof QuadInput]: QuadInput[K] } = {
  x: 0,
  y: 0,
  originX: 0.5,
  originY: 0.5,
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
  frame: { x: 0, y: 0, width: 0, height: 0 },
  crop: undefined,
  scrollX: 0,
  scrollY: 0,
};
const stampQuad = emptyQuad();

export class RenderTarget extends Image {
  private readonly commands: TargetCommand[] = [];
  private readonly framebuffer: WebGLFramebuffer;
  private readonly target: DrawTarget;

  constructor(stage: Stage, x: number, y: number, key: string, size: { readonly width: number; readonly height: number }) {
    const texture = stage.textures.addTarget(key, size.width, size.height);
    super(stage, x, y, key);
    const gl = texture.gl;
    const framebuffer = gl.createFramebuffer();
    if (framebuffer === null) {
      throw new Error(`Could not create a framebuffer for '${key}'`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.glTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.framebuffer = framebuffer;
    this.target = { framebuffer, width: size.width, height: size.height };
  }

  clear(): this {
    this.commands.push({ kind: "clear" });
    return this;
  }

  fill(color: number, alpha = 1, x = 0, y = 0, width = this.texture.width, height = this.texture.height): this {
    this.commands.push({ kind: "fill", fill: { x, y, width, height, color, alpha } });
    return this;
  }

  /** Draw a frame of another texture into this one, centred on (x, y) unless an origin says otherwise. */
  stamp(key: string, frame: string | number | undefined, x: number, y: number, config: StampConfig = {}): this {
    this.commands.push({ kind: "stamp", key, frame, x, y, config });
    return this;
  }

  /** Run every queued command into the texture - or, handed a context, draw it as an image. */
  render(): this;
  render(ctx: RenderContext): void;
  render(ctx?: RenderContext): this | void {
    if (ctx !== undefined) {
      super.render(ctx);
      return;
    }
    this.flushCommands();
    return this;
  }

  private flushCommands(): void {
    if (this.commands.length === 0) {
      return;
    }
    const { batcher, textures } = this.stage;
    const ctx: RenderContext = { batcher, textures, scrollX: 0, scrollY: 0 };
    batcher.begin(this.target);
    for (const command of this.commands) {
      if (command.kind === "clear") {
        this.clearNow();
      } else if (command.kind === "fill") {
        drawFills(ctx, [command.fill], 0, 0, 1, "normal");
      } else {
        this.stampNow(ctx, command);
      }
    }
    batcher.flush();
    this.commands.length = 0;
  }

  private clearNow(): void {
    const gl = this.texture.gl;
    this.stage.batcher.flush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private stampNow(ctx: RenderContext, command: Extract<TargetCommand, { kind: "stamp" }>): void {
    const texture = ctx.textures.get(command.key);
    stampInput.x = command.x;
    stampInput.y = command.y;
    stampInput.originX = command.config.originX ?? 0.5;
    stampInput.originY = command.config.originY ?? 0.5;
    stampInput.frame = texture.frame(command.frame);
    const quad = imageQuad(stampInput, stampQuad);
    if (quad !== undefined) {
      const { tint = 0xffffff, alpha = 1, blendMode = "normal" } = command.config;
      ctx.batcher.draw(texture, quad, tint, alpha, blendMode);
    }
  }

  override destroy(): void {
    super.destroy();
    this.texture.gl.deleteFramebuffer(this.framebuffer);
    this.stage.textures.remove(this.texture.key);
  }
}
