/**
 * The handful of solids everything in the skin is built from: a tapered prism,
 * a cone, a jittered icosahedron and a flat disc.
 *
 * Every one is a few dozen triangles at most. That is the style - the facets
 * are the point - and it is also why the skin is cheap: a whole tree is under
 * fifty triangles, where a GPU draws millions a frame.
 */

import { FLAT_LOOK, type Look } from "./look";
import { hash01, faceTint } from "./palette";
import { MeshBuilder, type FaceStyle, type Vec3 } from "./mesh";

type Style = Omit<FaceStyle, "inside">;

/** A tapered prism: from `from` to `to`, radius `r0` at the start and `r1` at the end, `sides` faces round. */
export interface FrustumShape {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly r0: number;
  readonly r1: number;
  readonly sides: number;
  /** False leaves both ends open: a branch whose ends hide in its parent and its leaves. */
  readonly capped?: boolean;
}

/** A tapered prism, capped both ends unless told not to. A limb, a trunk, a stem. */
export function frustum(b: MeshBuilder, shape: FrustumShape, style: Style): void {
  const { from, to, r0, r1, sides, capped = true } = shape;
  const axis = sub(to, from);
  const length = Math.hypot(...axis);
  if (length < 1e-6) {
    return;
  }
  const a: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length];
  const ref: Vec3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalise(cross(a, ref));
  const v = cross(a, u);
  const ring = (centre: Vec3, radius: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2;
      const cu = Math.cos(angle) * radius;
      const cv = Math.sin(angle) * radius;
      return [centre[0] + u[0] * cu + v[0] * cv, centre[1] + u[1] * cu + v[1] * cv, centre[2] + u[2] * cu + v[2] * cv];
    });
  const near = ring(from, r0);
  const far = ring(to, r1);
  const inside = lerp(from, to, 0.5);
  const faced = { ...style, inside };
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    b.quad(near[i]!, near[j]!, far[j]!, far[i]!, faced);
  }
  for (let i = 1; capped && i < sides - 1; i += 1) {
    b.tri(near[0]!, near[i]!, near[i + 1]!, faced);
    b.tri(far[0]!, far[i]!, far[i + 1]!, faced);
  }
}

/** A cone standing on `base`, apex `height` above it; `phase` turns its corners. */
export interface ConeShape {
  readonly base: Vec3;
  readonly height: number;
  readonly radius: number;
  readonly sides: number;
  readonly phase?: number;
}

/** A cone with a capped base. A conifer's tier, a mushroom cap. */
export function cone(b: MeshBuilder, shape: ConeShape, style: Style): void {
  const { base, height, radius, sides, phase = 0 } = shape;
  const apex: Vec3 = [base[0], base[1], base[2] + height];
  const inside: Vec3 = [base[0], base[1], base[2] + height * 0.3];
  const rim: Vec3[] = Array.from({ length: sides }, (_, i) => {
    const angle = phase + (i / sides) * Math.PI * 2;
    return [base[0] + Math.cos(angle) * radius, base[1] + Math.sin(angle) * radius, base[2]];
  });
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    b.tri(rim[i]!, rim[j]!, apex, { ...style, inside });
    if (i > 0 && i < sides - 1) {
      b.tri(rim[0]!, rim[i]!, rim[i + 1]!, { ...style, inside });
    }
  }
}

const PHI = (1 + Math.sqrt(5)) / 2;

/** The icosahedron's twelve corners, on a sphere of radius √(1 + φ²). */
const ICO_VERTICES: readonly Vec3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const ICO_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const ICO_RADIUS = Math.hypot(1, PHI);

/** Faces in a `blob`: twenty, the whole icosahedron. */
export const BLOB_FACES = ICO_FACES.length;

/** How lumpy a `blob` is, and how it is painted beyond its colour. */
export interface BlobShape {
  /** How far each corner is pushed in or out, as a share of its radius; 0.15 unless given. */
  readonly jitter?: number;
  readonly look?: Look;
  /** A crown: drawn up into the look's `peak`, and allowed its accent faces. */
  readonly crown?: boolean;
}

/**
 * A lumpy solid: an icosahedron stretched to `radii`, each corner pushed in or
 * out by up to `jitter` of its radius, seeded. A crown, a bush, a boulder, a
 * slime. Each face gets its own nudge of colour (`faceTint`), which is what
 * reads as a facet catching the light differently from its neighbour.
 *
 * The look decides how far from a ball it strays: under the painted look the
 * jitter grows, each axis is stretched by its own seeded share, the top leans
 * off-centre, and a crown's upper corners are drawn up into a point - the
 * flame-shaped tree of a flat-colour landscape rather than a dented sphere.
 */
