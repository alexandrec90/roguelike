/**
 * A slime in the low-poly skin: a drop of coloured jelly with a darker heart
 * and two eyes. Rebuilt every frame from the shared simulation, deciding
 * nothing - the hop, squash, flash and melt are `slime-brain.ts`'s numbers.
 *
 * Three parts over the two passes, because sheer things neither hide nor are
 * mirrored:
 *
 * | Part | Pass | Why |
 * | --- | --- | --- |
 * | the skin | sheer, `Kind.liquid` | translucent and glossy; only its front half, so the back never blends through |
 * | the heart | solid | a smaller, deeper drop seen through the skin, and what still water mirrors |
 * | the eyes | solid | small dark beads with a catch-light, half sunk in the skin so they ride it |
 *
 * The shape is a sum of terms over the unit sphere (`smoothBlob`): a gumdrop
 * (narrow crown, sagging foot, flat underside), the sim's squash, hop and melt,
 * and a wobble that runs round the body and swells while the squash spring is
 * still ringing. Every term is a function of the slime, its seed and the clock.
 *
 * Coordinates are planet tiles from the hero's live position, unrotated, as in
 * `actor-mesh.ts`; anything that must face the eye is handed the view direction
 * in that frame (`viewInPlanet`).
 */

import { DYING_MS, EMERGE_MS, MELT_MS, type Slime } from "../../game/creatures/slime-brain";
import type { SlimeVariant } from "../../game/creatures/slime-palette";
import { wrapDelta, type PlanetPoint } from "../../game/planet";
import { WALL_RISE } from "../../game/projection";
import { FLAT_LOOK, type Look } from "./look";
import { Kind, MeshBuilder, mixRgb, shadeRgb, type Rgb, type Vec3 } from "./mesh";
import { hash01, LOWPOLY } from "./palette";
import { TOWARD_VIEWER } from "./placement";
import { smoothBlob } from "./primitives";
import { shadowUnder } from "./scenery-mesh";
import { standingHeight } from "./terrain-mesh";

const SLIME_COLOURS: Readonly<Record<SlimeVariant, Rgb>> = {
  green: LOWPOLY.slimeGreen,
  fire: LOWPOLY.slimeFire,
  frost: LOWPOLY.slimeFrost,
  arcane: LOWPOLY.slimeArcane,
};

/** A slime's half-width and height above its foot's centre, tiles. */
const SLIME_RADIUS = 0.3;
const SLIME_HEIGHT = 0.33;

/** The underside's depth as a share of the crown's height: a drop sags flat where it sits. */
const FOOT = 0.35;

/** How opaque the skin is where it is looked through straight on; the shader thickens the rim. */
export const SKIN_ALPHA = 0.42;

/** The heart's size as a share of the skin's. */
const HEART = 0.5;

/**
 * Each eye's half-width, tiles, and its catch-light's. Small dark beads in the
 * jelly, not whites with pupils: a creature, not a cartoon.
 */
const EYE = 0.038;
const CATCHLIGHT = 0.009;
/** Radians either side of the gaze, and up from the waist, that the eyes sit at. */
const EYE_SPREAD = 0.4;
const EYE_RISE = 0.3;

/** A blink, ms, and how far apart they come. */
const BLINK_MS = 130;
const BLINK_EVERY_MS = 2800;

/** The wobble's period, ms, and its size at rest and at most, as a share of the radius. */
const WOBBLE_MS = 1100;
const WOBBLE_REST = 0.035;
const WOBBLE_MAX = 0.12;

/** How the body is drawn this frame, from the sim and the clock: the terms the surface sums. */
export interface SlimeBody {
  readonly x: number;
  readonly y: number;
  /** Tiles of land under its foot - a landform's lower slope (`standingHeight`); 0 on open ground. */
  readonly ground: number;
  /** Tiles above height 0 its underside is: the land under it plus its hop. */
  readonly lift: number;
  readonly wide: number;
  readonly tall: number;
  /** 0 standing, 1 a puddle: the death melt, and the emerge played backwards. */
  readonly melt: number;
  /** 1 while it lives; down to 0 as its dead puddle dries. */
  readonly fade: number;
  readonly wobble: number;
  /** The wobble's phase, radians. */
  readonly phase: number;
}

