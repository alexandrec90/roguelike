/**
 * Falling rain, as one full-screen pass over the finished frame.
 *
 * Streaks are a lattice of cells in the logical screen, sheared by the wind and
 * scrolled down at their layer's speed; a cell holds a streak if its hash falls
 * under the rain's strength. Three layers at three speeds give depth. No
 * particles, no buffers, nothing on the CPU: the rain's whole cost is this pass,
 * a few hashes a pixel. Where it lands is the water shader's rings.
 */

import { program, Uniforms } from "./gl-util";

export const RAIN_VERTEX = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RAIN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_size;     // logical width, height
uniform vec4 u_rain;     // strength, time (seconds), slant, light
out vec4 outColour;

float hash(vec2 cell, float salt) {
  uvec2 q = uvec2(ivec2(cell) + 4096) * uvec2(1597334673u, 3812015801u) + uint(salt * 131.0);
  uint n = (q.x ^ q.y) * 1597334673u;
  n ^= n >> 15u;
  n *= 2246822519u;
  n ^= n >> 13u;
  return float(n) / 4294967295.0;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  float alpha = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float l = float(layer);
    vec2 cell = vec2(5.0 + l * 2.0, 22.0 + l * 10.0);
    float speed = 150.0 + l * 70.0;
    vec2 q = vec2(p.x - p.y * u_rain.z, p.y - u_rain.y * speed + l * 37.0);
    vec2 index = floor(q / cell);
    vec2 inside = fract(q / cell);
    if (hash(index, l) > u_rain.x * 0.75) {
      continue;
    }
    float column = 0.2 + 0.6 * hash(index, l + 9.0);
    float thin = 1.0 - smoothstep(0.0, 0.5 / cell.x, abs(inside.x - column));
    float span = 0.35 + 0.3 * hash(index, l + 17.0);
    float streak = smoothstep(0.0, 0.08, inside.y) * (1.0 - smoothstep(span - 0.08, span, inside.y));
    alpha = max(alpha, thin * streak * (0.16 + 0.08 * l));
  }
  outColour = vec4(vec3(0.78, 0.84, 0.95) * u_rain.w, alpha);
}
`;

export class RainPass {
  private readonly uniforms: Uniforms;
  private readonly vao: WebGLVertexArrayObject;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.uniforms = new Uniforms(gl, program(gl, RAIN_VERTEX, RAIN_FRAGMENT));
    this.vao = gl.createVertexArray();
  }

  /** Lay the rain over whatever is on screen; nothing at all when it is dry. */
  draw(rain: { strength: number; seconds: number; slant: number; light: number; width: number; height: number }): void {
    if (rain.strength <= 0) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.uniforms.target);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uniforms.at("u_size"), rain.width, rain.height);
    gl.uniform4f(this.uniforms.at("u_rain"), rain.strength, rain.seconds, rain.slant, rain.light);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
