/**
 * `?bench=1`: drive `BENCH_ROUTE` through the real input path and time it.
 *
 * Keys are pressed as `KeyboardEvent`s on `window`, the same events a player's
 * keyboard sends, so the bench exercises exactly what play does. Each frame is
 * timed from the start of its update to the end of its render (with the GPU
 * drained first under `sync`, so GPU work the CPU queued is charged to the
 * frame that queued it), and each layer by the scene's own laps.
 *
 * The result lands on `window.__bench`, in the console, and in a panel over the
 * canvas - this is an instrument, opted into by URL, like `?map=1`.
 *
 * `BenchSession` is the logic, with the clock, the keys and the heap handed in,
 * so it is tested without a page; `runBench` only wires it to one.
 */

import {
  BENCH_ROUTE,
  FrameProfiler,
  formatReport,
  reportSegment,
  segmentAt,
  tapsBy,
  type BenchSegment,
  type SegmentReport,
} from "./bench";
import { DEFAULT_KEYBINDINGS, type GameAction } from "./keybindings";

/** What the bench needs from the game: the scene, and a hook either side of a frame. */
export interface BenchHost {
  readonly scene: {
    setProfiler(profiler: FrameProfiler | null): void;
    isRevealed(): boolean;
  };
  /** Subscribe to the start of each frame's work and the end of its render. */
  onFrame(start: () => void, end: () => void): void;
  /** Drained at the end of every frame when `sync` is asked for. */
  readonly gl: WebGL2RenderingContext | WebGLRenderingContext | null;
}

export interface BenchOptions {
  readonly route?: readonly BenchSegment[];
  /** `gl.finish()` at the end of each frame, so GPU time is counted. */
  readonly sync?: boolean;
  /** How long to let the scene settle after it is revealed, ms. */
  readonly warmupMs?: number;
}

/** The world as a session sees it: a clock, a heap reading, and a keyboard. */
export interface BenchIO {
  readonly now: () => number;
  /** Bytes in use, or undefined where the browser does not say. */
  readonly heap: () => number | undefined;
  readonly press: (action: GameAction) => void;
  readonly release: (action: GameAction) => void;
}

/** One segment's raw samples as they come in. */
interface Recorder {
  readonly name: string;
  readonly startedAt: number;
  readonly work: number[];
  readonly interval: number[];
  heapGrowth: number | undefined;
}

type Phase = "waiting" | "warming" | "running" | "done";

/**
 * The route, frame by frame: wait for the scene to be revealed, let it settle,
 * then walk each segment - holding its keys, tapping its taps - and record what
 * every frame cost. `frameStart`/`frameEnd` are called around each frame;
 * `reports` is filled as segments finish and `done` says when the route is over.
 */
export class BenchSession {
  readonly profiler: FrameProfiler;
  readonly reports: SegmentReport[] = [];
  private phase: Phase = "waiting";
  private warmSince = 0;
  private benchStart = 0;
  private frameAt = 0;
  private lastStart = 0;
  private lastHeap: number | undefined;
  private current = -1;
  private recorder: Recorder | undefined;
  private held: readonly GameAction[] = [];
  private tapsDone = 0;

  constructor(
    private readonly route: readonly BenchSegment[],
    private readonly warmupMs: number,
    private readonly io: BenchIO,
  ) {
    this.profiler = new FrameProfiler(io.now);
    this.lastHeap = io.heap();
  }

  get done(): boolean {
    return this.phase === "done";
  }

  /** Whether frames are being recorded - the scene's laps only run while they are. */
  get running(): boolean {
    return this.phase === "running";
  }

  /** The start of a frame's work. Advances the route and presses what it asks. */
  frameStart(isRevealed: boolean): void {
    this.frameAt = this.io.now();
    this.advancePhase(isRevealed);
    if (this.phase !== "running") {
      return;
    }
    const at = segmentAt(this.route, this.frameAt - this.benchStart);
    if (at === undefined) {
      this.enter(this.route.length);
      this.phase = "done";
      return;
    }
    if (at.index !== this.current) {
      this.enter(at.index);
    }
    this.tap(this.route[at.index] as BenchSegment, at.intoMs);
  }

