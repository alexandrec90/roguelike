/**
 * The weather, as a layer of its own: rain in three sheets, the splashes it
 * throws, mist on the horizon, and lightning.
 *
 * What is here is only the wiring. *Whether* it rains is `weatherAt` — a pure
 * function of the clock (`water/schedule.ts`), or a fixed preset for
 * `?weather=` — and how rain, splashes, mist and bolts look is `water/`. This
 * file owns three `PixelSurface`s and when each is repainted:
 *
 * | Surface | Depth | Repainted |
 * | --- | --- | --- |
 * | mist | `RAIN_DEPTH - 1` | when the rain level or the light moves a step |
 * | rain + splashes | `RAIN_DEPTH` | every frame it is raining |
 * | bolt | `BOLT_DEPTH` | while a strike is on screen |
 *
 * Rain draws **under** the lighting multiply the scene lays over the world
 * (~4500), so night rain is night-dark with everything else; the bolt and its
 * flash draw **over** it, because a strike is the light rather than something
 * lit.
 *
 * Each drop that lands is offered to the water first, so a drop that comes
 * down in a puddle rings it on the same frame it lands, and only a drop that
 * found dry ground throws a splash.
 */

import Phaser from "phaser";

import { atmosphereAt, clockHours } from "./atmosphere";
import { scrollOffset, type CameraFrame } from "./camera";
import { hexToInt } from "./color";
import type { FrameContext } from "./frame-context";
import { clearPool, createPool, particleCloud, stepParticles, type ParticlePool } from "./fx/particles";
import { createImpulse, impulseSink } from "./impulse";
import { INK_COLORS } from "./ink";
import { PixelSurface } from "./pixel-surface";
import { boltCloud } from "./water/bolt";
import { mistCloud } from "./water/mist";
import { createRainField, paintRain, stepRainField, type Landing, type RainEnv, type RainField } from "./water/rain";
import { stepWetness, weatherAt, type WeatherState } from "./water/schedule";
import { emitSplash } from "./water/splash";
import { gustAt } from "./wind";
import { RAIN_SLANT, stormLightningAt, type LightningState } from "./weather";

/** Under the scene's lighting multiply (~4500), so night rain is dim. */
export const RAIN_DEPTH = 4000;
/** Over it: a strike is the light, not something lit. */
export const BOLT_DEPTH = 6000;

/** What the rain lands in: the water layer, or anything else with puddles. */
export interface RainCatcher {
  catchDrop(landing: Landing, frame: CameraFrame): boolean;
  setWeather(rain: number, wetness: number): void;
  setStrike(alpha: number): void;
}

/** How much a strike lights the whole frame, on top of the light it pushes. */
const FLASH_GAIN = 0.22;

/** The ground starts damp: it rained before you got here. */
const START_WETNESS = 0.6;

/** A second of rain run before the first frame, so a load in a shower opens mid-shower. */
const PREWARM_MS = 1500;

export class WeatherLayer {
  private readonly seed: number;
  private override: WeatherState | undefined;
  private field: RainField;
  private splashes: ParticlePool;
  private rainSurface!: PixelSurface;
  private mistSurface!: PixelSurface;
  private boltSurface!: PixelSurface;
  private flash!: Phaser.GameObjects.Rectangle;
  private horizonY = 0;
  private wet = START_WETNESS;
  private flashLevel = 0;
  private lastBolt = 0;
  private boltKey = "";
  private mistKey = "";
  private rainShown = false;

  constructor(seed: number, override?: WeatherState) {
    this.seed = seed;
    this.override = override;
    this.field = createRainField(420, seed ^ 0x1d87);
    this.splashes = createPool(160, seed ^ 0x5b1a);
  }

