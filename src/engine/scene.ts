/**
 * A scene: what a game shows, and the one object its layers are handed.
 *
 * A layer is given the scene and reaches through it for everything it makes -
 * `scene.add.image(...)`, `scene.textures`, `scene.input` - so the names are
 * the ones the layers already used under Phaser, and porting a layer changed
 * its imports rather than its logic.
 */

import type { Camera } from "./camera";
import { Blitter, Image, type DisplayList, type Stage } from "./display";
import type { Game } from "./game";
import type { Input } from "./input";
import { ShaderPass, type PassOptions } from "./pass";
import { RenderTarget } from "./render-target";
import { Graphics, Rectangle } from "./shapes";
import type { TextureStore } from "./texture";

let keyCount = 0;

/** A texture key nothing else has taken. */
export function uniqueKey(prefix: string): string {
  keyCount += 1;
  return `${prefix}-${keyCount}`;
}

/** What a scene can put on its display list. */
export class Factory {
  constructor(
    private readonly stage: Stage,
    private readonly gl: WebGL2RenderingContext,
  ) {}

  image(x: number, y: number, key: string, frame?: string | number): Image {
    return new Image(this.stage, x, y, key, frame);
  }

  graphics(): Graphics {
    return new Graphics(this.stage);
  }

  blitter(x: number, y: number, key: string): Blitter {
    return new Blitter(this.stage, x, y, key);
  }

  rectangle(x: number, y: number, width: number, height: number, color: number, alpha = 1): Rectangle {
    return new Rectangle(this.stage, { x, y, width, height, color, alpha });
  }

  renderTexture(x: number, y: number, width: number, height: number, key = uniqueKey("target")): RenderTarget {
    return new RenderTarget(this.stage, x, y, key, { width, height });
  }

  /** A shader pass - off the list; show its output with an `image` of `pass.key`. */
  pass(options: PassOptions, key = uniqueKey(options.name)): ShaderPass {
    return new ShaderPass(this.gl, this.stage.textures, key, options);
  }
}

export class Scene {
  game!: Game;
  textures!: TextureStore;
  children!: DisplayList;
  add!: Factory;
  input!: Input;
  cameras!: { readonly main: Camera };
  scale!: { readonly width: number; readonly height: number };
  gl!: WebGL2RenderingContext;

  /** Wire the scene to its game. Called once, before `create`. */
  boot(game: Game, stage: Stage): void {
    this.game = game;
    this.textures = stage.textures;
    this.children = stage.list;
    this.add = new Factory(stage, game.gl);
    this.input = game.input;
    this.cameras = { main: game.camera };
    this.scale = { width: game.width, height: game.height };
    this.gl = game.gl;
  }

  /** Build the scene's layers. */
  create(): void {}

  /** One frame: `time` is the loop's clock, `delta` the smoothed ms since the last. */
  update(_time: number, _delta: number): void {}
}
