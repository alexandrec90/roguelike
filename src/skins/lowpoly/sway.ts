/**
 * Plants that lean: the wind through the grass and the trees, and everything
 * the fight does to them - the hero parting the grass as he walks, a slime
 * shouldering through it, a swing, a nova or a blast flattening a ring of it.
 *
 * All of it is a vertex offset, worked out in the world shader from a few
 * uniforms, so it costs no pass, no draw and no rebuilt buffer: the chunks stay
 * static and only the frame's numbers change. A vertex of a kind in `SWAYERS`
 * is sheared about its foot by a *lean* - a sideways slope, dimensionless -
 * that is the sum of two terms:
 *
 * - **The wind**, the shared `wind.ts` field written so a GPU can afford it: the
 *   gust envelope (`gustAt`) is one number a frame, and the travelling carrier
 *   and its turbulence are sines over the planet whose phases the CPU wraps, so
 *   the shader's clock never runs out of precision. It blows across the screen,
 *   as the rain slants, in both skins.
 * - **Pushes** (`sway-pushes.ts`): up to `MAX_PUSHES` rings over the ground, each
 *   a centre, a front radius and a strength. A body pushes as a ring of radius
 *   zero (a soft disc round it); a nova as a ring racing out. Everything leans
 *   away from the centre, most where it stands on the front.
 *
 * How far each kind bends for a lean is one row of `SWAYERS`, and the shader's
 * copy of the table is generated from it. Bend depends only on a vertex's
 * height and its body's foot, so a trunk and its crown - two kinds with one
 * bend - never part.
 *
 * `swayOffset` is the reference; `SWAY_GLSL` and `SWAY_WGSL` are it again for
 * the two backends. Change one, change all three.
 */

import { PLANET_TILES, type PlanetPoint } from "../../game/planet";
import { gustAt } from "../../game/wind";
import { Kind } from "./mesh";

/** Push rings a frame can carry: one `vec4` each. */
export const MAX_PUSHES = 8;

/** How wide a push's front is, tiles: also the radius of a body's soft disc. */
export const PUSH_WIDTH = 0.55;

/** Lean per unit of wind: a normal breezy gust tips a blade a few degrees. */
export const WIND_LEAN = 0.35;

/** The most a plant leans, whatever is pushing it: past this a blade would lie flat. */
export const MAX_LEAN = 1.1;

/**
 * How a kind bends. A vertex `z` tiles up moves `z × (flex + z × crown)` tiles
 * per unit of lean: `flex` bends from the root, `crown` from high up, so a
 * crown swings while the foot of its trunk stays put. `push` is the kind's
 * share of a push, and `droop` how much shorter it gets bowed right over.
 */
export interface SwayRow {
  readonly flex: number;
  readonly crown: number;
  readonly push: number;
  readonly droop: number;
}

/** Every kind that sways, and how. A kind not here stands still. */
export const SWAYERS: Readonly<Partial<Record<Kind, SwayRow>>> = {
  /** A tree, trunk and crown alike, or a bush: the crown swings, the trunk's foot stays put. */
  [Kind.foliage]: { flex: 0.12, crown: 0.03, push: 0.3, droop: 0 },
  /** Bends from the root and is parted by anything walking through. */
  [Kind.grass]: { flex: 0.9, crown: 0, push: 1, droop: 0.3 },
  /** A mushroom: nods in the wind, leans from a passing foot rather than lying flat. */
  [Kind.sprig]: { flex: 0.4, crown: 0, push: 0.45, droop: 0.1 },
};

/** Wave numbers of the wind's carrier and turbulence round one lap: whole, so the planet's seam is invisible. */
const CARRIER_WAVES: readonly [number, number] = [24, 13];
const TURBULENCE_WAVES: readonly [number, number] = [-9, 17];

/** Radians a second of the carrier and the turbulence: `windAt`'s `1.7 / 0.9 s` and `1 / 0.52 s`. */
const CARRIER_RATE = 1.7 / 0.9;
const TURBULENCE_RATE = 1 / 0.52;

/** `windAt`'s mix of the two. */
const CARRIER_SHARE = 0.68;
const TURBULENCE_SHARE = 0.42;

const TAU = Math.PI * 2;

/** Radians per tile of a wave that fits a whole number of times round the planet. */
export const LAP_RAD = TAU / PLANET_TILES;

