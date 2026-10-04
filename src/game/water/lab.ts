/**
 * Weather and water baked into the fixed frame lists the asset lab speaks.
 *
 * The lab cannot tell generated art from drawn art, which is the point: every
 * frame here is the game's own mechanism sampled at a fixed time — the same
 * puddle body, the same rain field stepped by the same deltas, the same bolt —
 * flattened with `cloudToSprite`. A puddle is shown *in* a patch of field with
 * the hero standing at its far edge, because water judged on a flat lab
 * background says nothing about whether it reads as water on grass.
 */

import { atmosphereAt } from "../atmosphere";
import { createPool, emit, particleCloud, stepParticles } from "../fx/particles";
import { cloudToSprite, type CloudFrame, type InkId, type PixelCloud } from "../ink";
import { HERO_EQUIPPED } from "../models";
import { familyRamp } from "../palette";
import type { PixelSpriteSource } from "../pixel-art";
import { valueNoise2 } from "../procgen/noise";
import { createPuddle, puddleGlints, puddleSurface } from "../puddles";
import { rippleCloud, RIPPLE_LIFE_MS } from "../ripples";
import { renderModel } from "../rig";
import { rampInk } from "../shading";
import { RAIN_SLANT } from "../weather";
import { boltCloud } from "./bolt";
import { SHALLOW_INK, WET_INK } from "./body";
import { createRainField, rainCloud, stepRainField, type RainEnv } from "./rain";
import { darkenInk, reflectionCloud } from "./reflect";
import { skyReflection } from "./sky-inks";
import { emitSplash } from "./splash";
import { aboveWater, SPRAY_COUNT, SPRAY_SPEC, STEP_RING, waterlineReflection } from "./wake";

function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Frame count must be a positive integer");
  }
}

/** A patch of dithered field, darker as the light goes: what the water sits in. */
function fieldPatch(frame: CloudFrame, daylight: number): PixelCloud {
  const ramp = familyRamp("grass");
  const cloud: PixelCloud = [];
  for (let row = 0; row < frame.height; row += 1) {
    for (let column = 0; column < frame.width; column += 1) {
      const x = column - frame.originX;
      const y = row - frame.originY;
      const level = (0.25 + 0.45 * daylight) * (0.7 + 0.6 * valueNoise2(x / 5, y / 3, 0x6a55));
      cloud.push({ x, y, ink: rampInk(ramp, level, { x, y }) });
    }
  }
  return cloud;
}

/**
 * A lab frame holds one ink per pixel, so a sheer ink cannot show the grass
 * under it the way it does in the game's composited surfaces. Stand in for the
 * composite with the ink it most resembles over grass: damp ground is the grass
 * two steps darker, and the shallow edge is the darkest water.
 */
function seeThrough(field: PixelCloud, body: PixelCloud): PixelCloud {
  const under = new Map(field.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.ink]));
  return body.map((pixel) => {
    if (pixel.ink === WET_INK) {
      return { ...pixel, ink: darkenInk(under.get(`${pixel.x},${pixel.y}`) ?? "grass-2", 2) };
    }
    return pixel.ink === SHALLOW_INK ? { ...pixel, ink: "water-1" as InkId } : pixel;
  });
}

export const WATER_SCENE_FRAME: CloudFrame = { width: 64, height: 44, originX: 32, originY: 26 };

/**
 * A puddle at one hour of the day, sampled over a few seconds: field, body,
 * glints, the hero's reflection, and two rain rings at staggered ages.
 */
export function sampleWaterScene(hours: number, count: number): PixelSpriteSource[] {
  checkCount(count);
  const atmosphere = atmosphereAt(hours);
  // Seen as painted: the lab has no lighting pass to undo, so no ambient to divide by.
  const sky = skyReflection({ ...atmosphere, ambient: undefined });
  const puddle = createPuddle({ id: "lab", centerX: 2, centerY: 4, radius: 15, seed: 0x9a7e });
  const field = fieldPatch(WATER_SCENE_FRAME, atmosphere.daylight);
  const ground = [...field, ...seeThrough(field, puddleSurface(puddle, sky))];
  const hero = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
  const foot = { x: -3, y: puddle.centerY - puddle.radiusY + 1 };
  const holds = new Set(puddle.water.map((pixel) => `${pixel.x},${pixel.y}`));
  const wet = (cloud: PixelCloud): PixelCloud => cloud.filter((pixel) => holds.has(`${pixel.x},${pixel.y}`));

  return Array.from({ length: count }, (_unused, index) => {
    const elapsedMs = (index / count) * 3200;
    const rings = [0, 1].flatMap((ring) =>
      rippleCloud(
        {
          active: true,
          x: puddle.centerX + (ring === 0 ? 7 : -8),
          y: puddle.centerY + (ring === 0 ? 3 : 1),
          ageMs: (elapsedMs + ring * 450) % RIPPLE_LIFE_MS,
          lifeMs: RIPPLE_LIFE_MS,
        },
        sky.ring,
        sky.glint,
      ),
    );
    const cloud = [
      ...ground,
      ...puddleGlints(puddle, elapsedMs, sky.glint),
      ...wet(reflectionCloud(hero, foot.x, foot.y, elapsedMs)),
      ...wet(rings),
      ...hero.map((pixel) => ({ x: pixel.x + foot.x, y: pixel.y + foot.y, ink: pixel.ink })),
    ];
    return cloudToSprite(cloud, WATER_SCENE_FRAME);
  });
}

