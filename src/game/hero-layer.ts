/**
 * The played character: input in, pixels out.
 *
 * The split this file defends is the one `CLAUDE.md` asks for - the movement
 * simulation is deterministic and knows nothing about the presentation. So the
 * four interesting parts live elsewhere and none of them import Phaser:
 * `keybindings.ts` says what an input means, `controls.ts` says what is held,
 * `planet.ts` says what a step does to a pose on a round world, and `player.ts`
 * says what the hero does about it. What is left here is the wiring: DOM events
 * into the control state, and a posed rig into a `Graphics`.
 *
 * One thing did change shape when the world went round. The hero no longer moves
 * across the screen - he *is* the screen's origin, nailed to `footX, footY`
 * while the planet slides and swings beneath him. So this layer is also the
 * place the rest of the scene comes to ask where the world has got to: it holds
 * the pose, and hands out the three views of it (`groundPose`, `phase`, `turn`)
 * that `camera.ts` and `panorama.ts` need.
 */

// `Phaser` is an ambient *type* namespace, so annotations alone compile without
// this import - but `Phaser.Core.Events.BLUR` below is a value read at runtime.
import Phaser from "phaser";

import {
  createControls,
  nextHeading,
  pressButton,
  pressKey,
  releaseAll,
  releaseButton,
  releaseKey,
  spendAttack,
  spendHeading,
  wantsAttack,
} from "./controls";
import { drawCloud } from "./draw-cloud";
import type { PixelCloud } from "./ink";
import { mouseButtonOf } from "./keybindings";
import { HERO_EQUIPPED, IDLE, SWING, WALK } from "./models";
import { DEFAULT_STRAFE_RADIUS, type PlanetPose } from "./planet";
import {
  advancePlayer,
  createPlayer,
  groundPose,
  livePose,
  scrollPhase,
  walkClipMs,
  type PlayerState,
  type World,
} from "./player";
import { RANK, rowAtFoot, TILE_WIDTH } from "./projection";
import { renderModel, samplePose, type RigPose } from "./rig";
import { MAX_STEP_MS } from "./spark-emitter";
import { isRockAt } from "./terrain";

export interface Foot {
  readonly x: number;
  readonly y: number;
}

/**
 * How tall the hero's silhouette is, in logical pixels.
 *
 * Measured off the base pose rather than written down, so re-proportioning the
 * rig in `models.ts` moves where a short window centres him instead of leaving a
 * stale number to disagree with the drawing.
 */
export function heroHeight(): number {
  const cloud = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose, {
    facing: "front",
    flipX: false,
  });
  return cloud.reduce((tallest, pixel) => Math.max(tallest, -pixel.y), 0) + 1;
}

export class HeroLayer {
  private readonly controls = createControls();
  private player: PlayerState;
  private world: World;
  private groundTop = 0;
  private foot: Foot = { x: 0, y: 0 };
  private gfx!: Phaser.GameObjects.Graphics;
  private cloud: PixelCloud = [];
  /** Kept so a resize can redraw the idle pose it was already holding. */
  private lastElapsedMs = 0;

  constructor(start: PlanetPose, radius: number = DEFAULT_STRAFE_RADIUS) {
    this.player = createPlayer(start);
    this.world = { radius, blocked: isRockAt };
  }

  create(scene: Phaser.Scene, groundTop: number, foot: Foot): void {
    this.groundTop = groundTop;
    this.foot = foot;
    this.gfx = scene.add.graphics();
    this.bindInput(scene);
    this.redraw(0);
  }

  /**
   * Move the anchor after the window changed how much playfield there is.
   *
   * This is the whole of the resize story now. There is no field to be fenced
   * out of and no near edge to be carried over - a round planet has neither - so
   * a shorter window re-centres the hero rather than clamping him back inside
   * something.
   */
  setAnchor(foot: Foot): void {
    if (foot.x === this.foot.x && foot.y === this.foot.y) {
      return;
    }
    this.foot = foot;
    this.redraw(this.lastElapsedMs);
  }