/** The wind and the pushes as the shaders read them. */
export interface SwayState {
  /** Carrier phase, turbulence phase (both wrapped to 0..2π), gust strength, unused. */
  readonly wind: readonly [number, number, number, number];
  /** `MAX_PUSHES` × (planet x from the hero, y, front radius, strength); strength 0 is an empty slot. */
  readonly pushes: Float32Array;
}

/** No wind at all: what the frame carries when the sway is switched off (`?off=sway`). */
export const STILL_WIND: SwayState["wind"] = [0, 0, 0, 0];

/** The wind's phases and its strength for a world time - `gustAt`'s envelope times the weather's wind. */
export function windUniform(elapsedMs: number, weatherWind: number): SwayState["wind"] {
  const seconds = elapsedMs / 1000;
  return [(seconds * CARRIER_RATE) % TAU, (seconds * TURBULENCE_RATE) % TAU, gustAt(elapsedMs) * weatherWind, 0];
}

/** The signed sideways wind at a planet point, in `windAt`'s -1..1 before strength. */
export function windAtPlanet(wind: SwayState["wind"], point: PlanetPoint): number {
  const carrier = Math.sin(wind[0] - LAP_RAD * (CARRIER_WAVES[0] * point.x + CARRIER_WAVES[1] * point.y));
  const turbulence = Math.sin(wind[1] + LAP_RAD * (TURBULENCE_WAVES[0] * point.x + TURBULENCE_WAVES[1] * point.y));
  return wind[2] * (CARRIER_SHARE * carrier + TURBULENCE_SHARE * turbulence);
}

/**
 * The lean a set of pushes gives a plant whose foot is `foot` (planet tiles from
 * the hero): away from each centre, most on its front.
 */
export function pushLean(pushes: Float32Array, foot: readonly [number, number]): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < pushes.length; i += 4) {
    const strength = pushes[i + 3]!;
    if (strength === 0) {
      continue;
    }
    const dx = foot[0] - pushes[i]!;
    const dy = foot[1] - pushes[i + 1]!;
    const distance = Math.hypot(dx, dy);
    const across = (distance - pushes[i + 2]!) / PUSH_WIDTH;
    // Divided by a little more than the distance: a plant dead under the centre has no "away", so it barely leans.
    const k = (strength * Math.exp(-across * across)) / (distance + 0.08);
    x += dx * k;
    y += dy * k;
  }
  return [x, y];
}

/**
 * Where a vertex of a swaying body moves: its offset in *local* tiles (x right,
 * y ahead, z up) to add to its place about its foot. `turn` is the draw's turn,
 * planet to local; `z` the vertex's height over its foot.
 */
export function swayOffset(
  kind: Kind,
  sway: SwayState,
  foot: readonly [number, number],
  hero: PlanetPoint,
  z: number,
  turn: number,
): readonly [number, number, number] {
  const row = SWAYERS[kind];
  if (row === undefined) {
    return [0, 0, 0];
  }
  const [px, py] = pushLean(sway.pushes, foot);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const wind = windAtPlanet(sway.wind, { x: foot[0] + hero.x, y: foot[1] + hero.y }) * WIND_LEAN;
  let lx = wind + (px * cos - py * sin) * row.push;
  let ly = (px * sin + py * cos) * row.push;
  const lean = Math.hypot(lx, ly);
  if (lean > MAX_LEAN) {
    lx *= MAX_LEAN / lean;
    ly *= MAX_LEAN / lean;
  }
  const bend = z * (row.flex + z * row.crown);
  const drop = -z * row.droop * Math.min(lx * lx + ly * ly, 1);
  return [lx * bend, ly * bend, drop];
}

export const glslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** `SWAYERS` as a chain of tests on the kind, in either language: `vec4(flex, crown, push, droop)`, or zero. */
function swayTable(kindLiteral: (kind: number) => string, vec4: string): string {
  const rows = Object.entries(SWAYERS).map(([kind, row]) => {
    const values = [row!.flex, row!.crown, row!.push, row!.droop].map(glslFloat).join(", ");
    return `  if (kind == ${kindLiteral(Number(kind))}) { return ${vec4}(${values}); }`;
  });
  return `${rows.join("\n")}\n  return ${vec4}(0.0);`;
}

const CARRIER = `${glslFloat(CARRIER_WAVES[0])}, ${glslFloat(CARRIER_WAVES[1])}`;
const TURBULENCE = `${glslFloat(TURBULENCE_WAVES[0])}, ${glslFloat(TURBULENCE_WAVES[1])}`;

