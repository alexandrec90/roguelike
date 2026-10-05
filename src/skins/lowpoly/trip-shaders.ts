/**
 * The trip's terms (`trip.ts`) in the two shader dialects, written from the
 * same `TRIP` numbers so a retune moves the reference and both GPUs at once.
 *
 * | Function | Stage | Identity when sober |
 * | --- | --- | --- |
 * | `tripSwell(planet)` | vertex | 0 |
 * | `tripBreath(away)` | vertex | 1 |
 * | `tripCurl(footX)` | vertex | 0 (and 0 without `curl`) |
 * | `tripColour(colour, away, normal, mirror)` | fragment | `colour` |
 * | `tripHaze(haze, away)` | fragment | `haze` (and without `haze`) |
 * | `tripNeon(normal, away, daylight)` | fragment | black (and without `neon`) |
 *
 * GLSL reads `u_trip` (amount, seconds, `TRIP_FX` bits, -); WGSL reads
 * `frame.trip`, the same four floats. Neither dialect may use a word the other
 * reserves as a name - `cast` blacked the screen once (`trip.test.ts`).
 */

import { PLANET_TILES } from "../../game/planet";
import { TRIP, TRIP_FX } from "./trip";

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);
const TAU = Math.PI * 2;
const ROOT3 = f(1 / Math.sqrt(3));
const view = TRIP.view.map(f).join(", ");

/** One swell wave's phase at `planet`, as either dialect writes it (`s` is the clock). */
const swellWave = (w: typeof TRIP.swellA | typeof TRIP.swellB, s: string): string =>
  `${f(w.weight)} * sin(${f(TAU / PLANET_TILES)} * (${f(w.kx)} * planet.x + ${f(w.ky)} * planet.y) - ${s} * ${f(w.rate)})`;

/** The trip in GLSL, for both stages of the world program. */
export const TRIP_GLSL = `
uniform vec4 u_trip;  // amount 0..1, shader seconds, TRIP_FX bits, -

bool tripHas(float bit) {
  return u_trip.x > 0.0 && mod(floor(u_trip.z / bit), 2.0) >= 1.0;
}

float tripSwell(vec2 planet) {
  if (u_trip.x <= 0.0) {
    return 0.0;
  }
  return u_trip.x * ${f(TRIP.swellTiles)} * (${swellWave(TRIP.swellA, "u_trip.y")} + ${swellWave(TRIP.swellB, "u_trip.y")});
}

float tripBreath(vec2 away) {
  return 1.0 + u_trip.x * ${f(TRIP.breath)} * sin(u_trip.y * ${f(TRIP.beatRate)} - length(away) * ${f(TRIP.beatSpread)});
}

float tripCurl(float footX) {
  if (!tripHas(${f(TRIP_FX.curl)})) {
    return 0.0;
  }
  return u_trip.x * ${f(TRIP.curl)} * (0.55 + 0.45 * sin(footX * ${f(TRIP.curlK)} - u_trip.y * ${f(TRIP.curlRate)}));
}

/** Hue turned by \`angle\`, saturated, and cast with that hue: \`tripTint\`. */
vec3 tripTurn(vec3 colour, float angle) {
  float c = cos(angle);
  float s = sin(angle) * ${ROOT3};
  float grey = (colour.r + colour.g + colour.b) / 3.0 * (1.0 - c);
  vec3 turned = colour * c + vec3(colour.b - colour.g, colour.r - colour.b, colour.g - colour.r) * s + grey;
  float luma = dot(turned, vec3(0.299, 0.587, 0.114));
  // hueTurn of (1, -0.5, -0.5): it sums to zero, so its grey term vanishes.
  vec3 hueCast = vec3(c, -0.5 * c + 1.5 * s, -0.5 * c - 1.5 * s);
  return max(vec3(luma) + (turned - luma) * (1.0 + ${f(TRIP.saturate)} * u_trip.x) + hueCast * (${f(TRIP.cast)} * u_trip.x * luma), vec3(0.0));
}

vec3 tripColour(vec3 colour, vec2 away, vec3 normal, float mirror) {
  if (u_trip.x <= 0.0) {
    return colour;
  }
  float ring = sin(length(away) * ${f(TAU / TRIP.ringTiles)} - u_trip.y * ${f(TRIP.ringRate)});
  float facet = normal.x * 0.9 + normal.y * 0.6;
  float turn = ${f(TRIP.hueSwing)} * ring + ${f(TRIP.facetSwing)} * facet + u_trip.y * ${f(TRIP.driftRate)} + (mirror < 0.0 ? ${f(TRIP.mirrorTurn)} : 0.0);
  return tripTurn(colour, u_trip.x * turn);
}

vec3 tripHaze(vec3 haze, vec2 away) {
  float far = length(away);
  if (!tripHas(${f(TRIP_FX.haze)}) || far <= 0.0) {
    return haze;
  }
  return tripTurn(haze, u_trip.x * (${f(TRIP.hazeX)} * away.x + ${f(TRIP.hazeY)} * away.y) / far);
}

vec3 tripNeon(vec3 normal, vec2 away, float daylight) {
  if (!tripHas(${f(TRIP_FX.neon)})) {
    return vec3(0.0);
  }
  float rim = pow(1.0 - max(dot(normal, vec3(${view})), 0.0), 3.0);
  float phase = length(away) * ${f(TRIP.neonSpread)} - u_trip.y * ${f(TRIP.neonRate)};
  vec3 hue = 0.5 + 0.5 * cos(phase + vec3(0.0, ${f(TAU / 3)}, ${f((2 * TAU) / 3)}));
  return hue * (u_trip.x * ${f(TRIP.neonGain)} * rim * (0.7 + 0.9 * (1.0 - daylight)));
}
`;

