/**
 * The played character: input in, pixels out.
 *
 * The split this file defends is the one `CLAUDE.md` asks for - the movement
 * simulation is deterministic and knows nothing about the presentation. So the
 * interesting parts live elsewhere and none of them touch the renderer:
 * `keybindings.ts` says what an input means, `controls.ts` says what is held,
 * `planet.ts` says what a step does to a pose on a round world, `player.ts`
 * says what the hero does about it, `hero/hero-actions.ts` says what his blows
 * and spells are, and `hero/hero-look.ts` says what all of it looks like. What
 * is left here is the wiring: DOM events into the control state, and a frame's
 * pixels into two `PixelSurface`s — him, and his shadow under him.
 *
 * One thing did change shape when the world went round. The hero no longer moves
 * across the screen - he *is* the screen's origin, nailed to `footX, footY`
 * while the planet slides and swings beneath him. So this layer is also the
 * place the rest of the scene comes to ask where the world has got to: it holds
 * the pose, and hands out the views of it (`whereabouts`) that `camera.ts`,
 * `panorama.ts` and the prefetcher need.
 *
 * Two calls a frame. `animate(delta, elapsed)` runs the simulation — it must
 * come first, because the scene builds its camera frame from `whereabouts()`. Then
 * `update(ctx)` draws with the frame's light, pushes the burning blade's light
 * into `ctx.lights`, and ages the effects. A scene that never calls `update`
 * still gets a drawn hero from `animate` alone, under a default sun.
 */

import type { Pointer, Scene } from "../engine";
import { scrollRows } from "./camera";
import type { Strike } from "./combat";
import {
  aimAt,
  createControls,
  currentAim,
  nextHeading,
  pressButton,
  pressKey,
  releaseAll,
  releaseButton,
  releaseKey,
  spendAttack,
  spendCast,
  spendFrost,
  spendEnchant,
  spendHeading,
  wantsAttack,
  wantsCast,
  wantsFrost,
  wantsEnchant,
  type ControlState,
} from "./controls";
import type { FrameContext } from "./frame-context";
import { castEvent, swingStrike, type CastEvent } from "./hero/hero-actions";
import { heroFigure } from "./hero/hero-figure";
import { HeroLook } from "./hero/hero-look";
import type { ShadowLight } from "./hero/hero-shadow";
import type { PixelCloud } from "./ink";
import { logicalPoint } from "./integer-scale";
import { mouseButtonOf } from "./keybindings";
import { HERO_EQUIPPED } from "./models";
import { PixelSurface } from "./pixel-surface";
import { DEFAULT_STRAFE_RADIUS, type Gait, type PlanetPoint, type PlanetPose } from "./planet";
import {
  advancePlayer,
  createPlayer,
  groundPose,
  livePose,
  scrollPhase,
  upcomingAnchor,
  type PlayerState,
  type UpcomingAnchor,
  type World,
} from "./player";
import { RANK, rowAtFoot, TILE_WIDTH } from "./projection";
import { MAX_STEP_MS } from "./spark-emitter";
import { blockedGround } from "./lakes";
import { aboveWater, waterlineReflection } from "./water/wake";
import type { WindOptions } from "./wind";

export interface Foot {
  readonly x: number;
  readonly y: number;
}

/**
 * The views of the hero's pose `camera.ts` and the scene need: the pose the
 * world is sampled from (it moves a whole tile at a time), how far the world
 * has slid out from under him in tiles, the continuous heading only the
 * horizon is far enough away to show, and the anchor he is walking into.
 */
export interface Whereabouts {
  readonly ground: PlanetPose;
  readonly phase: { readonly x: number; readonly y: number };
  readonly turn: number;
  readonly upcoming: UpcomingAnchor | undefined;
  /** Where he actually is on the planet - what decides how deep the water round him is. */
  readonly at: PlanetPoint;
  /** Tiles walked in all: where his footfalls are. */
  readonly walked: number;
}

/**
 * How tall the hero's silhouette is, in logical pixels.
 *
 * Measured off the base pose rather than written down, so re-proportioning the
 * rig in `models.ts` moves where a short window centres him instead of leaving a
 * stale number to disagree with the drawing.
 */
