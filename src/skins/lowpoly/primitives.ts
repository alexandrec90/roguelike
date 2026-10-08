/**
 * The handful of solids everything in the skin is built from: a tapered prism,
 * a cone, a jittered icosahedron, a smooth one and a flat disc.
 *
 * Every one is a few dozen triangles at most. That is the style - the facets
 * are the point - and it is also why the skin is cheap: a whole tree is under
 * fifty triangles, where a GPU draws millions a frame.
 */

import { FLAT_LOOK, type Look } from "./look";
import { hash01, faceTint } from "./palette";
import { faceNormal, MeshBuilder, type FaceStyle, type Vec3 } from "./mesh";

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
    const faceSeed = seed + face * 104729;
    facet(b, [corners[i]!, corners[j]!, corners[k]!], { ...style, colour: faceTint(style.colour, faceSeed, look, shape.crown === true), inside: centre }, faceSeed, look);
  });
}

/** How far a split face's three small faces stray in colour from it, either way: enough to light apart. */
const SPLIT_TINT = 0.06;

/**
 * One face - or, under a look that splits faces (`look.split` of them, by
 * seed), three small faces round its middle, the middle pushed out along the
 * face's normal (a bump) or in (a dent) by up to `look.bump` of the face's
 * size. So a solid's faces are not all one size, and not all convex. Each small
 * face is tinted a hair apart, so the shaders pick each its own colour of light.
 */
export function facet(b: MeshBuilder, [p, q, r]: readonly [Vec3, Vec3, Vec3], style: FaceStyle, seed: number, look: Look = FLAT_LOOK): void {
  const normal = look.split > 0 && hash01(seed + 0x5b1) < look.split ? faceNormal(p, q, r) : null;
  if (normal === null) {
    b.tri(p, q, r, style);
    return;
  }
  const centroid: Vec3 = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
  const inside = style.inside;
  const outward =
    inside === undefined || normal[0] * (centroid[0] - inside[0]) + normal[1] * (centroid[1] - inside[1]) + normal[2] * (centroid[2] - inside[2]) >= 0 ? 1 : -1;
  const size = (Math.hypot(...sub(q, p)) + Math.hypot(...sub(r, q)) + Math.hypot(...sub(p, r))) / 3;
  const push = outward * (hash01(seed + 0x5b3) * 2 - 1) * look.bump * size;
  const middle: Vec3 = [centroid[0] + normal[0] * push, centroid[1] + normal[1] * push, centroid[2] + normal[2] * push];
  const tint = { ...look, hueDrift: 0, faceSpread: SPLIT_TINT };
  [[p, q], [q, r], [r, p]].forEach(([from, to], k) => {
    b.tri(from!, to!, middle, { ...style, colour: faceTint(style.colour, seed + 0x5c0 + k, tint) });
  });
}

interface Sphere {
  /** Unit directions, one per corner. */
  readonly corners: readonly Vec3[];
  /** Corner indices, each face wound outward. */
  readonly faces: readonly (readonly [number, number, number])[];
}

/** The icosahedron with every face split in four and pushed out onto the sphere. */
function subdividedSphere(): Sphere {
  const corners: Vec3[] = ICO_VERTICES.map((v) => normalise(v));
  const midpoints = new Map<string, number>();
  const midpoint = (i: number, j: number): number => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    let index = midpoints.get(key);
    if (index === undefined) {
      index = corners.length;
      corners.push(normalise(lerp(corners[i]!, corners[j]!, 0.5)));
      midpoints.set(key, index);
    }
    return index;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of ICO_FACES) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    for (const face of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [number, number, number][]) {
      const [p, q, r] = face.map((index) => corners[index]!) as [Vec3, Vec3, Vec3];
      const n = cross(sub(q, p), sub(r, p));
      const centroid = lerp(lerp(p, q, 0.5), r, 1 / 3);
      faces.push(dot(n, centroid) < 0 ? [face[0], face[2], face[1]] : face);
    }
  }
  return { corners, faces };
}

let sphere: Sphere | undefined;

/** Faces in a `smoothBlob`: the icosahedron's twenty, each split in four. */
export const SMOOTH_FACES = ICO_FACES.length * 4;

/**
 * A soft closed surface: each corner of a once-split icosahedron placed by
 * `surface` from its unit direction, with a normal per corner averaged from the
 * faces round it - so the light rolls across it instead of breaking at facets.
 * `surface` may stretch, sag and ripple the sphere as it likes, as long as it
 * keeps it from folding through itself.
 *
 * With `facing`, only the faces turned toward that direction are made: the back
 * half of a sheer body, which would otherwise blend through the front in
 * whatever order its triangles happened to come.
 */
export function smoothBlob(b: MeshBuilder, surface: (direction: Vec3) => Vec3, style: Style, facing?: Vec3): void {
  sphere ??= subdividedSphere();
  const points = sphere.corners.map(surface);
  const normals: [number, number, number][] = points.map(() => [0, 0, 0]);
  const faceNormals = sphere.faces.map(([i, j, k]) => {
    // Unnormalised, so a corner leans toward its larger faces.
    const n = cross(sub(points[j]!, points[i]!), sub(points[k]!, points[i]!));
    for (const index of [i, j, k]) {
      const sum = normals[index]!;
      sum[0] += n[0];
      sum[1] += n[1];
      sum[2] += n[2];
    }
    return n;
  });
  const unit = normals.map((n): Vec3 => (Math.hypot(...n) < 1e-12 ? [0, 0, 1] : normalise(n)));
  sphere.faces.forEach(([i, j, k], face) => {
    if (facing !== undefined && dot(faceNormals[face]!, facing) <= 0) {
      return;
    }
    b.smoothTri(points[i]!, points[j]!, points[k]!, [unit[i]!, unit[j]!, unit[k]!], style);
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
    const faceSeed = seed + k * 104729;
    facet(b, [apex, corner, rim[(k + 1) % rim.length]!], { ...style, colour: faceTint(style.colour, faceSeed, look, true), inside: below }, faceSeed, look);
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

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
