import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import {
  blobCloud,
  createExplosion,
  EXPLOSION_MS,
  explosionCloud,
  explosionDone,
  explosionLight,
  SHOCK_MS,
  SHOCK_RADIUS,
  shockwaveCloud,
  stepExplosion,
} from "./explosion";

function at(ms: number, seed = 11): ReturnType<typeof createExplosion> {
  const explosion = createExplosion(seed);
  for (let spent = 0; spent < ms; spent += 15) {
    stepExplosion(explosion, Math.min(15, ms - spent), 0.3);
  }
  return explosion;
}

describe("the shockwave", () => {
  it("races outward, stays within its reach, and is gone at its end", () => {
    const early = cloudBounds(shockwaveCloud(30));
    const late = cloudBounds(shockwaveCloud(150));
    expect((late?.right ?? 0) - (early?.right ?? 0)).toBeGreaterThan(5);
    expect(late?.right ?? 99).toBeLessThanOrEqual(SHOCK_RADIUS);
    expect(shockwaveCloud(SHOCK_MS)).toEqual([]);
  });

  it("lies on the ground: squatter than it is wide", () => {
    const bounds = cloudBounds(shockwaveCloud(120));
    expect((bounds?.bottom ?? 0) - (bounds?.top ?? 0)).toBeLessThan((bounds?.right ?? 0) - (bounds?.left ?? 0));
  });
});

describe("the blast", () => {
  it("starts white-hot and cools into smoke", () => {
    expect(explosionCloud(at(0)).some((pixel) => pixel.ink === "foam")).toBe(true);
    const hot = blobCloud(40, 11).filter((pixel) => pixel.ink.startsWith("fire-")).length;
    const cool = blobCloud(320, 11).filter((pixel) => pixel.ink.startsWith("fire-")).length;
    expect(hot).toBeGreaterThan(cool);
    expect(blobCloud(400, 11)).toEqual([]);
  });

  it("is deterministic for a seed", () => {
    expect(explosionCloud(at(240))).toEqual(explosionCloud(at(240)));
    expect(explosionCloud(at(240, 12))).not.toEqual(explosionCloud(at(240)));
  });

  it("throws debris that lands rather than falling through the ground", () => {
    const explosion = at(800);
    for (const particle of explosion.debris.particles) {
      if (particle.active) {
        expect(particle.y).toBeLessThanOrEqual(4);
      }
    }
  });

  it("flashes a light that dies away, and ends", () => {
    const first = explosionLight(at(0), 0, 0);
    const later = explosionLight(at(300), 0, 0);
    expect(first?.intensity ?? 0).toBeGreaterThan(later?.intensity ?? 0);
    expect(explosionLight(at(600), 0, 0)).toBeNull();
    expect(explosionDone(at(EXPLOSION_MS - 30))).toBe(false);
    expect(explosionDone(at(EXPLOSION_MS))).toBe(true);
  });

  it("clamps a long step", () => {
    const explosion = createExplosion(1);
    stepExplosion(explosion, 10_000);
    expect(explosion.ageMs).toBe(50);
  });
});
