/**
 * The sprite batch: every textured quad the frame draws, in as few draw calls
 * as the textures and blend modes allow.
 *
 * A quad carries which of up to `MAX_UNITS` textures it reads, so a run of
 * images from different textures - scenery bodies, grass, the hero - is still
 * one draw. A batch flushes when a new texture would not fit, when the blend
 * mode changes, or when the target does.
 *
 * Vertices are in logical pixels with y down; the projection maps them so the
 * top of the picture is the top of the target. For a framebuffer that puts the
 * picture's top row at GL's last row, which is the layout a pass shader reads
 * (`texture.ts`).
 */

import { applyBlend, type BlendMode } from "./blend";
import type { Quad } from "./quad";
import type { Texture } from "./texture";

/** Quads per draw call before a flush is forced. */
const MAX_QUADS = 4096;
/** Floats per vertex: x, y, u, v, unit, then the packed colour read as bytes. */
const STRIDE_FLOATS = 6;
const STRIDE_BYTES = STRIDE_FLOATS * 4;

/** Where a batch draws: a framebuffer (null for the canvas) and its size. */
export interface DrawTarget {
  readonly framebuffer: WebGLFramebuffer | null;
  readonly width: number;
  readonly height: number;
}

function vertexSource(): string {
  return `#version 300 es
uniform vec2 u_size;
in vec2 a_position;
in vec2 a_uv;
in float a_unit;
in vec4 a_color;
out vec2 v_uv;
flat out int v_unit;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_position.x / u_size.x * 2.0 - 1.0, 1.0 - a_position.y / u_size.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
  v_unit = int(a_unit + 0.5);
  v_color = a_color;
}
`;
}

/** Sampler arrays may only be indexed by constants in GLSL ES 3.00, hence a switch. */
function fragmentSource(units: number): string {
  const cases = Array.from({ length: units }, (_, unit) => `    case ${unit}: texel = texture(u_textures[${unit}], v_uv); break;`);
  return `#version 300 es
precision mediump float;
uniform sampler2D u_textures[${units}];
in vec2 v_uv;
flat in int v_unit;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec4 texel;
  switch (v_unit) {
${cases.join("\n")}
    default: texel = vec4(0.0); break;
  }
  outColor = texel * v_color;
}
`;
}

export function compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, name: string): WebGLProgram {
  const program = gl.createProgram();
  const stages: WebGLShader[] = [];
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) {
      throw new Error(`Could not create a shader for '${name}'`);
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      throw new Error(`Shader '${name}' failed to compile:\n${gl.getShaderInfoLog(shader) ?? ""}`);
    }
    gl.attachShader(program, shader);
    stages.push(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`Program '${name}' failed to link:\n${gl.getProgramInfoLog(program) ?? ""}`);
  }
  for (const shader of stages) {
    gl.detachShader(program, shader);
    gl.deleteShader(shader);
  }
  return program;
}

/** A colour and an alpha as the premultiplied RGBA bytes a vertex carries, packed little-endian. */
export function packColor(tint: number, alpha: number): number {
  const a = Math.min(Math.max(alpha, 0), 1);
  const r = Math.round(((tint >> 16) & 0xff) * a);
  const g = Math.round(((tint >> 8) & 0xff) * a);
  const b = Math.round((tint & 0xff) * a);
  return (r | (g << 8) | (b << 16) | (Math.round(a * 255) << 24)) >>> 0;
}

