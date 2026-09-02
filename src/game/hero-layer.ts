/**
 * The played character: input in, pixels out.
 *
 * The split this file defends is the one `CLAUDE.md` asks for — the turn
 * simulation is deterministic and knows nothing about the presentation. So the
 * three interesting parts live elsewhere and none of them import Phaser:
 * `keybindings.ts` says what an input means, `controls.ts` says what is held,
 * and `player.ts` says what the hero does about it. What is left here is the
 * wiring: DOM events into the control state, and a posed rig into a `Graphics`.
 */

// `Phaser` is an ambient *type* namespace, so annotations alone compile without
// this import — but `Phaser.Core.Events.BLUR` below is a value read at runtime.
import Phaser from "phaser";

import {
  createControls,
  nextDirection,
  pressButton,
  pressKey,
  releaseAll,
  releaseButton,
  releaseKey,
  spendAttack,
  spendDirection,
  wantsAttack,
} from "./controls";
import { drawCloud } from "./draw-cloud";
import { cellFoot, isRock, type Cell } from "./field";
import type { PixelCloud } from "./ink";
import { mouseButtonOf } from "./keybindings";
import { HERO_EQUIPPED, IDLE, SWING, WALK } from "./models";
import {
  advancePlayer,
  clampToRows,
  createPlayer,
  playerPosition,
  walkClipMs,
  type PlayerState,
  type World,
} from "./player";
import { TILE_WIDTH } from "./projection";
import { renderModel, samplePose, type RigPose } from "./rig";
import { MAX_STEP_MS } from "./spark-emitter";

/** Rank within a row, on the scene's shared `row * TILE_WIDTH + rank` order. */
const RANK_ACTOR = 8;

export interface Foot {
  readonly x: number;
  readonly y: number;
}

export class HeroLayer {
  private readonly controls = createControls();
  private player: PlayerState;
  private world: World = { columns: 0, rows: 0, blocked: () => false };
  private columns = 0;
  private groundTop = 0;
  private gfx!: Phaser.GameObjects.Graphics;
  private cloud: PixelCloud = [];
  private foot: Foot = { x: 0, y: 0 };
  /** Kept so a resize can redraw the idle pose it was already holding. */
  private lastElapsedMs = 0;

  constructor(start: Cell) {
    this.player = createPlayer(start);
  }

  create(scene: Phaser.Scene, groundTop: number, columns: number, rows: number): void {
    this.groundTop = groundTop;
    this.columns = columns;
    this.setRows(rows);
    this.gfx = scene.add.graphics();
    this.bindInput(scene);
    this.redraw(0);
  }

  /**
   * Re-fence the field after the window changed how much of it is on screen.
   *
   * The scene calls this on every resize. Walking off the near edge and being
   * *carried* off it by a dragged window are the same bug, so both ends are
   * handled in one place: the world shrinks, and a hero already standing past
   * the new edge is clamped back inside it.
   */
  setVisibleRows(rows: number): void {
    if (rows === this.world.rows) {
      return;
    }
    this.setRows(rows);
    this.player = clampToRows(this.player, rows);
    this.redraw(this.lastElapsedMs);
  }

  private setRows(rows: number): void {
    this.world = {
      columns: this.columns,
      rows,
      blocked: (column, row) => isRock(column, row),
    };
  }

  /**
   * One frame: read what is held, let the simulation commit to an action, then
   * draw whatever pose that leaves.
   *
   * The delta is clamped for the same reason an emitter's is — a backgrounded
   * tab must not resolve four seconds of walking in a single step.
   */
  animate(delta: number, elapsedMs: number): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    const tick = advancePlayer(
      this.player,
      { direction: nextDirection(this.controls), attack: wantsAttack(this.controls) },
      step,
      this.world,
    );
    this.player = tick.player;
    if (tick.attacked) {
      spendAttack(this.controls);
    }
    if (tick.usedDirection) {
      spendDirection(this.controls);
    }
    this.redraw(elapsedMs);
  }

  /** The hero as pixels, for anything that wants to reflect or transform him. */
  cloudNow(): PixelCloud {
    return this.cloud;
  }

  /** Where his feet are this frame — the anchor his cloud is drawn from. */
  footNow(): Foot {
    return this.foot;
  }

  private redraw(elapsedMs: number): void {
    this.lastElapsedMs = elapsedMs;
    const position = playerPosition(this.player);
    const anchor = cellFoot(position.column, position.row, this.groundTop);
    this.foot = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
    this.cloud = renderModel(HERO_EQUIPPED, this.pose(elapsedMs), {
      facing: this.player.facing,
      flipX: this.player.flipX,
    });

    this.gfx.setDepth(Math.round(position.row) * TILE_WIDTH + RANK_ACTOR);
    this.gfx.clear();
    drawCloud(this.gfx, this.cloud, this.foot.x, this.foot.y);
  }

  /**
   * Which clip, sampled where. A step samples half a walk cycle so one press is
   * one stride, and the next press leads with the other leg.
   */
  private pose(elapsedMs: number): RigPose {
    const base = HERO_EQUIPPED.basePose;
    if (this.player.activity === "attack") {
      return samplePose(SWING, base, this.player.activityMs);
    }
    if (this.player.activity === "step") {
      return samplePose(WALK, base, walkClipMs(this.player, WALK.durationMs));
    }
    return samplePose(IDLE, base, elapsedMs);
  }

  /**
   * Raw DOM events, translated and nothing more — every decision about what an
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
