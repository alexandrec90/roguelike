/**
 * The trip's `trails`, for WebGL2: each frame lays a fading copy of the last
 * one over itself - zoomed a hair about the hero, spun a hair, its hue turned a
 * step - and then keeps the result to do it again. Feedback, as an old video
 * mixer did it: everything leaves a smear streaming outward that cycles colour
 * as it goes.
 *
 * One full-screen pass and one copy of the finished frame. The copy is from the
 * default framebuffer, which WebGL resolves when it is multisampled, into a
 * texture with no alpha because the canvas has none (`alpha: false`).
 */

import { program, Uniforms } from "./gl-util";
import { RAIN_VERTEX } from "./rain-pass";
import type { TrailFrame } from "./trip";

/** Its own texture unit, past the puddles' and the mirror's. */
const LAST_UNIT = 3;

export const TRAIL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_last;  // the frame before, as it was shown
uniform vec4 u_warp;       // keep, zoom, spin, hue: trailWarp
uniform vec3 u_centre;     // uv the warp is about, and width / height
out vec4 outColour;

void main() {
  vec2 d = (v_uv - u_centre.xy) * vec2(u_centre.z, 1.0);
  float c = cos(u_warp.z);
  float s = sin(u_warp.z);
  d = vec2(d.x * c - d.y * s, d.x * s + d.y * c) * (1.0 - u_warp.y);
  vec3 last = texture(u_last, u_centre.xy + d / vec2(u_centre.z, 1.0)).rgb;
  // hueTurn, as trip.ts writes it.
  float hc = cos(u_warp.w);
  float hs = sin(u_warp.w) * 0.5773502691896258;
  float grey = (last.r + last.g + last.b) / 3.0 * (1.0 - hc);
  vec3 turned = last * hc + vec3(last.b - last.g, last.r - last.b, last.g - last.r) * hs + grey;
  outColour = vec4(max(turned, vec3(0.0)), u_warp.x);
}
`;

export class TrailPass {
  private readonly uniforms: Uniforms;
  private readonly vao: WebGLVertexArrayObject;
  private readonly last: WebGLTexture;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.uniforms = new Uniforms(gl, program(gl, RAIN_VERTEX, TRAIL_FRAGMENT));
    this.vao = gl.createVertexArray();
    this.last = gl.createTexture();
  }

  /** Lay the last frame over this one, then keep this one. The first frame at a size only keeps. */
  draw(trail: TrailFrame): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + LAST_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.last);
    if (this.fit(trail.width, trail.height)) {
      gl.useProgram(this.uniforms.target);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(this.uniforms.at("u_last"), LAST_UNIT);
      gl.uniform4f(this.uniforms.at("u_warp"), trail.keep, trail.zoom, trail.spin, trail.hue);
      // Texture rows count from the bottom here.
      gl.uniform3f(this.uniforms.at("u_centre"), trail.centre[0], 1 - trail.centre[1], trail.width / trail.height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, trail.width, trail.height);
  }

  /** Size the kept frame to the drawing buffer; false when it was just remade and holds nothing yet. */
  private fit(width: number, height: number): boolean {
    if (width === this.width && height === this.height) {
      return true;
    }
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return false;
  }
}
