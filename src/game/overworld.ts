/**
 * Everything that stands, grows, flows and falls on the overworld.
 *
 * The grass, the trees and boulders, the landforms, the fight (slimes, spells,
 * campfire, wildfire), the water and the wake through it, the weather and the
 * fireflies. Moved out of `demo-scene.ts` when the caves gave them a job in
 * common: they are what a cave puts away. Every display object they make is
 * counted by one `DisplayGroup`, so the scene hides and restores the lot in a
 * call (`showWhile`), and simply stops drawing them underground.
 *
 * The sky, the lip and the ground are not here: they stay up until the cave
 * has covered the whole frame, which is later, and the scene keeps them.
 */

import type { Scene } from "../engine";

import { AmbientLayer } from "./ambient-layer";
import type { FrameProfiler } from "./bench";
import type { CameraFrame, LocalBounds } from "./camera";
import { DisplayGroup } from "./display-group";
import { ALL_EFFECTS, type EffectSwitches } from "./effects";
import { Encounter } from "./encounter";
import type { FrameContext } from "./frame-context";
import type { HeroLayer, Whereabouts } from "./hero-layer";
import { heroHeight } from "./hero-layer";
import { dryGround } from "./lakes";
import { LandformGpuLayer } from "./landform-gpu-layer";
import { LandformLayer } from "./landform-layer";
import type { Odometer } from "./odometer";
import type { PlanetPoint } from "./planet";
import { SceneryLayer } from "./scenery-layer";
import { VegetationLayer } from "./vegetation-layer";
import { sinkRows, WadeLayer } from "./wade-layer";
import { WaterLayer, type Reflectable } from "./water-layer";
import type { WeatherState } from "./weather";
import { WeatherLayer } from "./weather-layer";
import { scorchAt } from "./wildfire";

/** Where it is put on screen, and how big that screen is. */
export interface OverworldFrame {
  readonly frame: CameraFrame;
  readonly bounds: LocalBounds;
  readonly width: number;
  readonly height: number;
  /** The horizon line, from `horizonLayout`: where the rain stops. */
  readonly horizonY: number;
}

export class Overworld {
  readonly vegetation: VegetationLayer;
  readonly scenery: SceneryLayer;
  private landforms!: LandformLayer | LandformGpuLayer;
  readonly encounter: Encounter;
  readonly water: WaterLayer;
  private readonly wade: WadeLayer;
  readonly weather: WeatherLayer;
  private readonly ambient = new AmbientLayer();
  private group!: DisplayGroup;

  constructor(
    stormSeed: number,
    weather: WeatherState | undefined,
    private readonly effects: EffectSwitches = ALL_EFFECTS,
  ) {
    this.vegetation = new VegetationLayer(effects);
    this.scenery = new SceneryLayer(effects);
    this.encounter = new Encounter(effects);
    this.water = new WaterLayer(effects);
    this.wade = new WadeLayer(stormSeed ^ 0x3a7e, effects);
    this.weather = new WeatherLayer(stormSeed, weather, effects);
  }

  create(scene: Scene, at: OverworldFrame, gpu: boolean, campfireAt: PlanetPoint): void {
    this.group = new DisplayGroup(scene.children);
    this.group.track(() => {
      this.vegetation.create(scene, at.frame, at.bounds);
      this.scenery.create(scene, at.bounds, at.width);
      this.landforms = gpu ? new LandformGpuLayer() : new LandformLayer();
      this.landforms.create(scene, at.width, at.height, heroHeight());
      this.encounter.create(scene, at.width, at.height, dryGround(campfireAt));
      // Burnt ground has no grass on it until it greens over again.
      const fire = this.encounter.wildfire.fire;
      this.vegetation.setBare((point) => scorchAt(fire, point) > 0.15);
      this.water.create(scene, at.width, at.height);
      this.wade.create(scene, at.width, at.height);
      this.weather.create(scene, at.width, at.height, at.horizonY);
      this.ambient.create(scene);
    });
  }

  /** Re-cut the grid after the window changed shape. */
  layout(flat: CameraFrame, bounds: LocalBounds, width: number): void {
    this.group.track(() => {
      this.vegetation.layout(flat, bounds);
      this.scenery.layout(bounds, width);
    });
  }

  /** Show it all while `shown` holds; put it all away otherwise. */
  showWhile(shown: boolean): void {
    if (shown) {
      this.group.show();
    } else {
      this.group.hide();
    }
  }

  /** One frame of the overworld, the hero drawn in the middle of it, in the order a blow and its consequences need. */
  draw(ctx: FrameContext, hero: HeroLayer, where: Whereabouts, odometer: Odometer, lap: FrameProfiler | null): void {
    this.group.track(() => {
      // Only swaying grass parts round feet, so only then is anyone asked where theirs are.
      this.vegetation.update(ctx, this.effects.on("sway") ? this.grassPushers(ctx) : []);
      lap?.lap("grass");
      this.scenery.update(ctx);
      lap?.lap("scenery");
      this.landforms.update(ctx, ctx.shade);
      lap?.lap("landforms");
      // How deep he stands is this frame's water, not the last anchor's slid by this frame's scroll.
      this.water.prepare(ctx);
      hero.wade(sinkRows(this.water.holdsWater(hero.footNow(), ctx.frame), where.at));
      hero.update(ctx);
      lap?.lap("hero");
      this.encounter.update(ctx, hero);
      lap?.lap("encounter");
      this.drawWater(ctx, hero, where.walked);
      lap?.lap("water");
      // After everything standing has been placed: the slices are cut round it.
      this.landforms.arrange();
      lap?.lap("landforms");
      if (this.effects.on("motes")) {
        this.ambient.update(ctx, odometer);
      } else {
        this.ambient.hide();
      }
    });
  }

  /** Whatever walks through the grass and bends it aside: the hero, and the slimes. */
  private grassPushers(ctx: FrameContext): { x: number; y: number; weight?: number }[] {
    const feet = this.encounter.slimes.reflectables().map((slime) => ({ x: slime.x, y: slime.y, weight: 0.7 }));
    return [{ x: ctx.frame.footX, y: ctx.frame.footY }, ...feet];
  }

  /**
   * Rain, the hero's wake, then the water both land in — so a drop or a
   * footfall that lands this frame rings this frame.
   */
  private drawWater(ctx: FrameContext, hero: HeroLayer, walked: number): void {
    this.weather.update(ctx, this.water);
    this.wade.update(ctx, this.water, [{ id: "hero", foot: hero.footNow(), travelled: walked }]);
    // Nothing is mirrored, so nothing is cut at the waterline and flipped for it.
    const actors = this.effects.on("reflections") ? { hero: hero.reflection(), reflectables: standingOver(this.encounter) } : {};
    this.water.update(ctx, actors);
  }
}

/** Everything of the encounter's the water gives back: each slime, and the campfire's flame while it burns. */
function standingOver(encounter: Encounter): Reflectable[] {
  const campfire = encounter.campfire;
  return [
    ...encounter.slimes.reflectables().map((slime) => ({ cloud: slime.cloud, foot: { x: slime.x, y: slime.y } })),
    ...(campfire.visible ? [{ cloud: campfire.flameCloud(), foot: campfire.foot, glow: true }] : []),
  ];
}
