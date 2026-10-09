/**
 * The meadow: pre-rendered tufts, one blitter per screen row, bent by the wind.
 *
 * Grass is a property of the ground, so it lives on the local grid like the
 * ground does - tufts rooted in grass cells, seeded from the *planet* point
 * each cell reads (`ground/tuft-placement.ts`), laid out on the zero-phase grid
 * and slid by the scroll so they travel with the ground to the pixel.
 *
 * Everything that costs is paid once:
 *
 *     at load   : every tuft shape at every bend -> one strip texture
 *     per step  : where the tufts are            -> bob positions and shapes
 *     per frame : the wind on a coarse grid      -> each tuft picks a frame
 *
 * A `Blitter` per row is the cheap way to draw a few hundred small frames from
 * one texture, and it keeps the depth rule the old `Graphics` rows had: tufts
 * sort as `rootedDepth(row, RANK.grass)`, slid by the scroll as everything
 * else on the ground is (`groundRow`), so a tuft one row nearer than the hero
 * covers his feet, a boulder among the tufts keeps its place in the order, and
 * the far rows go under the horizon band with the ground they grow from.
 *
 * **The wind is the showpiece.** It is sampled from the one wind field
 * (`windAt`) at each tuft's *planet* position, in pixels, so a gust is a wave
 * that visibly rolls across the meadow rather than every tuft flinching at
 * once. It is evaluated on a grid every two tiles and interpolated, because the
 * field's features are ten tiles long and `windAt` is not free. Anything
 * standing in the grass - the hero by default - presses the tufts around its
 * feet away from it, and flattens the ones right under it.
 */

import type { Blitter, Bob, Scene } from "../engine";
import {
  latticeRow,
  localFoot,
  localOrigin,
  localReach,
  scrollOffset,
  scrollRows,
  type CameraFrame,
  type LocalBounds,
} from "./camera";
import type { CloudShade } from "./cloud-shadow";
import { ALL_EFFECTS, type EffectSwitches } from "./effects";
import type { FrameContext } from "./frame-context";
import { prefetchGroundSample, sharedGroundSample, type GroundSample } from "./ground/ground-sample";
import {
  inWater,
  placeTufts,
  swayBend,
  windBetween,
  windGrid,
  type TuftPlacement,
  type WaterPatch,
  type WindGrid,
} from "./ground/tuft-placement";
import { bendFrame, BEND_FRAMES, FLAT_LEFT, FLAT_RIGHT, TUFT_FRAME, TUFT_SHAPES, tuftBuffers, tuftFrame } from "./ground/tufts";
import { LAKE_MAX_REACH, LAKE_SPREAD, lakesNear } from "./lakes";
import { installStrip } from "./pixel-surface";
import { toLocal, type PlanetPoint, type PlanetPose } from "./planet";
import { RANK, rootedDepth, TILE_DEPTH, TILE_WIDTH, type ScreenPoint } from "./projection";
import { puddlesNear } from "./terrain";
import { windAt, type WindOptions } from "./wind";

export const TUFT_TEXTURE = "grass-tufts";

/** Tufts within this many tiles of a pusher lean away from it. */
const PUSH_RADIUS = 1.2;
/** How often bare ground (a scorch, say) is re-read: it changes on a scale of seconds. */
const BARE_CHECK_MS = 250;

/** True where no grass should grow right now - scorched earth, a trampled camp. */
export type BareGround = (planet: PlanetPoint) => boolean;

/** Something standing in the grass, in screen pixels at its feet. */
export interface GrassPusher extends ScreenPoint {
  /** 0..1: how hard it presses. 1 flattens what is right underfoot. */
  readonly weight?: number;
}

/** Where a pose's tufts stand, worked out before or as it arrives. */
interface Placements {
  readonly pose: PlanetPose;
  readonly wind: WindGrid;
  readonly tufts: readonly TuftPlacement[];
}

interface LiveTuft {
  readonly bob: Bob;
  readonly placement: TuftPlacement;
  frame: number;
  bare: boolean;
}