/** The body's terms, from the slime and the clock, standing on `look`'s ground. */
export function slimeBody(slime: Slime, hero: PlanetPoint, elapsedMs: number, look: Look = FLAT_LOOK): SlimeBody {
  const x = wrapDelta(slime.at.x, hero.x);
  const y = wrapDelta(slime.at.y, hero.y);
  const melt = meltOf(slime);
  const squash = slime.mode === "dying" ? 0 : slime.squash.value;
  const fade = slime.mode === "dying" ? 1 - clamp01((slime.modeMs - MELT_MS) / (DYING_MS - MELT_MS)) : 1;
  const ground = standingHeight(slime.at, look);
  return {
    x,
    y,
    ground,
    lift: ground + slime.lift / WALL_RISE,
    wide: SLIME_RADIUS * (1 - squash * 0.5) * (1 + melt * 0.8),
    tall: SLIME_HEIGHT * (1 + squash) * (1 - melt * 0.85),
    melt,
    fade,
    wobble: Math.min(WOBBLE_REST + Math.abs(squash) * 0.3, WOBBLE_MAX),
    phase: (elapsedMs / WOBBLE_MS) * Math.PI * 2 + hash01(slime.seed) * Math.PI * 2,
  };
}

function meltOf(slime: Slime): number {
  if (slime.mode === "dying") {
    return clamp01(slime.modeMs / MELT_MS);
  }
  if (slime.mode === "emerge") {
    return 1 - clamp01(slime.modeMs / EMERGE_MS);
  }
  return 0;
}

/**
 * Where the skin is in `direction` from the body's middle, scaled by `share`
 * (1 for the skin, less for the heart). A gumdrop: the crown narrower than the
 * waist, the foot flattened, and a ripple round the waist travelling with time.
 */
export function skinPoint(body: SlimeBody, direction: Vec3, share = 1): Vec3 {
  const [dx, dy, dz] = direction;
  const around = Math.atan2(dy, dx);
  const waist = 1 - dz * dz;
  const ripple = body.wobble * waist * (Math.sin(2 * around + body.phase) + 0.6 * Math.sin(3 * around - body.phase * 1.7 + 1.3));
  const downward = (1 - dz) / 2;
  const across = body.wide * share * (0.84 + 0.28 * downward) * (1 + ripple);
  const breathe = 1 + body.wobble * 0.5 * Math.sin(body.phase * 0.5);
  const up = dz >= 0 ? dz * body.tall * breathe : dz * body.tall * FOOT;
  const middle = body.lift + body.tall * FOOT;
  return [body.x + dx * across, body.y + dy * across, middle + up * share];
}

/**
 * The way a slime's eyes point, planet frame, radians: at the hero once it has
 * noticed him, else the way it last hopped, else a way of its own.
 */
export function slimeGaze(slime: Slime, hero: PlanetPoint): number {
  if (slime.aware) {
    return Math.atan2(wrapDelta(hero.y, slime.at.y), wrapDelta(hero.x, slime.at.x));
  }
  const hopX = wrapDelta(slime.hopTo.x, slime.hopFrom.x);
  const hopY = wrapDelta(slime.hopTo.y, slime.hopFrom.y);
  if (Math.hypot(hopX, hopY) > 1e-6) {
    return Math.atan2(hopY, hopX);
  }
  return hash01(slime.seed ^ 0x5eed) * Math.PI * 2;
}

/** The direction toward the eye in the unrotated planet frame, for a world drawn turned by `turn`. */
export function viewInPlanet(turn: number): Vec3 {
  const [, y, z] = TOWARD_VIEWER;
  return [y * Math.sin(turn), y * Math.cos(turn), z];
}