export function heroHeight(): number {
  const cloud = heroFigure(HERO_EQUIPPED.basePose).cloud;
  return cloud.reduce((tallest, pixel) => Math.max(tallest, -pixel.y), 0) + 1;
}

/** His surface: room for a raised blade, its flames and a trail. Foot at (36, 56). */
const BODY = { width: 72, height: 64, footX: 36, footY: 56 } as const;
/** His shadow's: long at dusk, flat on the ground. Foot at (40, 6). */
const SHADOW = { width: 80, height: 18, footX: 40, footY: 6 } as const;

/** The sun until a scene hands one over: high over the left shoulder. */
const DEFAULT_SUN: ShadowLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.7 };

export class HeroLayer {
  private readonly controls = createControls();
  private readonly look = new HeroLook();
  private player: PlayerState;
  private world: World;
  private groundTop = 0;
  private foot: Foot = { x: 0, y: 0 };
  /** How far the ground's depths have slid this frame (`scrollRows`), in depth units. */
  private slid = 0;
  private body!: PixelSurface;
  private shade!: PixelSurface;
  private cloud: PixelCloud = [];
  private strikes: Strike[] = [];
  private casts: CastEvent[] = [];
  private hits = 0;
  /** Set once a scene calls `update`; from then on `animate` leaves drawing to it. */
  private driven = false;
  private lastElapsedMs = 0;
  private lastDeltaMs = 0;
  /** Rows of him under water. */
  private sunk = 0;
  /** Half his height: where on him the aim is measured from. */
  private readonly chestHeight = heroHeight() / 2;

  /**
   * `blocked` is what stops him walking: the overworld's lakes and land unless
   * the scene says otherwise - and the scene does, so a cave's wall can stop
   * him while he is inside one (`cave-realm-layer.ts`).
   */
  constructor(
    start: PlanetPose,
    radius: number = DEFAULT_STRAFE_RADIUS,
    blocked: (point: PlanetPoint) => boolean = blockedGround,
  ) {
    this.player = createPlayer(start);
    this.world = { radius, blocked };
  }

  create(scene: Scene, groundTop: number, foot: Foot): void {
    this.groundTop = groundTop;
    this.foot = foot;
    this.shade = new PixelSurface(scene, SHADOW.width, SHADOW.height, "hero-shadow");
    this.body = new PixelSurface(scene, BODY.width, BODY.height, "hero");
    this.bindInput(scene);
    this.draw(DEFAULT_SUN, 1, undefined);
  }

  /**
   * Move the anchor after the window changed how much playfield there is.
   *
   * A round planet has no field to be fenced out of, so a shorter window
   * re-centres the hero rather than clamping him back inside something.
   */
  setAnchor(foot: Foot): void {
    if (foot.x === this.foot.x && foot.y === this.foot.y) {
      return;
    }
    this.foot = foot;
    this.place();
  }

