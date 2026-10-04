/**
 * The few WebGL2 chores every pass of the skin repeats: compile and link a
 * program, and remember where its uniforms are.
 */

export function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const made = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) {
      throw new Error("Could not create a shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Low-poly shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
    }
    gl.attachShader(made, shader);
  }
  gl.linkProgram(made);
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) {
    throw new Error(`Low-poly program failed to link: ${gl.getProgramInfoLog(made) ?? ""}`);
  }
  return made;
}

/** A program's uniform locations, looked up once each. */
export class Uniforms {
  private readonly known = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly target: WebGLProgram,
  ) {}

  at(name: string): WebGLUniformLocation | null {
    if (!this.known.has(name)) {
      this.known.set(name, this.gl.getUniformLocation(this.target, name));
    }
    return this.known.get(name) ?? null;
  }
}
