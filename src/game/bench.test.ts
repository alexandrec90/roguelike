import { describe, expect, it } from "vitest";

import {
  BENCH_ROUTE,
  FrameProfiler,
  HITCH_MS,
  formatReport,
  percentile,
  reportSegment,
  segmentAt,
  summarize,
  tapsBy,
  type BenchSegment,
} from "./bench";
import { DEFAULT_KEYBINDINGS } from "./keybindings";

const ROUTE: readonly BenchSegment[] = [
  { name: "a", ms: 100, hold: [] },
  { name: "b", ms: 200, hold: ["north"], taps: ["cast"], tapEveryMs: 50 },
];

describe("segmentAt", () => {
  it("finds the segment and how far into it", () => {
    expect(segmentAt(ROUTE, 0)).toEqual({ index: 0, intoMs: 0 });
    expect(segmentAt(ROUTE, 99)).toEqual({ index: 0, intoMs: 99 });
    expect(segmentAt(ROUTE, 100)).toEqual({ index: 1, intoMs: 0 });
    expect(segmentAt(ROUTE, 299)).toEqual({ index: 1, intoMs: 199 });
  });

  it("is undefined once the route is over, and for an empty route", () => {
    expect(segmentAt(ROUTE, 300)).toBeUndefined();
    expect(segmentAt([], 0)).toBeUndefined();
  });
});

describe("tapsBy", () => {
  it("fires the first tap at the start, then one per interval", () => {
    const segment = ROUTE[1] as BenchSegment;
    expect(tapsBy(segment, 0)).toBe(1);
    expect(tapsBy(segment, 49)).toBe(1);
    expect(tapsBy(segment, 50)).toBe(2);
    expect(tapsBy(segment, 199)).toBe(4);
  });

  it("is zero for a segment without taps", () => {
    expect(tapsBy(ROUTE[0] as BenchSegment, 500)).toBe(0);
  });
});

describe("BENCH_ROUTE", () => {
  it("only names bound actions, so every press reaches a key", () => {
    for (const segment of BENCH_ROUTE) {
      for (const action of [...segment.hold, ...(segment.taps ?? [])]) {
        expect(DEFAULT_KEYBINDINGS[action].keys.length).toBeGreaterThan(0);
      }
    }
  });

  it("has unique segment names and a tap interval wherever it taps", () => {
    const names = BENCH_ROUTE.map((segment) => segment.name);
    expect(new Set(names).size).toBe(names.length);
    for (const segment of BENCH_ROUTE) {
      if (segment.taps !== undefined) {
        expect(segment.tapEveryMs).toBeGreaterThan(0);
      }
    }
  });
});

describe("FrameProfiler", () => {
  it("charges each lap the time since the previous one", () => {
    let clock = 0;
    const profiler = new FrameProfiler(() => clock);
    profiler.begin();
    clock = 2;
    profiler.lap("ground");
    clock = 5;
    profiler.lap("hero");
    profiler.begin();
    clock = 6;
    profiler.lap("ground");
    expect([...profiler.samples()]).toEqual([
      ["ground", [2, 1]],
      ["hero", [3]],
    ]);
    profiler.reset();
    expect(profiler.samples().size).toBe(0);
  });
});

describe("summarize", () => {
  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile(values, 0)).toBe(1);
  });

  it("sorts its input and rounds to hundredths", () => {
    expect(summarize([3, 1, 2.005])).toEqual({ n: 3, mean: 2, p50: 2.01, p95: 3, p99: 3, max: 3 });
  });

  it("is all zeros for no samples rather than NaN", () => {
    expect(summarize([])).toEqual({ n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("reportSegment", () => {
  it("counts hitches and turns heap growth into MB per second", () => {
    const report = reportSegment({
      name: "fight",
      work: [4, 5, 6],
      interval: [16, HITCH_MS + 1, 16],
      layers: new Map([["spells", [1, 2]]]),
      heapGrowth: 20e6,
      durationMs: 2000,
    });
    expect(report.hitches).toBe(1);
    expect(report.allocMBps).toBe(10);
    expect(report.layers.spells?.max).toBe(2);
  });

  it("leaves allocation unknown without a heap reading", () => {
    const report = reportSegment({
      name: "stand",
      work: [1],
      interval: [16],
      layers: new Map(),
      heapGrowth: undefined,
      durationMs: 1000,
    });
    expect(report.allocMBps).toBeUndefined();
  });
});

describe("formatReport", () => {
  it("lists every segment and the layers of the heaviest", () => {
    const light = reportSegment({
      name: "stand",
      work: [1],
      interval: [16],
      layers: new Map([["sky", [0.1]]]),
      heapGrowth: undefined,
      durationMs: 1000,
    });
    const heavy = reportSegment({
      name: "fight",
      work: [9],
      interval: [40],
      layers: new Map([
        ["spells", [3]],
        ["hero", [1]],
      ]),
      heapGrowth: 5e6,
      durationMs: 1000,
    });
    const text = formatReport([light, heavy]);
    expect(text).toContain("stand");
    expect(text).toContain("layers in 'fight'");
    expect(text.indexOf("spells")).toBeLessThan(text.indexOf("hero"));
    expect(text).not.toContain("sky");
  });
});
