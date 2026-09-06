/**
 * The round planet, and what "left" means on one.
 *
 * Two closed walks, and neither of them is a map edge:
 *
 * - **Forward** runs along a great circle. Walk `PLANET_TILES` tiles in a
 *   straight line and you are back where you started, having never turned.
 * - **Sideways** runs around a circle of radius `radius` tiles whose centre sits
 *   `radius` tiles *behind* the walker and travels with him, so he is forever on
 *   its edge looking out of it. Strafing slides him around that edge, which
 *   means his heading turns with him: one lap is `2 * pi * radius` tiles, and it
 *   swings the whole horizon through a full 360 without going round the planet.
 *
 * That second walk is the whole idea, so it is worth being precise about it.
 * The pivot is `pose - radius * forward(turn)`, and the identity that defines a
 * strafe is that the pivot does not move:
 *
 *             . - ~ ~ ~ - .              turn increases -->
 *         ,'                 `.
 *       ,'      pivot C        `.        pose  = C + radius * forward(turn)
 *      /           x            \        strafe(d) advances turn by d / radius
 *     |            |             |       and re-derives pose from the identity
 *      \        radius          /
 *       `.         |          ,'
 *         `.     [hero]     ,'   <- slides along the rim, facing outward
 *             ' - , _ , - '
 *
 * Walking forward carries C along; strafing leaves it exactly where it is. Two
 * consequences fall out and both are load-bearing:
 *
 * - **Strafing right turns you right.** Ground and sky then agree: press right,
 *   the field slides left and the horizon sweeps left with it. Putting the pivot
 *   *ahead* instead is an equally valid circle, but it turns you the other way
 *   and the horizon would sweep against the ground.
 * - **The parallax is anchored behind you.** Ground `y` tiles ahead moves
 *   sideways by `d * (1 + y / radius)`, so the far field sweeps faster than the
 *   near field and the horizon - infinitely far - sweeps by the full turn. That
 *   gradient *is* the read of turning; it is not decoration.
 *
 * Three frames, and this module is the only place that converts between them:
 *
 * | Frame  | Coordinates                                                     |
 * | ------ | --------------------------------------------------------------- |
 * | Planet | `(x, y)` tiles, both axes wrapping at `PLANET_TILES`. Terrain    |
 * |        | lives here, and nothing else does.                              |
 * | Local  | `(x, y)` tiles from the hero, x right and y forward. Rotates     |
 * |        | with him, so it is what the camera and the tile grid are.       |
 * | Screen | pixels. `projection.ts` owns that step and this file never sees  |
 * |        | it.                                                             |
 *
 * Everything here is pure and Phaser-free, so the geometry is asserted in tests
 * rather than eyeballed through a canvas.
 */

const TAU = Math.PI * 2;

/** Tiles of straight-ahead walking that bring you back to where you began. */
export const PLANET_TILES = 256;

/**
 * Radius of the sideways circle, in tiles - the one knob that sets how fast the
 * horizon spins. A lap is `2 * pi * radius`, so 512 is about 3200 tiles.
 *
 * Small radii turn hard: at 19 a single sideways step was roughly 3 degrees and
 * the field visibly swung. Large ones approach a plain sideways scroll.
 *
 * ## Why this is 512 and not 19
 *
 * Because the *ground* cannot show a turn smoothly, and at a tight radius it
 * showed one badly. A strafe rotates the local frame, so a point `y` tiles ahead
 * sweeps sideways by `d * (1 + y / radius)` and a point `x` tiles to the side
 * moves in **depth** by `d * x / radius` - near and far by different amounts,
 * left and right in opposite directions. But the renderer carries a step in
 * flight as one uniform translation (`scrollPhase` in `player.ts`), because a
 * tile grid has no other way to slide. A translation cannot approximate a
 * rotation, so the two agree at the start of a step and part company by its end,
 * where the picture snaps onto the truth.
 *
 * Measured over every visible cell at a 320x180 target, per sideways step:
 *
 * | radius | up/down px | sideways snap px | horizon px/step | lap    |
 * | ------ | ---------- | ---------------- | --------------- | ------ |
 * | 19     | 7.46       | 10.36            | 10.72           | 119 t  |
 * | 128    | 1.08       | 1.51             | 1.59            | 804 t  |
 * | 288    | 0.48       | 0.67             | 0.71            | 1810 t |
 * | 512    | 0.27       | 0.38             | 0.40            | 3217 t |
 *
 * Depth motion goes under half a pixel at radius 277 and *both* axes do at 474,
 * so at 512 nothing on screen can move a whole pixel because of a strafe. The
 * arc is then shallow enough that the straight-line slide the renderer draws is
 * within half a pixel of the arc the simulation walks - which is why one number
 * fixes both the visible up-and-down drift and the snap underneath it.
 *
 * The cost is that the turn stops reading moment to moment: the horizon moves
 * 0.4px a step rather than 10.7. The mechanic is unchanged and exact - walking
 * sideways still swings the heading through a full 360 and returns you to where
 * you began (`planet.test.ts` asserts the lap closes at any radius) - it now
 * takes 3200 tiles rather than 119. `?radius=` overrides this per load with no
 * rebuild, which is the point of it being a knob: dial back toward 128 to watch
 * the world turn, and know that is also where the ground starts to jump.
 *
 * One consequence worth knowing rather than discovering: past about 128 the
 * pivot sits more than half a planet behind you, so "a circle whose centre is
 * behind you" stops being a literal picture and is only a turn rate. The
 * arithmetic is unaffected - it closes exactly at every radius tried.
 */