  /**
   * One frame of simulation: read what is held, let each track commit to an
   * action, and turn the beats that fired into strikes and casts.
   *
   * The delta is clamped for the same reason an emitter's is - a backgrounded
   * tab must not resolve four seconds of walking in a single step.
   */
  animate(delta: number, elapsedMs: number): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    const tick = advancePlayer(
      this.player,
      {
        heading: nextHeading(this.controls),
        aim: currentAim(this.controls),
        attack: wantsAttack(this.controls),
        cast: wantsCast(this.controls),
        frost: wantsFrost(this.controls),
        enchant: wantsEnchant(this.controls),
      },
      step,
      this.world,
    );
    this.player = tick.player;
    this.spend(tick);
    const at = scrollPhase(this.player);
    // A blow or a spell goes where he points, not where he walks: twin-stick.
    if (tick.struck) {
      this.strikes.push(swingStrike(this.player.facing, at, this.player.enchanted));
    }
    if (tick.released) {
      this.casts.push(castEvent(this.player.facing, at, this.player.school));
    }
    this.lastElapsedMs = elapsedMs;
    this.lastDeltaMs = step;
    if (!this.driven) {
      this.draw(DEFAULT_SUN, 1, undefined);
    }
  }

  /**
   * Draw this frame under the scene's sky: its light direction and sun height
   * shade him and throw his shadow, its shadow strength darkens that, and the
   * burning blade's light goes into `ctx.lights`.
   */
  update(ctx: FrameContext): void {
    this.driven = true;
    this.lastElapsedMs = ctx.elapsedMs;
    this.lastDeltaMs = ctx.deltaMs;
    this.slid = scrollRows(ctx.frame) * TILE_WIDTH;
    const sun: ShadowLight = { light: ctx.atmosphere.light, elevation: ctx.atmosphere.elevation };
    this.draw(sun, ctx.atmosphere.shadowStrength, ctx.wind);
    // He stands, so the cloud shadow reaches him as a tint, not through the ground's pass.
    this.body.image.setTint(ctx.shade.tint(this.foot.x, this.foot.y));
    const light = this.look.light(this.player, this.foot.x, this.foot.y, ctx.elapsedMs);
    if (light !== undefined) {
      ctx.lights.push(light);
    }
  }

  /** Blows landed at the swing's contact beat since the last call, local tiles. */
  drainStrikes(): Strike[] {
    const strikes = this.strikes;
    this.strikes = [];
    return strikes;
  }

  /** Spells released at the cast's release beat since the last call. */
  drainCasts(): CastEvent[] {
    const casts = this.casts;
    this.casts = [];
    return casts;
  }

  /**
   * Tell the hero one of his strikes connected. He answers with a burst off the
   * blade's tip; the camera's answer (hit stop, shake) is the scene's to give,
   * through `ctx.impulse`, because only the scene knows how hard the hit was.
   */
  reportHit(): void {
    this.hits += 1;
    this.look.hit(this.player.enchanted);
  }

  /** How many hits have been reported — a counter a scene or a test can diff. */
  hitsLanded(): number {
    return this.hits;
  }

  isEnchanted(): boolean {
    return this.player.enchanted;
  }

  /** Where the world has got to under him: the views of the pose the scene hands on. */
  whereabouts(): Whereabouts {
    const live = livePose(this.player, this.world.radius);
    return {
      ground: groundPose(this.player),
      phase: scrollPhase(this.player),
      turn: live.turn,
      upcoming: upcomingAnchor(this.player, this.world.radius),
      at: live,
      walked: this.player.walked,
    };
  }

  /**
   * How many rows of him the water hides this frame (`sinkRows`): his feet and
   * shins, which are under it. Drawn and reflected without them from the next
   * `update`.
   */
  wade(rows: number): void {
    this.sunk = Math.max(0, Math.round(rows));
  }

  /**
   * What the water gives back of him: the part above it, mirrored about the
   * waterline - which is where his legs go in, not where his feet stand.
   */
  reflection(): { readonly cloud: PixelCloud; readonly foot: Foot } {
    return waterlineReflection(this.cloud, this.foot, this.sunk);
  }

  /**
   * The whole of the pose, for the debug map only - the one caller allowed to
   * see the live pose and the step in flight together.
   */
  debugState(): {
    readonly live: PlanetPose;
    readonly gait: Gait | undefined;
    readonly progress: number;
    readonly radius: number;
  } {
    return {
      live: livePose(this.player, this.world.radius),
      gait: this.player.gait,
      // How far into the tile he is walking out of: the anchor moves at 1.
      progress: Math.max(Math.abs(this.player.offset.x), Math.abs(this.player.offset.y)),
      radius: this.world.radius,
    };
  }

  /** The hero as pixels (body only), for anything that wants to reflect or transform him. */
  cloudNow(): PixelCloud {
    return this.cloud;
  }

  /** Where his feet are - fixed, because everything else is what moves. */
  footNow(): Foot {
    return this.foot;
  }

  private spend(tick: ReturnType<typeof advancePlayer>): void {
    if (tick.attacked) {
      spendAttack(this.controls);
    }
    if (tick.cast) {
      spendCast(this.controls);
      spendFrost(this.controls);
    }
    if (tick.toggled) {
      spendEnchant(this.controls);
    }
    if (tick.usedHeading) {
      spendHeading(this.controls);
    }
  }

  private draw(sun: ShadowLight, shadowStrength: number, wind: WindOptions | undefined): void {
    const frame = this.look.frame({
      player: this.player,
      elapsedMs: this.lastElapsedMs,
      deltaMs: this.lastDeltaMs,
      sun,
      wind,
    });
    this.cloud = aboveWater(frame.figure, this.sunk);
    this.body.clear().paint(aboveWater(frame.scene, this.sunk), BODY.footX, BODY.footY).commit();
    this.shade.clear();
    if (shadowStrength > 0.02) {
      this.shade.paint(frame.shadow, SHADOW.footX, SHADOW.footY, Math.min(shadowStrength * 1.1, 1));
    }
    this.shade.commit();
    this.place();
  }

  private place(): void {
    const row = Math.round(rowAtFoot(this.foot.y, this.groundTop));
    this.body.image.setPosition(this.foot.x - BODY.footX, this.foot.y - BODY.footY);
    this.body.image.setDepth(row * TILE_WIDTH + RANK.actor);
    this.shade.image.setPosition(this.foot.x - SHADOW.footX, this.foot.y - SHADOW.footY);
    // Over the grass of his own row, not under it: a shadow darkens the blades it falls on.
    // The grass slides in depth with the scroll (`groundRow`), so the shadow follows it -
    // never past his own body, though: once that row has slid over him, it is over both.
    const ground = row * TILE_WIDTH + RANK.grass + 0.5 + this.slid;
    this.shade.image.setDepth(Math.min(ground, row * TILE_WIDTH + RANK.actor - 0.5));
  }

  /**
   * Raw DOM events, translated and nothing more - every decision about what an
   * input *means* was already made in `keybindings.ts`.
   *
   * A bound key is prevented from doing its browser job (space scrolls the
   * page, the arrows scroll it too), and an unbound one is left alone so
   * refresh and devtools still work.
   */
  private bindInput(scene: Scene): void {
    scene.input.keyboard.on("keydown", (event: KeyboardEvent) => {
      if (pressKey(this.controls, event.code)) {
        event.preventDefault();
      }
    });
    scene.input.keyboard.on("keyup", (event: KeyboardEvent) => {
      if (releaseKey(this.controls, event.code)) {
        event.preventDefault();
      }
    });

    // Right-click is the cast, so the context menu is in the way.
    scene.input.disableContextMenu();
    // Aim is taken from his chest, not his feet, so the cursor on his body is on centre.
    const chest = (): Foot => ({ x: this.foot.x, y: this.foot.y - this.chestHeight });
    scene.input.on("pointermove", (pointer: Pointer) => {
      aimFrom(this.controls, pointer, scene, chest());
    });
    scene.input.on("pointerdown", (pointer: Pointer) => {
      aimFrom(this.controls, pointer, scene, chest());
      pressButton(this.controls, mouseButtonOf(pointer.button));
    });
    scene.input.on("pointerup", (pointer: Pointer) => {
      releaseButton(this.controls, mouseButtonOf(pointer.button));
    });

    // A key released while the tab is in the background never sends its keyup.
    scene.game.on("blur", () => releaseAll(this.controls));
  }

}

/**
 * Point the aim at the cursor, measured from `from`.
 *
 * The page position is mapped back through the canvas's own box: the canvas is
 * sized by CSS at a whole-number scale, so its box is the one truth about
 * where a logical pixel is on the page.
 */
function aimFrom(controls: ControlState, pointer: Pointer, scene: Scene, from: Foot): void {
  const event = pointer.event;
  if (!("clientX" in event)) {
    return;
  }
  const at = logicalPoint(
    event.clientX,
    event.clientY,
    scene.game.canvas.getBoundingClientRect(),
    scene.scale.width,
    scene.scale.height,
  );
  aimAt(controls, at.x - from.x, at.y - from.y);
}