export function blob(b: MeshBuilder, centre: Vec3, radii: Vec3, style: Style, seed: number, shape: BlobShape = {}): void {
  const look = shape.look ?? FLAT_LOOK;
  const spread = (shape.jitter ?? 0.15) * look.jitter;
  const axis = (n: number): number => 1 + (hash01(seed + 0x5a1 + n) * 2 - 1) * look.stretch;
  const r: Vec3 = [radii[0] * axis(0), radii[1] * axis(1), radii[2] * axis(2)];
  const lean = (hash01(seed + 0x5a5) * 2 - 1) * look.stretch;
  const leanAngle = hash01(seed + 0x5a7) * Math.PI * 2;
  const peak = shape.crown === true ? look.peak : 0;
  const corners = ICO_VERTICES.map((corner, index): Vec3 => {
    const k = (1 + (hash01(seed + index * 7919) * 2 - 1) * spread) / ICO_RADIUS;
    // How high this corner sits on the solid, -1..1: the top leans and points, the bottom stays put.
    const up = Math.max(0, corner[2] / ICO_RADIUS);
    const shift = lean * up * r[2];
    return [
      centre[0] + corner[0] * r[0] * k + Math.cos(leanAngle) * shift,
      centre[1] + corner[1] * r[1] * k + Math.sin(leanAngle) * shift,
      centre[2] + corner[2] * r[2] * k * (1 + peak * up),
    ];
  });
  ICO_FACES.forEach(([i, j, k], face) => {
    b.tri(corners[i]!, corners[j]!, corners[k]!, {
      ...style,
      colour: faceTint(style.colour, seed + face * 104729, look, shape.crown === true),
      inside: centre,
    });
  });
}

/**
 * A plate of leaves: a shallow fan from a raised middle out to a rim of
 * `teeth` points, notched between them, the points hanging lower than the
 * notches. `centre` is at the notches' height.
 */
export interface FrondShape {
  readonly centre: Vec3;
  readonly radius: number;
  readonly teeth: number;
  /** How far the middle stands above the notches. */
  readonly lift: number;
  /** How far a point hangs below the notches. */
  readonly droop: number;
  /** A notch's reach as a share of a point's. */
  readonly notch?: number;
  readonly phase?: number;
}

/** Triangles in a `frond` of `teeth` points: two a point, one either side of it. */
export function frondFaces(teeth: number): number {
  return teeth * 2;
}

/**
 * A serrated, drooping plate - one tier of a broadleaf's foliage, the way
 * stylised low-poly foliage is drawn: a layer, not a ball. Every face is turned
 * to the sky, so it lights as the top of a canopy from any side, and each point
 * is seeded a little longer or shorter so no two plates share an outline.
 * Foliage is crown, so under the painted `look` its faces drift in hue and
 * may take the accent, as a blob crown's do.
 */
export function frond(b: MeshBuilder, shape: FrondShape, style: Style, seed: number, look: Look = FLAT_LOOK): void {
  const { centre, radius, teeth, lift, droop, notch = 0.62, phase = 0 } = shape;
  const apex: Vec3 = [centre[0], centre[1], centre[2] + lift];
  const below: Vec3 = [centre[0], centre[1], centre[2] - radius * 8];
  const rim: Vec3[] = Array.from({ length: teeth * 2 }, (_, k) => {
    const point = k % 2 === 0;
    const wobble = hash01(seed + k * 7919);
    const angle = phase + (k * Math.PI) / teeth + (wobble - 0.5) * (0.5 / teeth);
    const reach = point ? radius * (0.85 + wobble * 0.3) : radius * notch;
    const z = point ? centre[2] - droop * (0.7 + wobble * 0.6) : centre[2];
    return [centre[0] + Math.cos(angle) * reach, centre[1] + Math.sin(angle) * reach, z];
  });
  rim.forEach((corner, k) => {
    b.tri(apex, corner, rim[(k + 1) % rim.length]!, {
      ...style,
      colour: faceTint(style.colour, seed + k * 104729, look, true),
      inside: below,
    });
  });
}

/**
 * A flat polygon lying at height `centre[2]`: a shadow, a pond, a lake. `radius`
 * may vary per corner, which is how a lake gets a ragged shore.
 */
export function disc(b: MeshBuilder, centre: Vec3, radius: number | ((corner: number) => number), sides: number, style: Style): void {
  const at = typeof radius === "number" ? () => radius : radius;
  const rim: Vec3[] = Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    const r = at(i);
    return [centre[0] + Math.cos(angle) * r, centre[1] + Math.sin(angle) * r, centre[2]];
  });
  for (let i = 0; i < sides; i += 1) {
    b.tri(centre, rim[i]!, rim[(i + 1) % sides]!, style);
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