/** The same terms in WGSL, reading `frame.trip`. */
export const TRIP_WGSL = `
fn tripHas(bit: u32) -> bool {
  return frame.trip.x > 0.0 && (u32(frame.trip.z) & bit) != 0u;
}

fn tripSwell(planet: vec2f) -> f32 {
  if (frame.trip.x <= 0.0) {
    return 0.0;
  }
  return frame.trip.x * ${f(TRIP.swellTiles)} * (${swellWave(TRIP.swellA, "frame.trip.y")} + ${swellWave(TRIP.swellB, "frame.trip.y")});
}

fn tripBreath(away: vec2f) -> f32 {
  return 1.0 + frame.trip.x * ${f(TRIP.breath)} * sin(frame.trip.y * ${f(TRIP.beatRate)} - length(away) * ${f(TRIP.beatSpread)});
}

fn tripCurl(footX: f32) -> f32 {
  if (!tripHas(${TRIP_FX.curl}u)) {
    return 0.0;
  }
  return frame.trip.x * ${f(TRIP.curl)} * (0.55 + 0.45 * sin(footX * ${f(TRIP.curlK)} - frame.trip.y * ${f(TRIP.curlRate)}));
}

fn tripTurn(colour: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle) * ${ROOT3};
  let grey = (colour.r + colour.g + colour.b) / 3.0 * (1.0 - c);
  let turned = colour * c + vec3f(colour.b - colour.g, colour.r - colour.b, colour.g - colour.r) * s + grey;
  let luma = dot(turned, vec3f(0.299, 0.587, 0.114));
  // hueTurn of (1, -0.5, -0.5): it sums to zero, so its grey term vanishes.
  let hueCast = vec3f(c, -0.5 * c + 1.5 * s, -0.5 * c - 1.5 * s);
  return max(vec3f(luma) + (turned - luma) * (1.0 + ${f(TRIP.saturate)} * frame.trip.x) + hueCast * (${f(TRIP.cast)} * frame.trip.x * luma), vec3f(0.0));
}

fn tripColour(colour: vec3f, away: vec2f, normal: vec3f, mirror: f32) -> vec3f {
  if (frame.trip.x <= 0.0) {
    return colour;
  }
  let ring = sin(length(away) * ${f(TAU / TRIP.ringTiles)} - frame.trip.y * ${f(TRIP.ringRate)});
  let facet = normal.x * 0.9 + normal.y * 0.6;
  let turn = ${f(TRIP.hueSwing)} * ring + ${f(TRIP.facetSwing)} * facet + frame.trip.y * ${f(TRIP.driftRate)} + select(0.0, ${f(TRIP.mirrorTurn)}, mirror < 0.0);
  return tripTurn(colour, frame.trip.x * turn);
}

fn tripHaze(haze: vec3f, away: vec2f) -> vec3f {
  let far = length(away);
  if (!tripHas(${TRIP_FX.haze}u) || far <= 0.0) {
    return haze;
  }
  return tripTurn(haze, frame.trip.x * (${f(TRIP.hazeX)} * away.x + ${f(TRIP.hazeY)} * away.y) / far);
}

fn tripNeon(normal: vec3f, away: vec2f, daylight: f32) -> vec3f {
  if (!tripHas(${TRIP_FX.neon}u)) {
    return vec3f(0.0);
  }
  let rim = pow(1.0 - max(dot(normal, vec3f(${view})), 0.0), 3.0);
  let phase = length(away) * ${f(TRIP.neonSpread)} - frame.trip.y * ${f(TRIP.neonRate)};
  let hue = 0.5 + 0.5 * cos(phase + vec3f(0.0, ${f(TAU / 3)}, ${f((2 * TAU) / 3)}));
  return hue * (frame.trip.x * ${f(TRIP.neonGain)} * rim * (0.7 + 0.9 * (1.0 - daylight)));
}
`;
