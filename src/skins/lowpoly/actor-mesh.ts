/**
 * What moves, rebuilt every frame: the fireballs in flight and the bursts
 * they leave (the slimes are `slime-mesh.ts`). A few hundred triangles, into
 * one dynamic buffer.
 *
 * All of it reads the shared simulation (`encounter-sim.ts`) and decides
 * nothing: a fireball's flight and a burst's age are the sim's numbers.
 *
 * Coordinates are planet tiles from the hero's live position, unrotated - the
 * same frame a chunk is drawn in with its offset at zero.
 */

import type { Burst } from "../../game/encounter-sim";
import { BURST_MS } from "../../game/encounter-sim";
import { FIREBALL_HEIGHT, fireballPoint, type Fireball } from "../../game/fire/fireball";
import { wrapDelta, type PlanetPoint } from "../../game/planet";
import { WALL_RISE } from "../../game/projection";
import { Kind, MeshBuilder, mixRgb, type Rgb, type Vec3 } from "./mesh";
import { LOWPOLY } from "./palette";
import { blob, disc } from "./primitives";

function offsetOf(point: PlanetPoint, hero: PlanetPoint): readonly [number, number] {
  return [wrapDelta(point.x, hero.x), wrapDelta(point.y, hero.y)];
}

/** A fireball: a bright faceted core at hand height, a dimmer shell round it. */
export function fireballMesh(sheer: MeshBuilder, ball: Fireball, hero: PlanetPoint): void {
  if (!ball.flying) {
    return;
  }
  const [x, y] = offsetOf(fireballPoint(ball), hero);
  const z = FIREBALL_HEIGHT / WALL_RISE;
  const spin = Math.floor(ball.ageMs / 40);
  blob(sheer, [x, y, z], [0.16, 0.16, 0.16], { colour: LOWPOLY.fireCore, kind: Kind.glow, anchor: [x, y] }, spin, { jitter: 0.2 });
  blob(sheer, [x, y, z], [0.28, 0.28, 0.24], { colour: LOWPOLY.fire, kind: Kind.glow, alpha: 0.55, anchor: [x, y] }, spin + 7, { jitter: 0.35 });
}

/** A burst: a fireball's blast swelling and fading, or a nova's ring of frost racing out. */
export function burstMesh(sheer: MeshBuilder, burst: Burst, hero: PlanetPoint): void {
  const [x, y] = offsetOf(burst.at, hero);
  const t = Math.min(burst.ageMs / BURST_MS[burst.kind], 1);
  const fade = 1 - t;
  if (burst.kind === "blast") {
    const r = burst.radius * (0.35 + 0.65 * Math.sqrt(t));
    blob(sheer, [x, y, r * 0.5], [r, r, r * 0.8], { colour: mixRgb(LOWPOLY.fireCore, LOWPOLY.fire, t), kind: Kind.glow, alpha: 0.7 * fade, anchor: [x, y] }, 3, { jitter: 0.25 });
    return;
  }
  ring(sheer, [x, y, 0.06], burst.radius * Math.sqrt(t), 0.18, { colour: LOWPOLY.frost, alpha: 0.85 * fade });
  disc(sheer, [x, y, 0.05], burst.radius * Math.sqrt(t), 16, { colour: LOWPOLY.frost, kind: Kind.glow, alpha: 0.25 * fade });
}

/** A flat ring on the ground, `width` tiles wide inside `radius`. */
function ring(sheer: MeshBuilder, centre: Vec3, radius: number, width: number, style: { colour: Rgb; alpha: number }): void {
  const sides = 20;
  const inner = Math.max(radius - width, 0);
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const at = (angle: number, r: number): Vec3 => [centre[0] + Math.cos(angle) * r, centre[1] + Math.sin(angle) * r, centre[2]];
    sheer.quad(at(a0, inner), at(a0, radius), at(a1, radius), at(a1, inner), { ...style, kind: Kind.glow });
  }
}
