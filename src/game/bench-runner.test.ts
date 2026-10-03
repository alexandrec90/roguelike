import { describe, expect, it } from "vitest";

import type { BenchSegment } from "./bench";
import { BenchSession, type BenchIO } from "./bench-runner";
import type { GameAction } from "./keybindings";

const ROUTE: readonly BenchSegment[] = [
  { name: "stand", ms: 100, hold: [] },
  { name: "walk", ms: 100, hold: ["north"], taps: ["cast"], tapEveryMs: 50 },
];

/** A clock, a heap and a keyboard the test moves by hand. */
function fakeIO(): BenchIO & { time: number; bytes: number | undefined; keys: string[] } {
  const io = {
    time: 0,
    bytes: 1000 as number | undefined,
    keys: [] as string[],
    now: () => io.time,
    heap: () => io.bytes,
    press: (action: GameAction) => io.keys.push(`+${action}`),
    release: (action: GameAction) => io.keys.push(`-${action}`),
  };
  return io;
}

/** One frame of `workMs`, starting at `at`. */
function frame(session: BenchSession, io: ReturnType<typeof fakeIO>, at: number, workMs = 4, revealed = true): void {
  io.time = at;
  session.frameStart(revealed);
  io.time = at + workMs;
  session.frameEnd();
}

describe("BenchSession", () => {
  it("waits for the reveal, then for the warm-up, before recording", () => {
    const io = fakeIO();
    const session = new BenchSession(ROUTE, 50, io);
    frame(session, io, 0, 4, false);
    frame(session, io, 16, 4, true);
    expect(session.running).toBe(false);
    frame(session, io, 70);
    expect(session.running).toBe(true);
  });

  it("holds each segment's keys, taps on schedule, and lets go at the end", () => {
    const io = fakeIO();
    const session = new BenchSession(ROUTE, 0, io);
    for (let at = 0; at <= 220; at += 20) {
      frame(session, io, at);
    }
    expect(session.done).toBe(true);
    // The walk starts at 100 and taps at 100 and 150, each a press and a release.
    expect(io.keys).toEqual(["+north", "+cast", "-cast", "+cast", "-cast", "-north"]);
  });

  it("reports each segment's frame work, intervals and heap growth", () => {
    const io = fakeIO();
    const session = new BenchSession(ROUTE, 0, io);
    for (let at = 0; at <= 220; at += 20) {
      io.bytes = (io.bytes ?? 0) + 500;
      frame(session, io, at, 5);
    }
    expect(session.reports.map((report) => report.name)).toEqual(["stand", "walk"]);
    const stand = session.reports[0];
    expect(stand?.work.p50).toBe(5);
    expect(stand?.interval.max).toBe(20);
    expect(stand?.hitches).toBe(0);
    // 500 bytes a frame over five frames in 0.1 s: tiny, but counted.
    expect(stand?.allocMBps).toBe(0);
  });

  it("leaves allocation unknown where the browser gives no heap reading", () => {
    const io = fakeIO();
    io.bytes = undefined;
    const session = new BenchSession(ROUTE, 0, io);
    for (let at = 0; at <= 220; at += 20) {
      frame(session, io, at);
    }
    expect(session.reports.every((report) => report.allocMBps === undefined)).toBe(true);
  });

  it("charges the scene's laps to the segment they ran in", () => {
    const io = fakeIO();
    const session = new BenchSession(ROUTE, 0, io);
    io.time = 0;
    session.frameStart(true);
    session.profiler.begin();
    io.time = 3;
    session.profiler.lap("hero");
    session.frameEnd();
    for (let at = 20; at <= 220; at += 20) {
      frame(session, io, at);
    }
    expect(session.reports[0]?.layers.hero?.max).toBe(3);
    expect(session.reports[1]?.layers.hero).toBeUndefined();
  });
});
