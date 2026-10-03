import { describe, expect, it } from "vitest";

import { captureNow, type CaptureTarget } from "./lab-capture";

function fakeGame(isBooted: boolean): { game: CaptureTarget; calls: string[] } {
  const calls: string[] = [];
  let drawn = 0;
  const game: CaptureTarget = {
    isBooted,
    canvas: {
      toDataURL: (type: string) => {
        calls.push(`read ${type}`);
        return `frame-${drawn}`;
      },
    },
    step: (time: number, delta: number) => {
      calls.push(`step ${time} ${delta}`);
      drawn += 1;
    },
  };
  return { game, calls };
}

describe("captureNow", () => {
  it("draws before it reads, so a frozen loop cannot hand back a stale frame", () => {
    // A hidden tab never runs `game.loop`: every capture read the same pixels.
    const { game, calls } = fakeGame(true);
    expect(captureNow(game, () => 42)).toBe("frame-1");
    expect(captureNow(game, () => 43)).toBe("frame-2");
    expect(calls).toEqual(["step 42 0", "read image/png", "step 43 0", "read image/png"]);
  });

  it("never advances time, so a paused view stays where `apply` put it", () => {
    const { game, calls } = fakeGame(true);
    captureNow(game, () => 1);
    expect(calls[0]).toMatch(/ 0$/);
  });

  it("reads without stepping before the game has booted", () => {
    const { game, calls } = fakeGame(false);
    expect(captureNow(game)).toBe("frame-0");
    expect(calls).toEqual(["read image/png"]);
  });
});