  /** The end of a frame's render: charge it to the segment it belongs to. */
  frameEnd(): void {
    const recorder = this.recorder;
    if (this.phase !== "running" || recorder === undefined) {
      this.lastStart = this.frameAt;
      return;
    }
    recorder.work.push(this.io.now() - this.frameAt);
    if (this.lastStart > 0) {
      recorder.interval.push(this.frameAt - this.lastStart);
    }
    this.lastStart = this.frameAt;
    const heap = this.io.heap();
    if (heap !== undefined && this.lastHeap !== undefined && recorder.heapGrowth !== undefined && heap > this.lastHeap) {
      recorder.heapGrowth += heap - this.lastHeap;
    }
    this.lastHeap = heap;
  }

  private advancePhase(isRevealed: boolean): void {
    if (this.phase === "waiting" && isRevealed) {
      this.phase = "warming";
      this.warmSince = this.frameAt;
    }
    if (this.phase === "warming" && this.frameAt - this.warmSince >= this.warmupMs) {
      this.phase = "running";
      this.benchStart = this.frameAt;
    }
  }

  /** Leave the segment in progress, reporting it, and start segment `index` (if there is one). */
  private enter(index: number): void {
    this.held.forEach(this.io.release);
    this.finishSegment();
    this.current = index;
    const segment = this.route[index];
    if (segment === undefined) {
      this.held = [];
      this.recorder = undefined;
      return;
    }
    this.recorder = {
      name: segment.name,
      startedAt: this.frameAt,
      work: [],
      interval: [],
      heapGrowth: this.io.heap() === undefined ? undefined : 0,
    };
    this.held = segment.hold;
    this.held.forEach(this.io.press);
    this.tapsDone = 0;
  }

  private finishSegment(): void {
    const recorder = this.recorder;
    if (recorder === undefined) {
      return;
    }
    this.reports.push(
      reportSegment({
        name: recorder.name,
        work: recorder.work,
        interval: recorder.interval,
        layers: new Map(this.profiler.samples()),
        heapGrowth: recorder.heapGrowth,
        durationMs: this.frameAt - recorder.startedAt,
      }),
    );
    this.profiler.reset();
  }

  private tap(segment: BenchSegment, intoMs: number): void {
    const due = tapsBy(segment, intoMs);
    for (; this.tapsDone < due; this.tapsDone += 1) {
      segment.taps?.forEach(this.io.press);
      segment.taps?.forEach(this.io.release);
    }
  }
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

function keyEvent(kind: "keydown" | "keyup", action: GameAction): void {
  const code = DEFAULT_KEYBINDINGS[action].keys[0] as string;
  window.dispatchEvent(new KeyboardEvent(kind, { code, bubbles: true }));
}

const PAGE_IO: BenchIO = {
  now: () => performance.now(),
  heap: () => (performance as PerformanceWithMemory).memory?.usedJSHeapSize,
  press: (action) => keyEvent("keydown", action),
  release: (action) => keyEvent("keyup", action),
};

export function runBench(host: BenchHost, options: BenchOptions = {}): Promise<readonly SegmentReport[]> {
  const session = new BenchSession(options.route ?? BENCH_ROUTE, options.warmupMs ?? 1500, PAGE_IO);
  return new Promise((resolve) => {
    let reported = false;
    host.onFrame(
      () => {
        const wasRunning = session.running;
        session.frameStart(host.scene.isRevealed());
        if (!wasRunning && session.running) {
          host.scene.setProfiler(session.profiler);
        }
        if (session.done && !reported) {
          reported = true;
          host.scene.setProfiler(null);
          publish(session.reports);
          resolve(session.reports);
        }
      },
      () => {
        if (options.sync === true && session.running) {
          host.gl?.finish();
        }
        session.frameEnd();
      },
    );
  });
}

function publish(reports: readonly SegmentReport[]): void {
  const text = formatReport(reports);
  console.info(`[bench]\n${text}`);
  (window as unknown as { __bench: readonly SegmentReport[] }).__bench = reports;
  const panel = document.createElement("pre");
  panel.textContent = text;
  Object.assign(panel.style, {
    position: "fixed",
    left: "8px",
    top: "8px",
    margin: "0",
    padding: "8px 10px",
    background: "rgba(0, 0, 0, 0.8)",
    color: "#e8e8e8",
    font: "12px/1.35 ui-monospace, Consolas, monospace",
    zIndex: "10",
    pointerEvents: "none",
  });
  document.body.appendChild(panel);
}
