/**
 * The debug map: what the simulation thinks is happening, beside what is drawn.
 *
 * Opt-in with `?map=1`, the way `?horizon=` and `?radius=` are, and off on every
 * other load — the page is the game world and nothing else unless you ask.
 *
 * **This is an instrument, not art.** It is drawn on its own 2D canvas stacked
 * over the game's, at the window's own resolution, so it never enters the
 * 320x180 render target and is not bound by the closed ink palette, the pixel
 * grid, or the no-antialiasing rule. Those contracts govern the world; a ruler
 * held up against the world is not part of it, and making it obey them would
 * only make it harder to read and easier to mistake for the game.
 *
 * Three panels, because the confusion it exists to settle is a disagreement
 * between frames:
 *
 * - **Planet** — north up, the frame nothing rotates in. The hero's true
 *   position and heading, the pivot his strafe orbits, the circle he walks
 *   around it, the patch of planet the screen is sampling, and the tree and
 *   puddle features as the points on the planet they are.
 * - **Screen** — the local frame, which *is* the tile grid, and which turns.
 * - **Readout** — the numbers, including the one this was built for: how far the
 *   picture will jump when the step in flight lands.
 *
 * That last number is the point. A strafe *rotates* the local frame — a point
 * `y` tiles ahead sweeps sideways by `d * (1 + y / radius)` — while the renderer
 * carries a step in flight as one uniform *translation* (`scrollPhase`). The two
 * agree at the start of a step and part company by its end, where the drawing
 * snaps onto the truth by a different amount for every object on screen. Walking
 * forward is exempt, because that step really is a translation.
 *
 * The geometry is `map-drift.ts` (pure, tested) and the pictures are
 * `map-panels.ts`. Nothing is re-derived here.
 */

import type { LocalBounds } from "./camera";
import { probeGrid, stepDrift, worstDrift, type DriftSample } from "./map-drift";
import { COLOR, drawPlanetPanel, drawScreenPanel } from "./map-panels";
import { strafeLap, type Gait, type PlanetPose } from "./planet";

/** Everything the map reads. Handed in, so the overlay owns no simulation. */
export interface MapState {
  /** The pose the world is sampled from — frozen for the length of a step. */
  readonly groundPose: PlanetPose;
  /** Where the hero continuously is, mid-stride and all. */
  readonly livePose: PlanetPose;
  /** The step in flight, or undefined between steps. */
  readonly gait: Gait | undefined;
  /** How far through that step, 0 to 1. */
  readonly progress: number;
  /** The uniform offset the picture is currently drawn at, in tiles. */
  readonly phase: { readonly x: number; readonly y: number };
  readonly bounds: LocalBounds;
  readonly radius: number;
  /** Wall-clock milliseconds the last frame took. */
  readonly frameMs: number;
}

const PANEL_WIDTH = 300;
const PLANET_HEIGHT = 240;
const SCREEN_HEIGHT = 190;
const TEXT_HEIGHT = 116;
const PAD = 10;
/** Scanlines of a panel spent on its label, before the picture starts. */
const HEADER = 18;
const TRAIL_MAX = 400;
/** The step the drift panel asks about while the hero is standing still. */
const PROBE_GAIT: Gait = { forward: 0, strafe: 1 };

/**
 * Read the map's flag off the query string.
 *
 * Absent, `0`, `false` and `off` all mean off, so `?map=0` reads the way anyone
 * expects rather than switching the map on because the key was present.
 */