const FRAME_NAMES = Array.from({ length: TUFT_SHAPES.length * BEND_FRAMES }, (_unused, index) => String(index));

export class VegetationLayer {
  private scene!: Scene;
  private rows: Blitter[] = [];
  /** Each row's depth at rest; the scroll's slide is added per frame. */
  private rowDepths: number[] = [];
  /** The slide the rows' depths carry now. */
  private slid = 0;
  private pools: Bob[][] = [];
  private tufts: LiveTuft[] = [];
  private wind: WindGrid | undefined;
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private origin = { x: 0, y: 0 };
  private sampled: PlanetPose | undefined;
  /** The tufts placed ahead for the anchor the hero is walking into. */
  private ahead: Placements | undefined;
  private flat: CameraFrame | undefined;
  private bareGround: BareGround | undefined;
  /** What the tufts were last tinted for: the cloud pattern, the scroll and the tufts in place. */
  private shadedKey = "";
  private bareCheckedAt = Number.NEGATIVE_INFINITY;
  /** The last frame's cost, ms - read it from the console when profiling. */
  lastFrameMs = 0;
  /** Whether the rows are shown, and whether the tufts were last left swaying. */
  private shown = true;
  private swayed = true;

  /** `grass` off hides every row and skips the frame; `sway` off seats each tuft at rest. */
  constructor(private readonly effects: EffectSwitches = ALL_EFFECTS) {}

  create(scene: Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    installStrip(scene.textures, TUFT_TEXTURE, tuftBuffers());
    this.layout(frame, bounds);
  }

  /** Re-row after a resize changed how much playfield the window shows. */
  layout(frame: CameraFrame, bounds: LocalBounds): void {
    for (const row of this.rows) {
      row.destroy();
    }
    this.bounds = bounds;
    const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
    this.flat = flat;
    this.origin = localOrigin(flat, { x: bounds.minX, y: bounds.maxY });
    const count = bounds.maxY - bounds.minY + 1;
    this.rowDepths = Array.from({ length: count }, (_unused, index) =>
      rootedDepth(latticeRow(flat, { x: 0, y: bounds.minY + index }), RANK.grass),
    );
    this.rows = this.rowDepths.map((depth) => this.scene.add.blitter(0, 0, TUFT_TEXTURE).setDepth(depth).setVisible(this.shown));
    this.slid = 0;
    this.pools = this.rows.map(() => []);
    this.tufts = [];
    this.sampled = undefined;
    this.ahead = undefined;
  }

  /**
   * Where grass must not grow right now, as a test on a planet point (the
   * middle of each tuft's cell). Re-read every `BARE_CHECK_MS` and on every
   * step; pass `undefined` to clear it.
   */
  setBare(bare: BareGround | undefined): void {
    this.bareGround = bare;
    this.bareCheckedAt = Number.NEGATIVE_INFINITY;
  }

  /** Legacy form: wind at its defaults, the hero the only thing in the grass. */
  animate(frame: CameraFrame, pose: PlanetPose, elapsedMs: number): void {
    this.draw(frame, pose, elapsedMs, {}, [{ x: frame.footX, y: frame.footY }]);
  }

  /**
   * The frame-context form. `pushers` defaults to the hero's feet; pass more
   * (a slime, a falling body) and the grass parts around them too.
   */
  update(ctx: FrameContext, pushers?: readonly GrassPusher[]): void {
    if (this.effects.on("grass") !== this.shown) {
      this.shown = !this.shown;
      this.rows.forEach((row) => row.setVisible(this.shown));
    }
    if (!this.shown) {
      return;
    }
    this.draw(ctx.frame, ctx.pose, ctx.elapsedMs, ctx.wind, pushers ?? [{ x: ctx.frame.footX, y: ctx.frame.footY }]);
    this.shadeTufts(ctx.shade, ctx.frame);
  }

