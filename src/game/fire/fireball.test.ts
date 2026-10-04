import { describe, expect, it } from "vitest";

import type { PlanetPoint, PlanetPose } from "../planet";
import {
  coreCloud,
  FIREBALL_HEIGHT,
  FIREBALL_RANGE,
  FIREBALL_SPEED,
  fireballCloud,
  fireballCore,
  fireballLight,
  fireballOffset,
  fireballPoint,
  fireballSpent,
  flyFireball,
  launchFireball,
  localToPlanetVector,
  type RollProjection,
} from "./fireball";

const POSE: PlanetPose = { x: 50, y: 50, turn: 0 };
const OPEN = (): boolean => false;

function fly(ms: number, blocked: (point: PlanetPoint) => boolean = OPEN): { ball: ReturnType<typeof launchFireball>; burst: PlanetPoint | null } {
  const ball = launchFireball({ x: 50, y: 50 }, { x: 0, y: 1 }, POSE, 7);
  let burst: PlanetPoint | null = null;
  for (let spent = 0; spent < ms; spent += 16) {
    burst = flyFireball(ball, 16, blocked) ?? burst;
  }
  return { ball, burst };
}

describe("launching", () => {
  it("refuses a zero direction", () => {
    expect(() => launchFireball({ x: 0, y: 0 }, { x: 0, y: 0 }, POSE, 1)).toThrow(/direction/);
  });

  it("turns a local heading into the planet's by the pose", () => {
    const ahead = localToPlanetVector({ x: 0, y: 0, turn: Math.PI / 2 }, { x: 0, y: 1 });
    expect(ahead.x).toBeCloseTo(1);
    expect(ahead.y).toBeCloseTo(0);
    const right = localToPlanetVector({ x: 0, y: 0, turn: 0 }, { x: 1, y: 0 });
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });
});

describe("flight", () => {
  it("covers its speed in tiles per second", () => {
    const { ball } = fly(496);
    expect(ball.travelled).toBeCloseTo((FIREBALL_SPEED * 496) / 1000, 5);
    expect(fireballPoint(ball).y).toBeCloseTo(50 + ball.travelled, 5);
  });

  it("bursts at the end of its range", () => {
    const { ball, burst } = fly(2000);
    expect(ball.flying).toBe(false);
    expect(ball.travelled).toBeCloseTo(FIREBALL_RANGE, 5);
    expect(burst?.y).toBeCloseTo(50 + FIREBALL_RANGE, 5);
  });

  it("bursts on the first probe that is blocked, not beyond it", () => {
    const { ball, burst } = fly(2000, (point) => point.y >= 53);
    expect(burst).not.toBeNull();
    expect(burst?.y ?? 0).toBeGreaterThanOrEqual(53);
    expect(burst?.y ?? 99).toBeLessThan(53.25);
    expect(ball.travelled).toBeLessThan(3.25);
  });

  it("draws a lit core and a shadow while flying, and carries a light", () => {
    const { ball } = fly(200);
    const cloud = fireballCloud(ball);
    expect(cloud.some((pixel) => pixel.ink === "shadow" || pixel.ink === "shadow-soft")).toBe(true);
    expect(cloud.some((pixel) => pixel.ink === "fire-6" || pixel.ink === "fire-5")).toBe(true);
    const at = fireballOffset(ball);
    expect(at.y).toBeLessThan(0);
    expect(fireballLight(ball, 10, 10)?.radius).toBeGreaterThan(0);
  });

  it("stops lighting when it bursts, and is spent once its trail burns out", () => {
    const burst = fly(1250);
    expect(burst.burst).not.toBeNull();
    expect(fireballLight(burst.ball, 0, 0)).toBeNull();
    expect(fireballSpent(burst.ball)).toBe(false);
    const { ball } = fly(4000);
    expect(fireballSpent(ball)).toBe(true);
  });

  it("is deterministic", () => {
    expect(fireballCloud(fly(300).ball)).toEqual(fireballCloud(fly(300).ball));
  });
});

describe("rolling over the horizon", () => {
  it("draws exactly the flat picture when the projection leaves every pixel alone", () => {
    const { ball } = fly(300);
    const flat: RollProjection = (x, groundY, height) => ({ x, y: groundY - height, scale: 1 });
    expect(fireballCloud(ball, flat)).toEqual(fireballCloud(ball));
  });

  it("hands the core's ground and height to the projection, and redraws the core at its scale", () => {
    const { ball } = fly(300);
    const at = fireballOffset(ball);
    const seen: Array<[number, number, number]> = [];
    const shrink: RollProjection = (x, groundY, height) => {
      seen.push([x, groundY, height]);
      return { x: Math.round(x / 2), y: Math.round((groundY - height) / 2), scale: 0.5 };
    };
    const core = fireballCore(ball, shrink);
    expect(seen[0]).toEqual([at.x, at.y + FIREBALL_HEIGHT, FIREBALL_HEIGHT]);
    expect(core?.scale).toBe(0.5);

    const full = fireballCloud(ball).filter((pixel) => pixel.ink.startsWith("fire"));
    const small = fireballCloud(ball, shrink).filter((pixel) => pixel.ink.startsWith("fire"));
    expect(small.length).toBeLessThan(full.length);
  });

  it("drops every pixel the projection hides", () => {
    expect(fireballCloud(fly(300).ball, () => null)).toEqual([]);
    expect(fireballCore(fly(300).ball, () => null)).toBeNull();
  });

  it("shrinks its light with it", () => {
    const { ball } = fly(200);
    expect(fireballLight(ball, 0, 0, 0.5)?.radius).toBeCloseTo((fireballLight(ball, 0, 0)?.radius ?? 0) / 2);
  });
});

describe("the core", () => {
  it("shrinks the sphere, not the picture, and always keeps its centre", () => {
    const full = coreCloud(0, 3);
    for (const scale of [0.6, 0.3, 0.05]) {
      const small = coreCloud(0, 3, 0, 0, scale);
      expect(small.length).toBeLessThan(full.length);
      expect(small.some((pixel) => pixel.x === 0 && pixel.y === 0)).toBe(true);
      expect(small.every((pixel) => Math.hypot(pixel.x, pixel.y) <= 5 * scale + 1)).toBe(true);
    }
    expect(coreCloud(0, 3, 0, 0, 1)).toEqual(full);
  });

  it("is a small disc, hottest near the middle", () => {
    const core = coreCloud(0, 3);
    expect(core.length).toBeGreaterThan(20);
    expect(core.every((pixel) => Math.hypot(pixel.x, pixel.y) <= 5)).toBe(true);
    const centre = core.find((pixel) => pixel.x === 0 && pixel.y === 0);
    expect(centre?.ink === "fire-6" || centre?.ink === "fire-5").toBe(true);
  });
});
