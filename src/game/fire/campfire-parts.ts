/**
 * The parts of a campfire that do not move: its ring of stones and its logs.
 *
 * Both are the volume mechanism the trees made — lobes welded by a smooth
 * union, lit per pixel from the field's own normal — so a hearth stone is a
 * boulder at a tenth of the size and a log is a trunk lying down. They are
 * built once per seed and then only ever copied, which is the performance
 * mandate: nothing here is evaluated per frame.
 *
 * The stones are lit **toward the fire** as much as from the sky, because the
 * fire is the brightest thing near them. That puts a lit face on the far stones
 * (they face the flame, and the camera) and a dark face on the near ones, whose
 * lit edge is their top rim against the flame — which is what makes the ring
 * read as a pit the fire sits *in* rather than a ring drawn around it.
 *
 * All clouds are foot-anchored on the middle of the pit.
 */

import type { InkId, InkPixel, PixelCloud } from "../ink";
import { familyRamp } from "../palette";
import { volumeCloud, type Lobe } from "../procgen/volume";
import { ditherThreshold } from "../shading";
import { pixelHash } from "../transforms";

/** The pit is a foreshortened ellipse: the ground squash of a 16x12 tile. */
export const PIT_RADIUS_X = 10;
export const PIT_RADIUS_Y = 5;

const STONE_RAMP = familyRamp("stone");
const BARK_RAMP = familyRamp("bark");
const SKY_LIGHT = { x: -0.5, y: -0.85 };

export interface CampfireParts {
  /** Stones on the far side of the pit, drawn before the fire. */
  readonly back: PixelCloud;
  /** Logs, drawn before the flame. */
  readonly logs: PixelCloud;
  /** The log pointing at the camera, drawn over the flame's base. */
  readonly frontLog: PixelCloud;
  /** Stones on the near side, drawn last so they hide the flame's root. */
  readonly front: PixelCloud;
  /** Charred log ends: re-inked every frame as the embers in them breathe. */
  readonly char: readonly CharPixel[];
}

export interface CharPixel {
  readonly x: number;
  readonly y: number;
  /** 0..1 — how deep in the fire this pixel is; the tip glows hottest. */
  readonly heat: number;
  /** Per-pixel phase, so the glow crawls instead of pulsing in unison. */
  readonly phase: number;
  /** Whether this pixel of the char can glow at all, or is only black. */
  readonly live: boolean;
}

interface LogSpec {
  /** Angle of the log's outer end around the pit, radians; π/2 points at the camera. */
  readonly angle: number;
  readonly inner: number;
  readonly outer: number;
  readonly radius: number;
}

/** Three logs like the spokes of a wheel, their inner ends in the fire. */
const LOGS: readonly LogSpec[] = [
  { angle: Math.PI * 1.13, inner: 2, outer: 11, radius: 1.7 },
  { angle: Math.PI * 1.87, inner: 2, outer: 11, radius: 1.7 },
  { angle: Math.PI * 0.52, inner: 1, outer: 9, radius: 1.8 },
];

function stoneLobes(angle: number, seed: number, index: number): Lobe[] {
  const cx = Math.cos(angle) * PIT_RADIUS_X;
  const cy = Math.sin(angle) * PIT_RADIUS_Y;
  const size = 1.7 + pixelHash(index, 0, seed, 21) * 0.8;
  const lean = (pixelHash(index, 0, seed, 22) - 0.5) * 1.6;
  return [
    { x: cx - 0.8, y: cy - size * 0.55, radius: size },
    { x: cx + 0.9 + lean, y: cy - size * 0.45, radius: size * 0.82 },
  ];
}

