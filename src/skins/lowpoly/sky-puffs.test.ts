import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../../game/atmosphere";
import { DEFAULT_SKY_FRACTION } from "../../game/horizon";
import { PANORAMA_WIDTH } from "../../game/panorama";
import { CLOUD_DECKS, FLATTEN } from "../../game/sky-clouds";
import { IMPOSTOR_BYTES, ImpostorBuilder, BALL_VERTICES } from "./impostor";
import { Kind } from "./mesh";
import { lowpolyView } from "./placement";
import { cloudShadeOf, skyPuffs } from "./sky-puffs";

const view = lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, 20);

interface Puff {
  readonly x: number;
  readonly y: number;
  readonly base: number;
  readonly rx: number;
  readonly ry: number;
  readonly kind: number;
}

function puffs(turn: number, elapsedMs: number, overcast = 0): Puff[] {
  const b = new ImpostorBuilder();
  skyPuffs(b, view, { ...atmosphereAt(13), overcast }, turn, elapsedMs);
  const bytes = b.bytesView();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: b.balls }, (_, i) => {
    const at = i * BALL_VERTICES * IMPOSTOR_BYTES;
    const f = (k: number): number => data.getFloat32(at + k * 4, true);
    return { x: f(0), y: f(1), base: f(2), rx: f(3), ry: f(4), kind: data.getUint8(at + 28) };
  });
}

describe("skyPuffs", () => {
  it("lays cloud puffs in the sky band, every one a cloud kind cut flat below its centre", () => {
    const made = puffs(0, 0);
    expect(made.length).toBeGreaterThan(0);
    for (const puff of made) {
      expect(puff.kind).toBe(Kind.cloud);
      expect(puff.base).toBeGreaterThanOrEqual(puff.y);
      expect(puff.base).toBeLessThanOrEqual(view.layout.skyHeight + 1);
      expect(puff.ry / puff.rx).toBeCloseTo(FLATTEN, 6);
    }
  });

  it("only lays what can be on screen", () => {
    for (const puff of puffs(1.3, 4000)) {
      expect(puff.x + puff.rx * 3).toBeGreaterThan(-60);
      expect(puff.x - puff.rx * 3).toBeLessThan(view.width + 60);
    }
  });

  it("turns with the panorama: a full turn comes back to the same sky", () => {
    const xs = (turn: number): number[] => puffs(turn, 0).map((p) => Math.round(p.x * 100)).sort((a, b) => a - b);
    expect(xs(Math.PI * 2)).toEqual(xs(0));
    expect(xs(0.4)).not.toEqual(xs(0));
  });

  it("drifts with time, and only with time: the same moment is the same sky", () => {
    expect(puffs(0, 60_000).map((p) => p.x)).not.toEqual(puffs(0, 0).map((p) => p.x));
    expect(puffs(0.2, 12_345)).toEqual(puffs(0.2, 12_345));
  });

  it("draws every deck it is given and no other", () => {
    const b = new ImpostorBuilder();
    skyPuffs(b, view, atmosphereAt(13), 0, 0, []);
    expect(b.balls).toBe(0);
    skyPuffs(b, view, atmosphereAt(13), 0, 0, CLOUD_DECKS.slice(1));
    expect(b.balls).toBeGreaterThan(0);
    // A deck's slots go all the way round: some cloud is on screen at some bearing of a full turn.
    expect(PANORAMA_WIDTH).toBeGreaterThan(view.width);
  });

  it("swells the sky with cloud as it clouds over", () => {
    const area = (overcast: number): number => puffs(0, 0, overcast).reduce((sum, p) => sum + p.rx * p.ry, 0);
    expect(area(1)).toBeGreaterThan(area(0) * 1.5);
  });
});

describe("cloudShadeOf", () => {
  it("is the shared shade tone in 0..1, greyer under overcast", () => {
    const clear = cloudShadeOf({ ...atmosphereAt(13), overcast: 0 });
    const grey = cloudShadeOf({ ...atmosphereAt(13), overcast: 1 });
    for (const channel of [...clear, ...grey]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    expect(grey).not.toEqual(clear);
  });
});