  create(scene: Phaser.Scene, width: number, height: number, horizonY: number): void {
    this.horizonY = horizonY;
    this.mistSurface = new PixelSurface(scene, width, height, "weather-mist");
    this.mistSurface.image.setDepth(RAIN_DEPTH - 1);
    this.rainSurface = new PixelSurface(scene, width, height, "weather-rain");
    this.rainSurface.image.setDepth(RAIN_DEPTH);
    this.boltSurface = new PixelSurface(scene, width, height, "weather-bolt");
    this.boltSurface.image.setDepth(BOLT_DEPTH).setVisible(false);
    this.flash = scene.add
      .rectangle(0, 0, width, height, hexToInt(INK_COLORS["frost-4"]), 1)
      .setOrigin(0, 0)
      .setDepth(BOLT_DEPTH + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  /** Pin the sky (`?weather=storm`), or hand it back to the schedule with `undefined`. */
  setOverride(state: WeatherState | undefined): void {
    this.override = state;
  }

  /** The sky at `elapsedMs`: the override if one is pinned, else the schedule. Pure. */
  weatherState(elapsedMs: number): WeatherState {
    return this.override ?? weatherAt(elapsedMs, this.seed);
  }

  /** How soaked the ground is, 0..1: rises with the rain, dries slowly after. */
  wetness(): number {
    return this.wet;
  }

  /** The lightning flash this instant, 0..1 — for a lighting pass that wants to add its own. */
  flashAlpha(): number {
    return this.flashLevel;
  }

  /**
   * One frame of weather. Density reads `ctx.rain` (so the scene may damp or
   * pin it); the storm and the wind come from `weatherState`.
   */
  update(ctx: FrameContext, water?: RainCatcher): void {
    const state = this.weatherState(ctx.elapsedMs);
    this.wet = stepWetness(this.wet, ctx.rain, ctx.deltaMs);
    water?.setWeather(ctx.rain, this.wet);
    const strike = stormLightningAt(ctx.elapsedMs, this.seed, state);
    this.strike(strike, ctx);
    water?.setStrike(strike.active ? strike.alpha : 0);

    const slant = RAIN_SLANT * state.wind * (0.85 + 0.3 * Math.min(gustAt(ctx.elapsedMs, ctx.wind), 1));
    const env: RainEnv = {
      rain: ctx.rain,
      slant,
      width: ctx.width,
      height: ctx.height,
      groundTop: ctx.frame.groundTop,
    };
    if (ctx.rain > 0 && this.field.spawned === 0) {
      this.prewarm(env);
    }
    this.stepRain(ctx, env, water);
    // Mostly left to the lighting pass above; only a touch of dimming, so night
    // rain is a cooler, darker step of the ramp rather than the same streak greyed.
    const light = Math.max(0.6 + 0.4 * ctx.atmosphere.daylight, this.flashLevel);
    this.paint(ctx.frame, slant, light);
    this.paintMist(ctx.rain, ctx.atmosphere.daylight, ctx.frame.groundTop);
  }

  /**
   * The pre-`FrameContext` entry point, kept so a scene that has not moved to
   * `update(ctx, water)` still rains: it reads the schedule and the default
   * clock itself.
   */
  animate(delta: number, elapsedMs: number, height: number, frame: CameraFrame, water: RainCatcher): void {
    const state = this.weatherState(elapsedMs);
    const ctx: FrameContext = {
      frame,
      pose: { x: 0, y: 0, turn: 0 },
      elapsedMs,
      deltaMs: Math.min(delta, 40),
      atmosphere: atmosphereAt(clockHours(elapsedMs), state.overcast),
      wind: {},
      rain: state.rain,
      width: this.rainSurface.width,
      height,
      lights: [],
      impulse: impulseSink(createImpulse()),
    };
    this.update(ctx, water);
  }

  private prewarm(env: RainEnv): void {
    for (let ms = 0; ms < PREWARM_MS; ms += 50) {
      stepRainField(this.field, 50, env, () => undefined);
    }
  }

  private stepRain(ctx: FrameContext, env: RainEnv, water: RainCatcher | undefined): void {
    const offset = scrollOffset(ctx.frame);
    stepRainField(this.field, ctx.deltaMs, env, (landing) => {
      if (water?.catchDrop(landing, ctx.frame) === true) {
        return;
      }
      // Splashes lie on the ground, so they live on the zero-phase grid and
      // are slid by the scroll offset like the tile they landed on.
      emitSplash(this.splashes, landing.sheet, landing.x - offset.x, landing.y - offset.y);
    });
    stepParticles(this.splashes, ctx.deltaMs);
  }

  private paint(frame: CameraFrame, slant: number, light: number): void {
    const offset = scrollOffset(frame);
    const splashes = particleCloud(this.splashes, offset.x, offset.y);
    const live = splashes.length > 0 || this.field.drops.some((drop) => drop.active);
    if (!live && !this.rainShown) {
      return;
    }
    this.rainSurface.clear();
    paintRain(this.rainSurface.buffer, this.field, slant, light);
    this.rainSurface.paint(splashes, 0, 0, 0.8);
    this.rainSurface.commit();
    this.rainShown = live;
  }

  private paintMist(rain: number, daylight: number, groundTop: number): void {
    const key = `${Math.round(rain * 8)}|${daylight > 0.45 ? 1 : 0}|${groundTop}`;
    if (key === this.mistKey) {
      return;
    }
    this.mistKey = key;
    const cloud = mistCloud(this.mistSurface.width, this.horizonY, groundTop, rain, daylight);
    this.mistSurface.clear().paint(cloud, 0, 0).commit();
    this.mistSurface.image.setVisible(cloud.length > 0);
  }

  /** Bolt, flash, light and camera kick — all pure functions of the schedule. */
  private strike(strike: LightningState, ctx: FrameContext): void {
    this.flashLevel = strike.active ? strike.alpha : 0;
    this.flash.setVisible(strike.active).setAlpha(FLASH_GAIN * this.flashLevel);
    this.boltSurface.image.setVisible(strike.active);
    if (!strike.active) {
      return;
    }
    const width = this.boltSurface.width;
    const x = 20 + Math.round(strike.xUnit * (width - 40));
    // Down to a seeded row of the horizon roll: a strike lands on the far field.
    const span = Math.max(ctx.frame.groundTop - this.horizonY, 1);
    const bottom = this.horizonY + 1 + ((strike.boltSeed >>> 4) % span);
    if (strike.boltSeed !== this.lastBolt) {
      this.lastBolt = strike.boltSeed;
      ctx.impulse.shake(1.5, 200);
    }
    const key = `${strike.boltSeed}|${Math.round(strike.alpha * 4)}`;
    if (key !== this.boltKey) {
      this.boltKey = key;
      this.boltSurface.clear().paint(boltCloud(strike.boltSeed, x, -3, bottom, strike.alpha), 0, 0).commit();
    }
    ctx.lights.push({
      x,
      y: this.horizonY,
      radius: 420,
      color: INK_COLORS["frost-4"],
      intensity: 1.2 * strike.alpha,
    });
  }

  /** Stop the rain dead and dry the ground — a scene reset, not weather. */
  reset(): void {
    this.field = createRainField(420, this.seed ^ 0x1d87);
    clearPool(this.splashes);
    this.wet = 0;
  }
}
