import { describe, expect, it } from "vitest";

import { wrapDelta } from "../../game/planet";
import { PLUME_PUFFS, volcanoVents } from "../../game/volcanoes";
import { BALL_VERTICES, IMPOSTOR_BYTES, ImpostorBuilder } from "./impostor";
import { Kind } from "./mesh";
import { plumeBalls } from "./plume-balls";

const rows = { behind: 3, ahead: 10 };
const vent = volcanoVents()[0]!;

interface Ball {
  readonly centre: readonly [number, number, number];
  readonly foot: readonly [number, number];
  readonly kind: number;
}

function balls(b: ImpostorBuilder): Ball[] {
  const bytes = b.bytesView();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: b.balls }, (_, i) => {
    const at = i * BALL_VERTICES * IMPOSTOR_BYTES;
    const f = (k: number): number => data.getFloat32(at + k * 4, true);
    return { centre: [f(0), f(1), f(2)], foot: [f(3), f(4)], kind: data.getUint8(at + 28) };
  });
}

/** Standing `d` tiles south of the vent, facing it. */
function facing(d: number): { x: number; y: number } {
  return { x: vent.x, y: vent.y - d };
}

describe("plumeBalls", () => {
  it("lays a whole plume, anchored at its vent, for a volcano ahead", () => {
    const b = new ImpostorBuilder();
    const count = plumeBalls(b, facing(40), 0, 50_000, 1, rows);
    const made = balls(b).filter((ball) => Math.abs(ball.foot[1] - 40) < 1e-3 && Math.abs(ball.foot[0]) < 1e-3);
    expect(count).toBe(b.balls);
    expect(made.length).toBeGreaterThanOrEqual(PLUME_PUFFS - 1);
    expect(made.every((ball) => ball.kind === Kind.smoke && ball.centre[2] >= vent.z)).toBe(true);
  });

  it("lays nothing for a volcano behind him", () => {
    const b = new ImpostorBuilder();
    plumeBalls(b, facing(40), Math.PI, 50_000, 1, rows);
    const behind = balls(b).filter((ball) => Math.abs(ball.foot[1] - 40) < 1e-3 && Math.abs(ball.foot[0]) < 1e-3);
    expect(behind).toEqual([]);
  });

  it("orders every puff far to near, so a volume pass blends them in order", () => {
    const b = new ImpostorBuilder();
    const hero = facing(30);
    plumeBalls(b, hero, 0.3, 77_000, 1.4, rows);
    const ahead = balls(b).map((ball) => ball.centre[0] * Math.sin(0.3) + ball.centre[1] * Math.cos(0.3));
    for (let i = 1; i < ahead.length; i += 1) {
      expect(ahead[i]!).toBeLessThanOrEqual(ahead[i - 1]! + 1e-4);
    }
  });

  it("measures the planet from the hero round the wrap", () => {
    const b = new ImpostorBuilder();
    const hero = { x: vent.x, y: vent.y - 40 + 256 };
    plumeBalls(b, hero, 0, 1000, 1, rows);
    expect(balls(b).some((ball) => Math.abs(ball.foot[1] - wrapDelta(vent.y, hero.y)) < 1e-3)).toBe(true);
  });
});