export function wantsMap(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export class MapOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Planet points the hero has stood on, so the walked path is visible. */
  private readonly trail: { x: number; y: number }[] = [];
  /** Smoothed, because a per-frame number is unreadable. */
  private smoothedMs = 16.7;

  private constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Build and attach the overlay, or return null when it was not asked for. */
  static attach(host: HTMLElement, enabled: boolean): MapOverlay | null {
    if (!enabled) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = PANEL_WIDTH + PAD * 2;
    canvas.height = PLANET_HEIGHT + SCREEN_HEIGHT + TEXT_HEIGHT + PAD * 4;
    canvas.style.cssText =
      "position:absolute;left:8px;top:8px;z-index:10;pointer-events:none;image-rendering:auto";
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return null;
    }
    host.appendChild(canvas);
    return new MapOverlay(canvas, ctx);
  }

  draw(state: MapState): void {
    this.smoothedMs += (state.frameMs - this.smoothedMs) * 0.08;
    this.recordTrail(state.livePose);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.textBaseline = "top";

    const samples = this.drift(state);
    let top = PAD;
    top = this.panel("PLANET — north up, nothing rotates here", top, PLANET_HEIGHT, () =>
      drawPlanetPanel(ctx, state, this.trail, PANEL_WIDTH, PLANET_HEIGHT - HEADER),
    );
    top = this.panel("SCREEN — the local frame, which turns", top, SCREEN_HEIGHT, () =>
      drawScreenPanel(ctx, state, samples, PANEL_WIDTH, SCREEN_HEIGHT - HEADER),
    );
    this.panel("READOUT", top, TEXT_HEIGHT, () => this.drawReadout(state, samples));
  }

  /**
   * How far the picture will jump when the step in flight lands.
   *
   * Measured at `progress` 1 rather than now, because the number worth showing
   * is the one the next step boundary is about to discharge — a prediction of
   * the snap, not a report of the error accumulated so far.
   *
   * Standing still it predicts a **hypothetical** step to the right instead of
   * reporting a truthful zero, because an instrument that is blank until you
   * are already moving cannot be read while you move: you would have to hold a
   * key and watch a panel at the same time. `PROBE_GAIT` is what the panel is
   * asking — "if you stepped sideways from here, what would happen" — and the
   * readout says so rather than letting it be mistaken for a measurement.
   */
  private drift(state: MapState): DriftSample[] {
    const { minX, maxX, minY, maxY } = state.bounds;
    const probes = probeGrid(minX + 1, maxX - 1, Math.max(minY, -2), maxY - 1, 5);
    return stepDrift(state.groundPose, state.gait ?? PROBE_GAIT, state.radius, probes, 1);
  }

  private recordTrail(pose: PlanetPose): void {
    const last = this.trail[this.trail.length - 1];
    if (last !== undefined && Math.hypot(pose.x - last.x, pose.y - last.y) < 0.25) {
      return;
    }
    this.trail.push({ x: pose.x, y: pose.y });
    if (this.trail.length > TRAIL_MAX) {
      this.trail.shift();
    }
  }

  /** Frame one panel, label it, and run `body` inside its clipped, translated box. */
  private panel(label: string, top: number, height: number, body: () => void): number {
    const ctx = this.ctx;
    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(PAD, top, PANEL_WIDTH, height);
    ctx.strokeStyle = COLOR.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD + 0.5, top + 0.5, PANEL_WIDTH - 1, height - 1);
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(label, PAD + 6, top + 5);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD + 1, top + HEADER, PANEL_WIDTH - 2, height - HEADER - 1);
    ctx.clip();
    ctx.translate(PAD, top + HEADER);
    body();
    ctx.restore();
    return top + height + PAD;
  }

  private drawReadout(state: MapState, samples: readonly DriftSample[]): void {
    const rows = this.readoutRows(state, worstDrift(samples));
    rows.forEach(([label, value, color], index) => {
      const y = 4 + index * 15;
      this.ctx.fillStyle = COLOR.dim;
      this.ctx.fillText(label, 8, y);
      this.ctx.fillStyle = color;
      this.ctx.fillText(value, 56, y);
    });
  }

  private readoutRows(state: MapState, worst: number): [string, string, string][] {
    const pose = state.livePose;
    const gait = state.gait;
    const fps = 1000 / Math.max(this.smoothedMs, 0.001);
    return [
      ["pose", `${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}  turn ${degrees(pose.turn)}`, COLOR.ink],
      [
        "step",
        gait === undefined
          ? "idle"
          : `fwd ${signed(gait.forward)} strafe ${signed(gait.strafe)}  ${(state.progress * 100).toFixed(0)}%`,
        COLOR.ink,
      ],
      [
        "phase",
        `${state.phase.x.toFixed(3)}, ${state.phase.y.toFixed(3)} tiles (uniform)`,
        COLOR.dim,
      ],
      [
        "radius",
        `${state.radius}  lap ${strafeLap(state.radius).toFixed(0)}t  step ${degrees(1 / state.radius)}`,
        COLOR.dim,
      ],
      [
        "snap",
        snapText(worst, gait === undefined),
        worst < 0.5 ? COLOR.good : COLOR.drift,
      ],
      ["frame", `${this.smoothedMs.toFixed(1)} ms  ${fps.toFixed(0)} fps`, COLOR.ink],
    ];
  }
}

/**
 * The snap, worded so a prediction cannot be mistaken for a measurement.
 *
 * Idle, the number answers "if you stepped right from here"; mid-step it is
 * what this step is actually about to do.
 */
function snapText(worst: number, idle: boolean): string {
  if (worst < 0.5) {
    return "0.0 px — picture matches simulation";
  }
  return idle
    ? `${worst.toFixed(1)} px if you step sideways`
    : `${worst.toFixed(1)} px at this step's end`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function degrees(radians: number): string {
  return `${((radians * 180) / Math.PI).toFixed(1)}°`;
}