export interface SlimeLook {
  readonly elapsedMs: number;
  /** The world's turn this frame, so the skin's back half can be left out. */
  readonly turn: number;
  /** Where the eyes point, planet frame, radians - `slimeGaze`, eased by the caller. */
  readonly gaze: number;
  /** The skin's look (`look.ts`), whose ground - the painted look's hills - the slime stands on; flat unless given. */
  readonly paint?: Look;
}

/** One slime: skin, heart, eyes and shadow. */
export function slimeMesh(solid: MeshBuilder, sheer: MeshBuilder, slime: Slime, hero: PlanetPoint, look: SlimeLook): void {
  const body = slimeBody(slime, hero, look.elapsedMs, look.paint);
  const anchor = [body.x, body.y] as const;
  const base = SLIME_COLOURS[slime.variant];
  const colour = slime.flashMs > 0 ? mixRgb(base, [1, 1, 1], 0.75) : base;
  const view = viewInPlanet(look.turn);
  shadowUnder(sheer, [body.x, body.y, body.ground], body.wide * 0.9 * body.fade);
  if (body.fade <= 0) {
    return;
  }
  smoothBlob(sheer, (d) => skinPoint(body, d), { colour, kind: Kind.liquid, alpha: SKIN_ALPHA * body.fade, anchor }, view);
  const heart = HEART * (1 - body.melt);
  if (heart > 0.05) {
    const heartColour = shadeRgb(mixRgb(colour, LOWPOLY.shadow, 0.2), -0.12);
    smoothBlob(solid, (d) => skinPoint(body, d, heart), { colour: heartColour, anchor });
  }
  eyes(solid, slime, body, look, view);
}

/** Two eyes on the skin's front, looking along the gaze. Gone once the melt has taken the face. */
function eyes(solid: MeshBuilder, slime: Slime, body: SlimeBody, look: SlimeLook, view: Vec3): void {
  const size = 1 - body.melt * 1.4;
  if (size <= 0.2) {
    return;
  }
  const anchor = [body.x, body.y] as const;
  const open = eyeOpen(slime, look.elapsedMs);
  const ahead: Vec3 = [Math.cos(look.gaze), Math.sin(look.gaze), 0];
  for (const side of [-1, 1]) {
    const around = look.gaze + side * EYE_SPREAD;
    const on = skinPoint(body, [Math.cos(around) * Math.cos(EYE_RISE), Math.sin(around) * Math.cos(EYE_RISE), Math.sin(EYE_RISE)]);
    const out: Vec3 = [Math.cos(around), Math.sin(around), 0];
    const r = EYE * size;
    // Half under the skin, so the jelly films over it and it rides the wobble.
    const centre = along(along(on, out, -r * 0.5), ahead, r * 0.15);
    smoothBlob(solid, ellipsoid(centre, [r, r, r * 0.9 * open]), { colour: LOWPOLY.slimeEye, anchor });
    if (open > 0.5) {
      const c = CATCHLIGHT * size;
      const glint = along(along(centre, view, r * 0.85), [0, 0, 1], r * 0.35);
      smoothBlob(solid, ellipsoid(glint, [c, c, c]), { colour: LOWPOLY.eyeGlint, kind: Kind.glow, anchor });
    }
  }
}

/** 1 open, toward 0 shut: a seeded blink now and then, and a squint while it smarts from a hit. */
export function eyeOpen(slime: Slime, elapsedMs: number): number {
  if (slime.mode === "hurt") {
    return 0.3;
  }
  const every = BLINK_EVERY_MS * (0.8 + 0.6 * hash01(slime.seed ^ 0xb1));
  const at = (elapsedMs + hash01(slime.seed ^ 0xb2) * every) % every;
  return at < BLINK_MS ? 0.12 : 1;
}

function ellipsoid(centre: Vec3, radii: Vec3): (d: Vec3) => Vec3 {
  return (d) => [centre[0] + d[0] * radii[0], centre[1] + d[1] * radii[1], centre[2] + d[2] * radii[2]];
}

function along(point: Vec3, direction: Vec3, distance: number): Vec3 {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance, point[2] + direction[2] * distance];
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