/** A stone's light: the sky's, bent toward the fire at the pit's centre. */
function stoneLight(angle: number): { x: number; y: number } {
  const toFireX = -Math.cos(angle);
  const toFireY = -Math.sin(angle) * 0.6 - 0.55;
  const x = toFireX * 0.65 + SKY_LIGHT.x * 0.35;
  const y = toFireY * 0.65 + SKY_LIGHT.y * 0.35;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function buildStones(seed: number): { back: PixelCloud; front: PixelCloud } {
  const back: PixelCloud = [];
  const front: PixelCloud = [];
  const count = 9;
  // Back to front, so a near stone covers the one behind it.
  const angles = Array.from({ length: count }, (_unused, index) => {
    const jitter = (pixelHash(index, 0, seed, 20) - 0.5) * 0.3;
    return (index / count) * Math.PI * 2 + jitter + 0.2;
  }).sort((a, b) => Math.sin(a) - Math.sin(b));
  angles.forEach((angle, index) => {
    const stone = volumeCloud(
      { lobes: stoneLobes(angle, seed, index), weld: 0.9 },
      { ramp: STONE_RAMP, light: stoneLight(angle), ambient: 0.22, occlusion: 0.12 },
      { bottom: Math.floor(Math.sin(angle) * PIT_RADIUS_Y) + 1 },
    );
    (Math.sin(angle) < 0.15 ? back : front).push(...stone);
  });
  return { back, front };
}

interface BuiltLog {
  readonly body: PixelCloud;
  readonly char: CharPixel[];
}

function buildLog(log: LogSpec, seed: number, index: number): BuiltLog {
  const cos = Math.cos(log.angle);
  const sin = Math.sin(log.angle) * (PIT_RADIUS_Y / PIT_RADIUS_X);
  // Inner ends are propped up on each other, outer ends rest on the ground.
  const inner = { x: cos * log.inner, y: sin * log.inner - 3.2 };
  const outer = { x: cos * log.outer, y: sin * log.outer - 1.4 };
  const lobe: Lobe = { x: inner.x, y: inner.y, toX: outer.x, toY: outer.y, radius: log.radius };
  const raw = volumeCloud({ lobes: [lobe], weld: 0 }, { ramp: BARK_RAMP, light: SKY_LIGHT, ambient: 0.2 });
  const length = Math.hypot(outer.x - inner.x, outer.y - inner.y) || 1;
  const body: PixelCloud = [];
  const char: CharPixel[] = [];
  for (const pixel of raw) {
    const along = ((pixel.x - inner.x) * (outer.x - inner.x) + (pixel.y - inner.y) * (outer.y - inner.y)) / length;
    if (along < 4.2) {
      const heat = 1 - Math.max(along, 0) / 4.2;
      char.push({
        x: pixel.x,
        y: pixel.y,
        heat,
        phase: pixelHash(pixel.x, pixel.y, seed + index, 31) * 6.28,
        live: pixelHash(pixel.x, pixel.y, seed + index, 32) < 0.35 + heat * 0.5,
      });
      continue;
    }
    body.push(along > length - 1.3 ? cutEnd(pixel) : pixel);
  }
  return { body, char };
}

/** The sawn end of a log shows pale heartwood, not bark. */
function cutEnd(pixel: InkPixel): InkPixel {
  const ink: InkId = ditherThreshold(pixel.x, pixel.y) < 0.6 ? "earth-5" : "earth-4";
  return { x: pixel.x, y: pixel.y, ink };
}

/** Everything static about one campfire, built once. */
export function buildCampfireParts(seed: number): CampfireParts {
  const stones = buildStones(seed);
  const logs: PixelCloud = [];
  const char: CharPixel[] = [];
  let frontLog: PixelCloud = [];
  LOGS.forEach((spec, index) => {
    const built = buildLog(spec, seed, index);
    if (Math.sin(spec.angle) > 0.5) {
      frontLog = built.body;
    } else {
      logs.push(...built.body);
    }
    char.push(...built.char);
  });
  return { back: stones.back, logs, frontLog, front: stones.front, char };
}

/**
 * The char pixels as they are this instant.
 *
 * Char is black where it is dead and breathing ember where it is live: a slow
 * seeded wave runs through the live pixels so the glow crawls along the wood,
 * and how bright it gets is the fire's own strength — a dying fire's logs go
 * dull before its flame is out.
 */
export function charCloud(char: readonly CharPixel[], elapsedMs: number, strength: number): PixelCloud {
  return char.map((pixel) => {
    if (!pixel.live) {
      return { x: pixel.x, y: pixel.y, ink: pixel.heat > 0.5 ? "bark-0" : "bark-1" };
    }
    const breath = 0.5 + 0.5 * Math.sin(elapsedMs / 340 + pixel.phase);
    const glow = pixel.heat * (0.45 + 0.55 * breath) * Math.min(strength * 1.6, 1);
    const ink: InkId =
      glow > 0.72 ? "fire-5" : glow > 0.5 ? "fire-4" : glow > 0.3 ? "fire-3" : glow > 0.14 ? "fire-2" : "fire-1";
    return { x: pixel.x, y: pixel.y, ink };
  });
}
