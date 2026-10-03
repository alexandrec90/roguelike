/**
 * The benchmark: one scripted route, timed the same way every run.
 *
 * `?bench=1` walks the hero through `BENCH_ROUTE` - standing, each gait, then a
 * fight - by pressing the same keys a player would, and times every layer of
 * every frame as it goes. The route is fixed and the clock and weather are
 * pinned by the URL, so two runs on one machine are comparable, and a change
 * that adds per-frame cost shows up as a number rather than an impression.
 *
 * This module is the pure half - the route, the per-frame laps, the statistics
 * and the report - so it is testable without a page. `bench-runner.ts` is the
 * wiring: it presses the keys and reads the clock.
 */

import type { GameAction } from "./keybindings";

/** One stretch of the route: what is held, what is tapped, for how long. */
export interface BenchSegment {
  readonly name: string;
  readonly ms: number;
  /** Actions held down for the whole segment. */
  readonly hold: readonly GameAction[];
  /** Actions tapped together every `tapEveryMs`. */
  readonly taps?: readonly GameAction[];
  readonly tapEveryMs?: number;
}

/**
 * Standing, the three gaits, then a fight while walking.
 *
 * The fight casts, freezes and swings four times a second, which is faster than
 * a player would and is the point: effects are what a new feature adds, so the
 * route asks for more of them than play does.
 */
export const BENCH_ROUTE: readonly BenchSegment[] = [
  { name: "stand", ms: 3000, hold: [] },
  { name: "north", ms: 4000, hold: ["north"] },
  { name: "strafe", ms: 4000, hold: ["east"] },
  { name: "diagonal", ms: 4000, hold: ["north", "west"] },
  { name: "fight", ms: 5000, hold: ["north"], taps: ["cast", "frost", "attack"], tapEveryMs: 250 },
];

/** Where in the route `elapsedMs` falls, or undefined once it is over. */
export function segmentAt(
  route: readonly BenchSegment[],
  elapsedMs: number,
): { readonly index: number; readonly intoMs: number } | undefined {
  let start = 0;
  for (let index = 0; index < route.length; index += 1) {
    const segment = route[index] as BenchSegment;
    if (elapsedMs < start + segment.ms) {
      return { index, intoMs: Math.max(0, elapsedMs - start) };
    }
    start += segment.ms;
  }
  return undefined;
}

/** How many taps a segment has fired by `intoMs` - the first lands at 0. */
export function tapsBy(segment: BenchSegment, intoMs: number): number {
  if (segment.taps === undefined || segment.taps.length === 0 || segment.tapEveryMs === undefined) {
    return 0;
  }
  return Math.floor(intoMs / segment.tapEveryMs) + 1;
}

/**
 * Laps within one frame: call `lap(label)` after each piece of work and the
 * time since the previous lap is charged to that label.
 *
 * Cheap enough to leave wired in: with no profiler attached the scene skips it
 * entirely, and with one it is a clock read and an array push per layer.
 */
export class FrameProfiler {
  private readonly laps = new Map<string, number[]>();
  private last = 0;

  constructor(private readonly now: () => number) {}

  begin(): void {
    this.last = this.now();
  }

  lap(label: string): void {
    const time = this.now();
    let list = this.laps.get(label);
    if (list === undefined) {
      list = [];
      this.laps.set(label, list);
    }
    list.push(time - this.last);
    this.last = time;
  }

  /** Every label's laps so far, in the order the labels were first seen. */
  samples(): ReadonlyMap<string, readonly number[]> {
    return this.laps;
  }

  reset(): void {
    this.laps.clear();
  }
}

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** Nearest-rank percentile of an ascending list; `p` in 0..1. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] as number;
}

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    n: sorted.length,
    mean: round(sorted.length === 0 ? 0 : total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** A frame interval this long is a visible hitch at any refresh rate. */
export const HITCH_MS = 33;

export interface SegmentReport {
  readonly name: string;
  /** Time the frame's own work took: update plus render, CPU side. */
  readonly work: Summary;
  /** Time between frames as the browser delivered them. */
  readonly interval: Summary;
  readonly hitches: number;
  readonly layers: Readonly<Record<string, Summary>>;
  /** JS heap growth per second while the segment ran, MB - garbage made. */
  readonly allocMBps: number | undefined;
}

export interface SegmentSamples {
  readonly name: string;
  readonly work: readonly number[];
  readonly interval: readonly number[];
  readonly layers: ReadonlyMap<string, readonly number[]>;
  /** Bytes the heap grew by, summed over frames where it grew, or undefined without `performance.memory`. */
  readonly heapGrowth: number | undefined;
  readonly durationMs: number;
}

export function reportSegment(samples: SegmentSamples): SegmentReport {
  const layers: Record<string, Summary> = {};
  for (const [label, values] of samples.layers) {
    layers[label] = summarize(values);
  }
  return {
    name: samples.name,
    work: summarize(samples.work),
    interval: summarize(samples.interval),
    hitches: samples.interval.filter((value) => value > HITCH_MS).length,
    layers,
    allocMBps:
      samples.heapGrowth === undefined || samples.durationMs <= 0
        ? undefined
        : Math.round(samples.heapGrowth / 1e6 / (samples.durationMs / 1000)),
  };
}

/** The report as fixed-width text: one row per segment, then the layers of the heaviest. */
export function formatReport(reports: readonly SegmentReport[]): string {
  const lines = ["segment    work p50/p95/max ms   hitches   alloc MB/s"];
  for (const report of reports) {
    const work = `${report.work.p50.toFixed(1)}/${report.work.p95.toFixed(1)}/${report.work.max.toFixed(1)}`;
    const alloc = report.allocMBps === undefined ? "-" : String(report.allocMBps);
    lines.push(`${report.name.padEnd(10)} ${work.padEnd(21)} ${String(report.hitches).padEnd(9)} ${alloc}`);
  }
  const heaviest = [...reports].sort((a, b) => b.work.mean - a.work.mean)[0];
  if (heaviest !== undefined) {
    lines.push("", `layers in '${heaviest.name}' (mean / p95 / max ms)`);
    const rows = Object.entries(heaviest.layers).sort((a, b) => b[1].mean - a[1].mean);
    for (const [label, summary] of rows) {
      lines.push(
        `  ${label.padEnd(12)} ${summary.mean.toFixed(2).padStart(6)} ${summary.p95.toFixed(2).padStart(6)} ${summary.max
          .toFixed(1)
          .padStart(6)}`,
      );
    }
  }
  return lines.join("\n");
}
