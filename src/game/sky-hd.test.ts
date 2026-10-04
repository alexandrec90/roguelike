import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import { horizonLayout } from "./horizon";
import { bearingOffset, PANORAMA_WIDTH, wrapPanorama } from "./panorama";
import { CLOUD_DECKS, cloudTones, deckClouds, paintCloudDecks, type CloudDeck } from "./sky-clouds";
import {
  CLOUD_TEXELS,
  MAX_CLOUD_PUFFS,
  MAX_SKY_CLOUDS,
  panoramaOffset,
  skyDisc,
  skyDrift,
  skyUniforms,
  unitRgb,
  writeCloudTexels,
  type CloudView,
} from "./sky-hd";

const LAYOUT = horizonLayout(180);
const FLOATS = CLOUD_TEXELS * 4;

function view(overrides: Partial<CloudView> = {}): CloudView {
  return { offset: 0, drift: 0, overcast: 0, width: 320, skyHeight: LAYOUT.skyHeight, ...overrides };
}

interface Row {
  readonly x: number;
  readonly base: number;
  readonly alpha: number;
  readonly puffs: number;
  readonly halfWidth: number;
  readonly height: number;
}

function rows(settings: CloudView, decks: readonly CloudDeck[] = CLOUD_DECKS): Row[] {
  const out = new Float32Array(FLOATS * MAX_SKY_CLOUDS);
  const count = writeCloudTexels(out, settings, decks);
  return Array.from({ length: count }, (_unused, row) => {
    const at = row * FLOATS;
    const f = (index: number): number => out[at + index] as number;
    return { x: f(0), base: f(1), alpha: f(2), puffs: f(3), halfWidth: f(4), height: f(5) };
  });
}

describe("the clouds the sky shader is handed", () => {
  it("holds every cloud the pixel sky would draw, inside the box the shader tests first", () => {
    // Every pixel the pixel sky paints must fall in some row's reject box, or
    // the shader would cull a cloud the pixel sky shows.
    for (const overcast of [0, 0.5, 1]) {
      for (const offset of [0, 333, 1279]) {
        const written = rows(view({ offset, overcast }));
        const tones = cloudTones(atmosphereAt(13, overcast));
        paintCloudDecks(
          { width: 320, skyHeight: LAYOUT.skyHeight, offset, drift: 0, overcast, sunSide: 1, tones },
          (x, y) => {
            const covered = written.some((row) => {
              const up = row.base + 1 - (y + 0.5);
              return Math.abs(x + 0.5 - row.x) <= row.halfWidth + 2 && up >= -1 && up <= row.height + 2;
            });
            expect(covered, `pixel ${x},${y} at offset ${offset}, overcast ${overcast}`).toBe(true);
          },
        );
      }
    }
  });

  it("never needs more rows than it has, even under a closed sky", () => {
    for (let offset = 0; offset < PANORAMA_WIDTH; offset += 37) {
      const out = new Float32Array(FLOATS * MAX_SKY_CLOUDS);
      expect(writeCloudTexels(out, view({ offset, overcast: 1 }))).toBeLessThan(MAX_SKY_CLOUDS);
    }
  });

  it("has room for every puff a cloud is built from", () => {
    for (const deck of CLOUD_DECKS) {
      for (const cloud of deckClouds(deck, 1)) {
        expect(cloud.puffs.length).toBeLessThanOrEqual(MAX_CLOUD_PUFFS);
      }
    }
  });

  it("writes only clouds on screen", () => {
    for (const row of rows(view({ offset: 500, overcast: 0.6 }))) {
      expect(row.x + row.halfWidth + 2).toBeGreaterThanOrEqual(0);
      expect(row.x - row.halfWidth - 2).toBeLessThan(320);
    }
  });

  it("slides by the exact bearing, not by whole pixels", () => {
    const whole = rows(view({ offset: 200 }));
    const half = rows(view({ offset: 200.5 }));
    expect(half.length).toBe(whole.length);
    half.forEach((row, index) => expect(row.x).toBeCloseTo((whole[index] as Row).x - 0.5, 5));
  });

  it("drifts each deck by its own share, the high deck slower", () => {
    for (const deck of CLOUD_DECKS) {
      const moved = rows(view({ offset: 100, drift: 10, overcast: 0.5 }), [deck]).map((row) => row.x);
      // Clouds well inside the screen stay on it, so each reappears shifted by the deck's share.
      const inside = rows(view({ offset: 100, overcast: 0.5 }), [deck]).filter((row) => row.x > 40 && row.x < 280);
      expect(inside.length).toBeGreaterThan(0);
      for (const row of inside) {
        expect(moved.some((x) => Math.abs(x - (row.x - 10 * deck.drift)) < 1e-4)).toBe(true);
      }
    }
    expect((CLOUD_DECKS[0] as CloudDeck).drift).toBeLessThan((CLOUD_DECKS[1] as CloudDeck).drift);
  });

  it("lays the far deck first, sheer, then the low deck opaque", () => {
    const written = rows(view({ overcast: 0.5 }));
    const firstLow = written.findIndex((row) => row.alpha === 1);
    expect(firstLow).toBeGreaterThan(0);
    expect(written.slice(firstLow).every((row) => row.alpha === 1)).toBe(true);
    expect(written.slice(0, firstLow).every((row) => row.alpha < 1)).toBe(true);
  });

  it("shows a cloud just past the panorama's seam at a small negative x", () => {
    const low = CLOUD_DECKS[CLOUD_DECKS.length - 1] as CloudDeck;
    const cloud = deckClouds(low, 0.5)[0];
    expect(cloud).toBeDefined();
    const offset = wrapPanorama((cloud?.x ?? 0) + 5);
    const xs = rows(view({ offset, overcast: 0.5 }), [low]).map((row) => row.x);
    expect(xs.some((x) => Math.abs(x + 5) < 1e-6)).toBe(true);
  });
});