export const DEFAULT_STRAFE_RADIUS = 512;

/** Below this the circle is smaller than the screen and stops reading as straight. */
const MIN_STRAFE_RADIUS = 3;

export interface PlanetPoint {
  readonly x: number;
  readonly y: number;
}

/** A point on the planet, plus which way the walker standing on it faces. */
export interface PlanetPose extends PlanetPoint {
  /** Radians clockwise from planet north; 0 points along +y. */
  readonly turn: number;
}

/** Tiles right of, and ahead of, the hero. The frame the tile grid is drawn in. */
export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

/** Fold a planet coordinate back into `[0, PLANET_TILES)`. */
export function wrapTile(value: number): number {
  const wrapped = value % PLANET_TILES;
  return wrapped < 0 ? wrapped + PLANET_TILES : wrapped;
}

export function wrapTurn(turn: number): number {
  const wrapped = turn % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Shortest signed way from `from` to `to` around the planet.
 *
 * A round world has no "further right": something 200 tiles east is 56 tiles
 * west, and every difference taken across the seam has to say so, or the whole
 * visible field turns inside out once per lap.
 */
export function wrapDelta(to: number, from: number): number {
  const raw = wrapTile(to - from);
  return raw > PLANET_TILES / 2 ? raw - PLANET_TILES : raw;
}

/** Unit vector the pose faces, in planet coordinates. */
export function forwardOf(turn: number): PlanetPoint {
  return { x: Math.sin(turn), y: Math.cos(turn) };
}

/** Local to planet: `pose + x * right + y * forward`. */
export function fromLocal(pose: PlanetPose, local: LocalPoint): PlanetPoint {
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  return {
    x: wrapTile(pose.x + local.x * cos + local.y * sin),
    y: wrapTile(pose.y - local.x * sin + local.y * cos),
  };
}

/** Planet to local - the exact inverse of `fromLocal`, seam included. */
export function toLocal(pose: PlanetPose, point: PlanetPoint): LocalPoint {
  const dx = wrapDelta(point.x, pose.x);
  const dy = wrapDelta(point.y, pose.y);
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** The fixed point a strafe orbits: `radius` tiles directly behind the pose. */
export function pivotOf(pose: PlanetPose, radius: number): PlanetPoint {
  const forward = forwardOf(pose.turn);
  return {
    x: wrapTile(pose.x - radius * forward.x),
    y: wrapTile(pose.y - radius * forward.y),
  };
}

/** Walk the heading. The sideways circle comes too; the heading does not move. */
export function stepForward(pose: PlanetPose, distance: number): PlanetPose {
  const forward = forwardOf(pose.turn);
  return {
    x: wrapTile(pose.x + distance * forward.x),
    y: wrapTile(pose.y + distance * forward.y),
    turn: pose.turn,
  };
}

/**
 * Slide around the rim of the sideways circle: positive is right.
 *
 * Written as "advance the turn, then re-derive the position from the pivot"
 * rather than as a rotation matrix, because that spelling *is* the invariant -
 * the pivot cannot drift, however many laps are walked.
 */
export function stepStrafe(pose: PlanetPose, distance: number, radius: number): PlanetPose {
  const safe = Math.max(radius, MIN_STRAFE_RADIUS);
  const pivot = pivotOf(pose, safe);
  const turn = wrapTurn(pose.turn + distance / safe);
  const forward = forwardOf(turn);
  return {
    x: wrapTile(pivot.x + safe * forward.x),
    y: wrapTile(pivot.y + safe * forward.y),
    turn,
  };
}

/** Tiles of sideways walking that return you to the same point facing the same way. */
export function strafeLap(radius: number): number {
  return TAU * Math.max(radius, MIN_STRAFE_RADIUS);
}

/**
 * The two walks, taken together. Both distances are signed - forward and right
 * are positive - and either may be zero.
 *
 * One structure rather than two, because a planet has no diagonal: pressing up
 * and right is not a third direction, it is a forward stride and a strafe
 * walked at the same time, and the pair is what the simulation commits to.
 */
export interface Gait {
  readonly forward: number;
  readonly strafe: number;
}

/**
 * Walk a gait, or any fraction of one.
 *
 * The fraction matters as much as the whole: a step in flight is sampled here
 * at `distance * t` rather than lerped between its endpoints, because a strafe
 * is an arc and the chord across it is not the path. At a tight radius the two
 * are a visible distance apart by mid-step; at the default they are not, and
 * this stays exact anyway - a sampler that is only right for one setting of a
 * knob is a trap for whoever turns the knob.
 *
 * Strafe first, then forward, and the order is load-bearing rather than
 * arbitrary: strafing turns the heading, so a diagonal walked this way leaves
 * along the heading it arrives with. Composing it the other way round would
 * make the same two presses land somewhere the picture did not go through.
 */
export function applyGait(pose: PlanetPose, gait: Gait, radius: number): PlanetPose {
  const turned = gait.strafe === 0 ? pose : stepStrafe(pose, gait.strafe, radius);
  return gait.forward === 0 ? turned : stepForward(turned, gait.forward);
}

/**
 * Read the radius off a query string, the way `horizon.ts` reads the sky split.
 *
 * How hard the world turns is a feel decision, so it is retunable in the address
 * bar (`?radius=64`) rather than in a rebuild. An unreadable value falls back
 * instead of throwing: a typo in a URL should not blank the game.
 */
export function parseStrafeRadius(
  raw: string | null | undefined,
  fallback: number = DEFAULT_STRAFE_RADIUS,
): number {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseFloat(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(value, MIN_STRAFE_RADIUS);
}