/**
 * `swayOffset` in GLSL. Needs `u_wind`, `u_pushes[MAX_PUSHES]` and `u_hero`
 * declared; `turned` is the world shader's own.
 */
export const SWAY_GLSL = `
const float LAP_RAD = ${glslFloat(LAP_RAD)};

vec4 swayOf(int kind) {
${swayTable((kind) => `${kind}`, "vec4")}
}

vec2 pushLean(vec2 foot) {
  vec2 lean = vec2(0.0);
  for (int i = 0; i < ${MAX_PUSHES}; i++) {
    vec4 p = u_pushes[i];
    vec2 d = foot - p.xy;
    float dist = length(d);
    float across = (dist - p.z) / ${glslFloat(PUSH_WIDTH)};
    lean += d * (p.w * exp(-across * across) / (dist + 0.08));
  }
  return lean;
}

vec3 swayOffset(int kind, vec2 foot, float z) {
  vec4 row = swayOf(kind);
  if (row.x == 0.0 && row.y == 0.0) {
    return vec3(0.0);
  }
  vec2 planet = foot + u_hero;
  float carrier = sin(u_wind.x - LAP_RAD * dot(planet, vec2(${CARRIER})));
  float turbulence = sin(u_wind.y + LAP_RAD * dot(planet, vec2(${TURBULENCE})));
  float wind = u_wind.z * (${glslFloat(CARRIER_SHARE)} * carrier + ${glslFloat(TURBULENCE_SHARE)} * turbulence) * ${glslFloat(WIND_LEAN)};
  vec2 lean = vec2(wind, 0.0) + turned(pushLean(foot)) * row.z;
  float size = length(lean);
  if (size > ${glslFloat(MAX_LEAN)}) {
    lean *= ${glslFloat(MAX_LEAN)} / size;
  }
  float bend = z * (row.x + z * row.y);
  return vec3(lean * bend, -z * row.w * min(dot(lean, lean), 1.0));
}
`;

/**
 * `swayOffset` with the sway switched off (`?off=sway`), in either language:
 * nothing leans, and none of the wind's or the pushes' arithmetic is compiled
 * into the vertex shader, so a frame without sway costs what it would if the
 * sway had never been written.
 */
export const SWAY_STILL_GLSL = `
vec3 swayOffset(int kind, vec2 foot, float z) {
  return vec3(0.0);
}
`;

export const SWAY_STILL_WGSL = `
fn swayOffset(kind: u32, foot: vec2f, z: f32, rot: vec2f) -> vec3f {
  return vec3f(0.0);
}
`;

/** `swayOffset` in WGSL. Reads `frame.wind`, `frame.pushes` and `frame.hero`; `turned` is the world shader's own. */
export const SWAY_WGSL = `
const LAP_RAD = ${glslFloat(LAP_RAD)};

fn swayOf(kind: u32) -> vec4f {
${swayTable((kind) => `${kind}u`, "vec4f")}
}

fn pushLean(foot: vec2f) -> vec2f {
  var lean = vec2f(0.0);
  for (var i = 0; i < ${MAX_PUSHES}; i++) {
    let p = frame.pushes[i];
    let d = foot - p.xy;
    let dist = length(d);
    let across = (dist - p.z) / ${glslFloat(PUSH_WIDTH)};
    lean += d * (p.w * exp(-across * across) / (dist + 0.08));
  }
  return lean;
}

fn swayOffset(kind: u32, foot: vec2f, z: f32, rot: vec2f) -> vec3f {
  let row = swayOf(kind);
  if (row.x == 0.0 && row.y == 0.0) {
    return vec3f(0.0);
  }
  let planet = foot + frame.hero.xy;
  let carrier = sin(frame.wind.x - LAP_RAD * dot(planet, vec2f(${CARRIER})));
  let turbulence = sin(frame.wind.y + LAP_RAD * dot(planet, vec2f(${TURBULENCE})));
  let wind = frame.wind.z * (${glslFloat(CARRIER_SHARE)} * carrier + ${glslFloat(TURBULENCE_SHARE)} * turbulence) * ${glslFloat(WIND_LEAN)};
  var lean = vec2f(wind, 0.0) + turned(pushLean(foot), rot) * row.z;
  let size = length(lean);
  if (size > ${glslFloat(MAX_LEAN)}) {
    lean *= ${glslFloat(MAX_LEAN)} / size;
  }
  let bend = z * (row.x + z * row.y);
  return vec3f(lean * bend, -z * row.w * min(dot(lean, lean), 1.0));
}
`;