  /**
   * Tint each tuft by the cloud shadow at its root. A tuft on the field sorts
   * among the things standing there, over the cloud shadows' own pass, so it
   * takes the shadow the ground under it has - re-tinted only when the pattern
   * on the screen has moved.
   */
  private shadeTufts(shade: CloudShade, frame: CameraFrame): void {
    const offset = scrollOffset(frame);
    const key = `${shade.key}|${offset.x},${offset.y}`;
    if (key === this.shadedKey) {
      return;
    }
    this.shadedKey = key;
    const left = this.origin.x + offset.x;
    const top = this.origin.y + offset.y;
    for (const tuft of this.tufts) {
      tuft.bob.setTint(shade.tint(left + tuft.placement.x, top + tuft.placement.y));
    }
  }

  draw(
    frame: CameraFrame,
    pose: PlanetPose,
    elapsedMs: number,
    wind: WindOptions,
    pushers: readonly GrassPusher[],
  ): void {
    const started = performance.now();
    if (this.sampled !== pose) {
      this.resample(pose);
      this.sampled = pose;
      this.bareCheckedAt = Number.NEGATIVE_INFINITY;
      this.shadedKey = "";
    }
    if (elapsedMs - this.bareCheckedAt >= BARE_CHECK_MS || elapsedMs < this.bareCheckedAt) {
      this.checkBare();
      this.bareCheckedAt = elapsedMs;
    }
    const offset = scrollOffset(frame);
    const left = this.origin.x + offset.x;
    const top = this.origin.y + offset.y;
    // The rows slide in depth as they slide on screen (`groundRow`), so a
    // boulder rooted among them keeps its place in the order all stride long.
    const slid = scrollRows(frame) * TILE_WIDTH;
    this.rows.forEach((row, index) => {
      row.setPosition(left, top);
      if (slid !== this.slid) {
        row.setDepth((this.rowDepths[index] ?? 0) + slid);
      }
    });
    this.slid = slid;
    // Without sway no wind is sampled and no frame chosen: each tuft is put back at
    // rest once, on the frame the sway went off, and stays there.
    const sways = this.effects.on("sway");
    if (sways) {
      this.blow(elapsedMs, wind);
    }
    for (const tuft of sways || this.swayed ? this.tufts : []) {
      const rest = tuftFrame(tuft.placement.shape, bendFrame(0));
      const next = !sways ? rest : tuft.bare ? tuft.frame : this.frameFor(tuft.placement, elapsedMs, left, top, pushers);
      if (next !== tuft.frame) {
        tuft.frame = next;
        tuft.bob.setFrame(FRAME_NAMES[next] ?? "0");
      }
    }
    this.swayed = sways;
    this.lastFrameMs = performance.now() - started;
  }

  /**
   * Hide the tufts on bare ground and show the rest. Neighbouring tufts share
   * a cell, and so a planet point, so the test runs once per cell.
   */
  private checkBare(): void {
    const bare = this.bareGround;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let lastAnswer = false;
    for (const tuft of this.tufts) {
      let answer = false;
      if (bare !== undefined) {
        const { planetX, planetY } = tuft.placement;
        if (planetX !== lastX || planetY !== lastY) {
          lastX = planetX;
          lastY = planetY;
          lastAnswer = bare({ x: planetX, y: planetY });
        }
        answer = lastAnswer;
      }
      if (answer !== tuft.bare) {
        tuft.bare = answer;
        tuft.bob.setVisible(!answer);
      }
    }
  }

  /** The puddles and lakes on screen, in grid pixels - grass does not root in water. */
  private waterPatches(pose: PlanetPose): WaterPatch[] {
    const flat = this.flat;
    if (flat === undefined) {
      return [];
    }
    const reach = localReach(this.bounds);
    const at = (site: PlanetPoint): { x: number; y: number } => {
      const foot = localFoot(flat, toLocal(pose, site));
      return { x: foot.x - this.origin.x, y: foot.y - this.origin.y };
    };
    const lakes = lakesNear(pose, reach + LAKE_MAX_REACH).map((lake) => ({
      ...at(lake),
      radius: lake.size,
      outline: { seed: lake.seed, spread: LAKE_SPREAD },
    }));
    return [...lakes, ...puddlesNear(pose, reach).map((site) => ({ ...at(site), radius: site.size }))];
  }

