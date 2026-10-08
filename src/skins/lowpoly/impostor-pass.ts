/**
 * The impostors' WebGL2 program and the state it draws under (`impostor-glsl.ts`).
 *
 * The program reads the world's own uniforms by the world's names, so the
 * backend sets them with the call it sets the world's with; this file adds the
 * two that are the impostors' alone and the two ways they blend:
 *
 * | Pass | Depth | Blend |
 * | --- | --- | --- |
 * | balls: crowns, smoke, clouds - and the crowns in the mirror | tested and written, per pixel | none |
 * | volumes (`?volume=1`): smoke and clouds | tested, not written | premultiplied alpha, far to near |
 */

import { program, Uniforms } from "./gl-util";
import { IMPOSTOR_FRAGMENT, IMPOSTOR_VERTEX } from "./impostor-glsl";
import { IMPOSTOR_BYTES } from "./impostor";

export class ImpostorProgram {
  readonly uniforms: Uniforms;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.uniforms = new Uniforms(gl, program(gl, IMPOSTOR_VERTEX, IMPOSTOR_FRAGMENT));
  }

  /** Point the bound vertex array at an impostor buffer's fields (`impostor.ts`); the buffer must be bound. */
  static attributes(gl: WebGL2RenderingContext): void {
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, IMPOSTOR_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, IMPOSTOR_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, IMPOSTOR_BYTES, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, IMPOSTOR_BYTES, 24);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, false, IMPOSTOR_BYTES, 28);
  }

  /** Use the program for one of its passes. The world's uniforms must already be set on it. */
  begin(volume: boolean, mirror: number, cloudShade: readonly [number, number, number]): void {
    const gl = this.gl;
    gl.useProgram(this.uniforms.target);
    gl.uniform1f(this.uniforms.at("u_mirror"), mirror);
    gl.uniform1f(this.uniforms.at("u_volume"), volume ? 1 : 0);
    gl.uniform3f(this.uniforms.at("u_cloudShade"), cloudShade[0], cloudShade[1], cloudShade[2]);
    gl.enable(gl.DEPTH_TEST);
    if (volume) {
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }
}