describe("where the sky is looking", () => {
  it("is the bearing the pixel sky rounds, unrounded", () => {
    for (const turn of [0, 0.3, 2, -1.2, 9]) {
      expect(wrapPanorama(Math.round(panoramaOffset(turn)))).toBe(bearingOffset(turn));
      expect(panoramaOffset(turn)).toBeGreaterThanOrEqual(0);
      expect(panoramaOffset(turn)).toBeLessThan(PANORAMA_WIDTH);
    }
  });

  it("drifts continuously with the clock", () => {
    expect(skyDrift(0)).toBe(0);
    expect(skyDrift(1500)).toBeCloseTo(skyDrift(1000) * 1.5, 9);
  });
});

describe("the sun and the moon", () => {
  it("stand where the pixel sky puts them, before rounding", () => {
    for (const hours of [6.5, 9, 13, 17, 22]) {
      const atmosphere = atmosphereAt(hours);
      const disc = skyDisc(atmosphere, LAYOUT, 320);
      expect(Math.round(disc.x)).toBe(Math.round(160 + atmosphere.light.x * 320 * 0.42));
      expect(disc.y).toBeLessThan(LAYOUT.horizonY);
    }
  });

  it("is the sun by day and a smaller moon by night, veiled by cloud", () => {
    expect(skyDisc(atmosphereAt(13), LAYOUT, 320)).toMatchObject({ day: true, radius: 3, veil: 1 });
    const night = skyDisc(atmosphereAt(1, 1), LAYOUT, 320);
    expect(night.day).toBe(false);
    expect(night.radius).toBeLessThan(3);
    expect(night.veil).toBeCloseTo(0.2, 9);
  });
});

describe("the sky's colours", () => {
  it("are the atmosphere's own: the backdrop sits behind the lighting pass, not under it", () => {
    const night = atmosphereAt(1);
    const uniforms = skyUniforms(night, LAYOUT, 320, { offset: 0, elapsedMs: 0 });
    expect(uniforms.u_skyTop).toEqual(unitRgb(night.skyTop));
    expect(uniforms.u_skyHorizon).toEqual(unitRgb(night.skyHorizon));
    // ...with the ambient to clamp to, as the lighting pass clamps the pixel sky.
    expect(uniforms.u_ambient).toEqual(unitRgb(night.ambient));
  });

  it("carry the band, the bearing and the clock", () => {
    const uniforms = skyUniforms(atmosphereAt(13), LAYOUT, 320, { offset: 42.5, elapsedMs: 3000 });
    expect(uniforms.u_band).toEqual([LAYOUT.skyHeight, LAYOUT.horizonY, 42.5, 3]);
  });

  it("reads 0..1 channels", () => {
    expect(unitRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
  });
});