export class Batcher {
  readonly units: number;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly floats = new Float32Array(MAX_QUADS * 4 * STRIDE_FLOATS);
  private readonly words = new Uint32Array(this.floats.buffer);
  private readonly sizeLocation: WebGLUniformLocation | null;
  private readonly bound: (Texture | undefined)[];
  private count = 0;
  /** The texture unit and packed colour of the quad being queued. */
  private unit = 0;
  private color = 0;
  private textures: Texture[] = [];
  private blend: BlendMode = "normal";
  private target: DrawTarget | undefined;
  /** Draw calls since `resetStats` - read it when profiling. */
  drawCalls = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.units = Math.min(16, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number);
    this.bound = new Array<Texture | undefined>(this.units);
    this.program = compileProgram(gl, vertexSource(), fragmentSource(this.units), "sprite batch");
    this.sizeLocation = gl.getUniformLocation(this.program, "u_size");
    gl.useProgram(this.program);
    gl.uniform1iv(
      gl.getUniformLocation(this.program, "u_textures"),
      Array.from({ length: this.units }, (_, unit) => unit),
    );

    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (vao === null || vertexBuffer === null || indexBuffer === null) {
      throw new Error("Could not create the sprite batch's buffers");
    }
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.floats.byteLength, gl.DYNAMIC_DRAW);
    const attribute = (name: string, size: number, type: number, normalized: boolean, offset: number) => {
      const location = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, STRIDE_BYTES, offset);
    };
    attribute("a_position", 2, gl.FLOAT, false, 0);
    attribute("a_uv", 2, gl.FLOAT, false, 8);
    attribute("a_unit", 1, gl.FLOAT, false, 16);
    attribute("a_color", 4, gl.UNSIGNED_BYTE, true, 20);
    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let quad = 0; quad < MAX_QUADS; quad += 1) {
      const vertex = quad * 4;
      indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], quad * 6);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** Start drawing into `target`. Flushes whatever was going to the last one. */
  begin(target: DrawTarget): void {
    this.flush();
    this.target = target;
  }

  /**
   * Queue one quad: `quad` from `texture`, multiplied by `tint` (0xRRGGBB) at
   * `alpha`, blended by `blend`.
   */
  draw(texture: Texture, quad: Quad, tint: number, alpha: number, blend: BlendMode): void {
    if (blend !== this.blend) {
      this.flush();
      this.blend = blend;
    }
    let unit = this.textures.indexOf(texture);
    if (unit < 0) {
      if (this.textures.length >= this.units) {
        this.flush();
      }
      unit = this.textures.length;
      this.textures.push(texture);
    }
    if (this.count >= MAX_QUADS) {
      this.flush();
      unit = 0;
      this.textures.push(texture);
    }
    const width = texture.width;
    const height = texture.height;
    const u0 = quad.u0 / width;
    const u1 = quad.u1 / width;
    // A framebuffer's texture stores the top of the picture at its last row.
    const v0 = texture.flipY ? 1 - quad.v0 / height : quad.v0 / height;
    const v1 = texture.flipY ? 1 - quad.v1 / height : quad.v1 / height;
    this.unit = unit;
    this.color = packColor(tint, alpha);
    const at = this.count * 4 * STRIDE_FLOATS;
    this.corner(at, quad.left, quad.top, u0, v0);
    this.corner(at + STRIDE_FLOATS, quad.right, quad.top, u1, v0);
    this.corner(at + STRIDE_FLOATS * 2, quad.left, quad.bottom, u0, v1);
    this.corner(at + STRIDE_FLOATS * 3, quad.right, quad.bottom, u1, v1);
    this.count += 1;
  }

  /** One vertex of the quad being queued, in the unit and colour `draw` just set. */
  private corner(at: number, x: number, y: number, u: number, v: number): void {
    const f = this.floats;
    f[at] = x;
    f[at + 1] = y;
    f[at + 2] = u;
    f[at + 3] = v;
    f[at + 4] = this.unit;
    this.words[at + 5] = this.color;
  }

  /** Send what is queued. */
  flush(): void {
    if (this.count === 0 || this.target === undefined) {
      this.count = 0;
      this.textures = [];
      return;
    }
    const gl = this.gl;
    const target = this.target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.sizeLocation, target.width, target.height);
    gl.enable(gl.BLEND);
    applyBlend(gl, this.blend);
    this.textures.forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture.glTexture);
      this.bound[unit] = texture;
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.floats, 0, this.count * 4 * STRIDE_FLOATS);
    gl.drawElements(gl.TRIANGLES, this.count * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    this.drawCalls += 1;
    this.count = 0;
    this.textures = [];
  }
}