export const LAKE_SCENE_FRAME: CloudFrame = { width: 128, height: 84, originX: 64, originY: 42 };

/**
 * A lake at one hour of the day: its ragged shore, the dark deep core nothing
 * can wade into, and the hero standing in the shallows sunk to the shins, his
 * reflection mirrored about the waterline, with a footstep's ring opening
 * round him and spray thrown up off it - sampled across one step.
 */
export function sampleLakeScene(hours: number, count: number): PixelSpriteSource[] {
  checkCount(count);
  const atmosphere = atmosphereAt(hours);
  const sky = skyReflection({ ...atmosphere, ambient: undefined });
  const lake = createPuddle({ id: "lab-lake", centerX: 0, centerY: 0, radius: 48, seed: 0x1a4e, spread: 1, deep: 24, lake: true });
  const field = fieldPatch(LAKE_SCENE_FRAME, atmosphere.daylight);
  const ground = [...field, ...seeThrough(field, puddleSurface(lake, sky))];
  const sunk = 3;
  const hero = aboveWater(renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose), sunk);
  const foot = { x: -14, y: 26 };
  const mirror = waterlineReflection(hero, foot, sunk);
  const holds = new Set(lake.water.map((pixel) => `${pixel.x},${pixel.y}`));
  const wet = (cloud: PixelCloud): PixelCloud => cloud.filter((pixel) => holds.has(`${pixel.x},${pixel.y}`));

  return Array.from({ length: count }, (_unused, index) => {
    const elapsedMs = (index / count) * STEP_RING.lifeMs;
    const spray = createPool(8, 0x3a7e);
    emit(spray, SPRAY_SPEC, SPRAY_COUNT, foot.x + 2, foot.y - 1);
    stepParticles(spray, elapsedMs);
    const ring = rippleCloud(
      { active: true, x: foot.x + 2, y: foot.y, ageMs: elapsedMs, lifeMs: STEP_RING.lifeMs, radius: STEP_RING.radius },
      sky.ring,
      sky.glint,
    );
    const cloud = [
      ...ground,
      ...puddleGlints(lake, elapsedMs * 3, sky.glint),
      ...wet(reflectionCloud(mirror.cloud, mirror.foot.x, mirror.foot.y, elapsedMs)),
      ...wet(ring),
      ...hero.map((pixel) => ({ x: pixel.x + foot.x, y: pixel.y + foot.y, ink: pixel.ink })),
      ...particleCloud(spray),
    ];
    return cloudToSprite(cloud, LAKE_SCENE_FRAME);
  });
}

export const RAIN_FRAME: CloudFrame = { width: 96, height: 64, originX: 0, originY: 0 };

/** Rain over a patch of dusk field, all three sheets, stepped in fixed 16 ms slices. */
export function sampleRainFrames(count: number, rain = 1): PixelSpriteSource[] {
  checkCount(count);
  const field = createRainField(200, 0x1d87);
  const splashes = createPool(80, 0x5b1a);
  const env: RainEnv = { rain, slant: RAIN_SLANT, width: RAIN_FRAME.width, height: RAIN_FRAME.height, groundTop: 8 };
  const ground = fieldPatch(RAIN_FRAME, 0.6);
  const frames: PixelSpriteSource[] = [];
  let clock = 0;
  for (let index = 0; index < count; index += 1) {
    const until = 1500 + index * 64;
    while (clock < until) {
      stepRainField(field, 16, env, (landing) => emitSplash(splashes, landing.sheet, landing.x, landing.y));
      stepParticles(splashes, 16);
      clock += 16;
    }
    frames.push(cloudToSprite([...ground, ...particleCloud(splashes), ...rainCloud(field, RAIN_SLANT, 0.7)], RAIN_FRAME));
  }
  return frames;
}

export const SPLASH_FRAME: CloudFrame = { width: 14, height: 10, originX: 7, originY: 8 };

/** One near-sheet crown's life, sampled evenly. */
export function sampleSplashFrames(count: number): PixelSpriteSource[] {
  checkCount(count);
  return Array.from({ length: count }, (_unused, index) => {
    const pool = createPool(8, 0x5b1a);
    emitSplash(pool, 2, 0, 0);
    stepParticles(pool, (index / count) * 220);
    const floor: PixelCloud = [-2, -1, 0, 1, 2].map((x) => ({ x, y: 1, ink: "grass-2" as InkId }));
    return cloudToSprite([...floor, ...particleCloud(pool)], SPLASH_FRAME);
  });
}

export const BOLT_FRAME: CloudFrame = { width: 48, height: 44, originX: 0, originY: 0 };

/** A strike from flash to fade: the core holds, the glow and the branches go first. */
export function sampleBoltFrames(count: number, seed = 0x51a7): PixelSpriteSource[] {
  checkCount(count);
  return Array.from({ length: count }, (_unused, index) => {
    const intensity = 1 - index / count;
    return cloudToSprite(boltCloud(seed, 24, 0, 40, intensity), BOLT_FRAME);
  });
}
