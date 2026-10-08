/**
 * Flat-shaded triangles, packed for the GPU as they are made.
 *
 * Low poly *is* flat shading: every face one colour and one normal, so the
 * facets read. That means no vertex is shared between two triangles - each
 * carries its face's normal - which is the price of the look, and a small one
 * at this triangle count.
 *
 * One vertex is `VERTEX_BYTES`, interleaved:
 *
 * | Field  | Type        | Meaning                                                    |
 * | ------ | ----------- | ---------------------------------------------------------- |
 * | pos    | 3 × float32 | tiles from the draw's origin: x, y on the ground, z up     |
 * | anchor | 2 × float32 | the foot of the body this vertex belongs to, same frame     |
 * | normal | 4 × int8    | the face normal × 127, then the vertex `Kind`              |
 * | colour | 4 × uint8   | rgb, and opacity                                           |
 *
 * The anchor is what makes the horizon lip work (`placement.ts`): a body on the
 * lip is placed, shrunk and sunk as one thing about its foot, the way the pixel
 * skin places a sprite, while the ground and a landform - whose every vertex
 * is its own foot - bend over the lip point by point.
 */

export const VERTEX_BYTES = 28;

/** What a vertex is, which decides how the shader treats it. */
export const Kind = {
  /** A lit, solid body: a tree, a rock, the hero. */
  body: 0,
  /** The ground and anything lying flat on it: ends at the horizon line. */
  ground: 1,
  /** A cast shadow: sheer, darkens what it lies on, fades with the light. */
  shadow: 2,
  /** Standing water: sheer, takes the sky's colour. */
  water: 3,
  /** Unlit and bright: fire, a spell. */
  glow: 4,
  /** A landform: lit as a body, and cut from the window round the hero (`cutaway.ts`). */
  land: 5,
  /** A body that sways from high up: a tree, a bush (`sway.ts`). Lit as a body. */
  foliage: 6,
  /** A blade that bends from its root, and parts round whatever walks through it (`sway.ts`). Lit as a body. */
  grass: 7,
  /** A mushroom: nods, stiffer than grass (`sway.ts`). Lit as a body. */
  sprig: 8,
  /**
   * Jelly: sheer and glossy - lit like a body, plus a highlight and a rim that
   * thickens toward the silhouette, as a drop of liquid does. A slime's skin.
   */
  liquid: 9,
} as const;

export type Kind = (typeof Kind)[keyof typeof Kind];

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export interface FaceStyle {
  readonly colour: Rgb;
  readonly kind?: Kind;
  /** 0..1; 1 unless the kind is sheer. */
  readonly alpha?: number;
  /** The body's foot; omitted, each vertex is its own (ground, landforms). */
  readonly anchor?: readonly [number, number];
  /**
   * A point inside the solid this face bounds. The normal is turned to face
   * away from it, so a primitive need not care which way it wound a triangle.
   */
  readonly inside?: Vec3;
}

export class MeshBuilder {
  private buffer = new ArrayBuffer(VERTEX_BYTES * 3 * 64);
  private floats = new Float32Array(this.buffer);
  private bytes = new Uint8Array(this.buffer);
  private count = 0;

  get vertexCount(): number {
    return this.count;
  }

  /** One flat triangle. A degenerate one (no area) is dropped. */
  tri(a: Vec3, b: Vec3, c: Vec3, style: FaceStyle): void {
    let normal = faceNormal(a, b, c);
    if (normal === null) {
      return;
    }
    const inside = style.inside;
    if (inside !== undefined) {
      const out = [(a[0] + b[0] + c[0]) / 3 - inside[0], (a[1] + b[1] + c[1]) / 3 - inside[1], (a[2] + b[2] + c[2]) / 3 - inside[2]];
      if (normal[0] * out[0]! + normal[1] * out[1]! + normal[2] * out[2]! < 0) {
        normal = [-normal[0], -normal[1], -normal[2]];
      }
    } else if (liesFlat(style.kind) && normal[2] < 0) {
      // Anything lying on the ground faces the sky, whichever way it was wound.
      normal = [-normal[0], -normal[1], -normal[2]];
    }
    this.reserve(3);
    for (const vertex of [a, b, c]) {
      this.push(vertex, normal, style);
    }
  }