  /** This frame's wind at every grid node. */
  private blow(elapsedMs: number, wind: WindOptions): void {
    const grid = this.wind;
    if (grid === undefined) {
      return;
    }
    for (let index = 0; index < grid.value.length; index += 1) {
      grid.value[index] = windAt(elapsedMs, grid.x[index] ?? 0, grid.y[index] ?? 0, wind);
    }
  }

  private frameFor(
    tuft: TuftPlacement,
    elapsedMs: number,
    left: number,
    top: number,
    pushers: readonly GrassPusher[],
  ): number {
    const gust = this.wind === undefined ? 0 : windBetween(this.wind, tuft.windU, tuft.windV);
    let bend = swayBend(tuft, gust, elapsedMs);
    for (const pusher of pushers) {
      const dx = (left + tuft.x - pusher.x) / TILE_WIDTH;
      const dy = (top + tuft.y - pusher.y) / TILE_DEPTH;
      const distance = Math.hypot(dx, dy);
      if (distance >= PUSH_RADIUS) {
        continue;
      }
      const press = (1 - distance / PUSH_RADIUS) * (pusher.weight ?? 1);
      const side = dx === 0 ? (tuft.phase < Math.PI ? -1 : 1) : Math.sign(dx);
      if (press > 0.62) {
        return tuftFrame(tuft.shape, side < 0 ? FLAT_LEFT : FLAT_RIGHT);
      }
      bend += side * press * 6;
    }
    return tuftFrame(tuft.shape, bendFrame(bend));
  }

  /**
   * Place the tufts for the anchor the hero is walking into, ahead of the frame
   * that crosses into it - which then only re-seats bobs.
   */
  prefetch(pose: PlanetPose): void {
    if (!this.shown || this.ahead?.pose === pose || this.sampled === pose) {
      return;
    }
    this.ahead = this.placementsFor(pose, prefetchGroundSample(pose, this.bounds));
  }

  private placementsFor(pose: PlanetPose, sample: GroundSample): Placements {
    const water = this.waterPatches(pose);
    return {
      pose,
      wind: windGrid(sample),
      tufts: placeTufts(sample).filter((placement) => !inWater(placement, water)),
    };
  }

  /** Where the tufts are for this pose: re-seat the pooled bobs, row by row. */
  private resample(pose: PlanetPose): void {
    // Called first so the sample taken ahead becomes the one on screen either way.
    const sample = sharedGroundSample(pose, this.bounds);
    const placed = this.ahead?.pose === pose ? this.ahead : this.placementsFor(pose, sample);
    this.ahead = undefined;
    this.wind = placed.wind;
    const used = this.pools.map(() => 0);
    this.tufts = [];
    for (const placement of placed.tufts) {
      const index = placement.localY - this.bounds.minY;
      const blitter = this.rows[index];
      const pool = this.pools[index];
      if (blitter === undefined || pool === undefined) {
        continue;
      }
      const slot = used[index] ?? 0;
      used[index] = slot + 1;
      const frame = tuftFrame(placement.shape, bendFrame(0));
      const x = placement.x - TUFT_FRAME.originX;
      const y = placement.y - TUFT_FRAME.originY;
      let bob = pool[slot];
      if (bob === undefined) {
        bob = blitter.create(x, y, FRAME_NAMES[frame]);
        pool.push(bob);
      } else {
        bob.reset(x, y, FRAME_NAMES[frame]);
      }
      this.tufts.push({ bob, placement, frame, bare: false });
    }
    this.pools.forEach((pool, index) => {
      for (let slot = used[index] ?? 0; slot < pool.length; slot += 1) {
        pool[slot]?.setVisible(false);
      }
    });
  }
}