  /**
   * One frame: read what is held, let the simulation commit to an action, then
   * draw whatever pose that leaves.
   *
   * The delta is clamped for the same reason an emitter's is - a backgrounded
   * tab must not resolve four seconds of walking in a single step.
   */
  animate(delta: number, elapsedMs: number): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    const tick = advancePlayer(
      this.player,
      { heading: nextHeading(this.controls), attack: wantsAttack(this.controls) },
      step,
      this.world,
    );
    this.player = tick.player;
    if (tick.attacked) {
      spendAttack(this.controls);
    }
    if (tick.usedHeading) {
      spendHeading(this.controls);
    }
    this.redraw(elapsedMs);
  }

  /** The pose the world is sampled from - frozen for the length of a step. */
  groundPose(): PlanetPose {
    return groundPose(this.player);
  }

  /** How far the world has slid out from under him, in tiles. */
  phase(): { readonly x: number; readonly y: number } {
    return scrollPhase(this.player);
  }

  /** The continuous heading, which only the horizon is far enough away to show. */
  turn(): number {
    return livePose(this.player, this.world.radius).turn;
  }

  /** The hero as pixels, for anything that wants to reflect or transform him. */
  cloudNow(): PixelCloud {
    return this.cloud;
  }

  /** Where his feet are - fixed, because everything else is what moves. */
  footNow(): Foot {
    return this.foot;
  }

  private redraw(elapsedMs: number): void {
    this.lastElapsedMs = elapsedMs;
    this.cloud = renderModel(HERO_EQUIPPED, this.pose(elapsedMs), {
      facing: this.player.facing,
      flipX: this.player.flipX,
    });

    this.gfx.setDepth(
      Math.round(rowAtFoot(this.foot.y, this.groundTop)) * TILE_WIDTH + RANK.actor,
    );
    this.gfx.clear();
    drawCloud(this.gfx, this.cloud, this.foot.x, this.foot.y);
  }

  /**
   * Which clips, sampled where - plural, because he can swing while he walks.
   *
   * The two are *layered* rather than chosen between, which `samplePose` gives
   * for free: unkeyed channels fall through to the pose handed in as the base.
   * `SWING` keys only the sword arm, the sword and the torso, so laying it over
   * a walk sample leaves the legs striding and the root bobbing underneath it -
   * one line for a combination that would otherwise be a whole second clip.
   *
   * A step samples half a walk cycle so one press is one stride, and the next
   * press leads with the other leg.
   */
  private pose(elapsedMs: number): RigPose {
    const base = HERO_EQUIPPED.basePose;
    const moving =
      this.player.motion === "step"
        ? samplePose(WALK, base, walkClipMs(this.player, WALK.durationMs))
        : samplePose(IDLE, base, elapsedMs);

    const attackMs = this.player.attackMs;
    return attackMs === undefined ? moving : samplePose(SWING, moving, attackMs);
  }

  /**
   * Raw DOM events, translated and nothing more - every decision about what an
   * input *means* was already made in `keybindings.ts`.
   *
   * A bound key is prevented from doing its browser job (space scrolls the
   * page, the arrows scroll it too), and an unbound one is left alone so
   * refresh and devtools still work.
   */
  private bindInput(scene: Phaser.Scene): void {
    const keyboard = scene.input.keyboard;
    if (keyboard !== null) {
      keyboard.on("keydown", (event: KeyboardEvent) => {
        if (pressKey(this.controls, event.code)) {
          event.preventDefault();
        }
      });
      keyboard.on("keyup", (event: KeyboardEvent) => {
        if (releaseKey(this.controls, event.code)) {
          event.preventDefault();
        }
      });
    }

    // Right-click is an attack here, so the context menu is in the way.
    scene.input.mouse?.disableContextMenu();
    scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pressButton(this.controls, mouseButtonOf(pointer.button));
    });
    scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      releaseButton(this.controls, mouseButtonOf(pointer.button));
    });

    // A key released while the tab is in the background never sends its keyup.
    scene.game.events.on(Phaser.Core.Events.BLUR, () => releaseAll(this.controls));
  }
}