  /**
   * One triangle with a normal per corner, so the shader blends them across it
   * and the surface reads as curved rather than faceted. For the few things that
   * are meant to look soft - a slime's jelly - against a faceted world.
   */
  smoothTri(a: Vec3, b: Vec3, c: Vec3, normals: readonly [Vec3, Vec3, Vec3], style: Omit<FaceStyle, "inside">): void {
    if (faceNormal(a, b, c) === null) {
      return;
    }
    this.reserve(3);
    this.push(a, normals[0], style);
    this.push(b, normals[1], style);
    this.push(c, normals[2], style);
  }

  /** Two triangles, `a b c` and `a c d`: a quad wound in order. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, style: FaceStyle): void {
    this.tri(a, b, c, style);
    this.tri(a, c, d, style);
  }

  /** Exactly the vertices made, as one upload. */
  bytesView(): Uint8Array {
    return this.bytes.subarray(0, this.count * VERTEX_BYTES);
  }

  /** Start again, keeping the storage: the dynamic meshes are rebuilt every frame. */
  reset(): void {
    this.count = 0;
  }

  private push(vertex: Vec3, normal: Vec3, style: FaceStyle): void {
    const base = this.count * VERTEX_BYTES;
    const f = base / 4;
    this.floats[f] = vertex[0];
    this.floats[f + 1] = vertex[1];
    this.floats[f + 2] = vertex[2];
    this.floats[f + 3] = style.anchor?.[0] ?? vertex[0];
    this.floats[f + 4] = style.anchor?.[1] ?? vertex[1];
    // int8 two's complement into the byte view.
    this.bytes[base + 20] = Math.round(normal[0] * 127) & 0xff;
    this.bytes[base + 21] = Math.round(normal[1] * 127) & 0xff;
    this.bytes[base + 22] = Math.round(normal[2] * 127) & 0xff;
    this.bytes[base + 23] = style.kind ?? Kind.body;
    this.bytes[base + 24] = toByte(style.colour[0]);
    this.bytes[base + 25] = toByte(style.colour[1]);
    this.bytes[base + 26] = toByte(style.colour[2]);
    this.bytes[base + 27] = toByte(style.alpha ?? 1);
    this.count += 1;
  }

  private reserve(vertices: number): void {
    const needed = (this.count + vertices) * VERTEX_BYTES;
    if (needed <= this.buffer.byteLength) {
      return;
    }
    let size = this.buffer.byteLength * 2;
    while (size < needed) {
      size *= 2;
    }
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(this.bytes.subarray(0, this.count * VERTEX_BYTES));
    this.buffer = grown;
    this.floats = new Float32Array(grown);
    this.bytes = new Uint8Array(grown);
  }
}

/** The kinds that lie on the ground rather than stand on it. */
function liesFlat(kind: Kind | undefined): boolean {
  return kind === Kind.ground || kind === Kind.shadow || kind === Kind.water;
}

/** Unit normal of `a b c` by the right-hand rule, or null for a sliver with no area. */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length < 1e-9 ? null : [nx / length, ny / length, nz / length];
}

function toByte(unit: number): number {
  return Math.round(Math.min(Math.max(unit, 0), 1) * 255);
}

/** A colour `#rrggbb` as 0..1 channels. */
export function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** `a` toward `b` by `t`. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Brighter (`amount` > 0) or darker, multiplicatively. */
export function shadeRgb(colour: Rgb, amount: number): Rgb {
  const k = 1 + amount;
  return [colour[0] * k, colour[1] * k, colour[2] * k];
}
