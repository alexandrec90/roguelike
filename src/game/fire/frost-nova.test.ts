import { describe, expect, it } from "vitest";

import {
  createFrostNova,
  frostNovaCloud,
  frostNovaDone,
  frostNovaLight,
  NOVA_MS,
  NOVA_RING_MS,
  novaRingCloud,
  stepFrostNova,
} from "./frost-nova";

function at(ms: number): ReturnType<typeof createFrostNova> {
  const nova = createFrostNova(21);
  for (let spent = 0; spent < ms; spent += 15) {
    stepFrostNova(nova, 15);
  }
  return nova;
}

describe("the frost nova", () => {
  it("rings out and is gone after its ring time", () => {
    const early = Math.max(...novaRingCloud(30).map((pixel) => pixel.x));
    const late = Math.max(...novaRingCloud(150).map((pixel) => pixel.x));
    expect(late).toBeGreaterThan(early);
    expect(novaRingCloud(NOVA_RING_MS)).toEqual([]);
  });

  it("throws its shards outward along the ring", () => {
    const nova = at(150);
    const active = nova.shards.particles.filter((particle) => particle.active);
    expect(active.length).toBeGreaterThan(10);
    const spread = active.reduce((sum, particle) => sum + Math.hypot(particle.x, particle.y), 0) / active.length;
    expect(spread).toBeGreaterThan(10);
  });

  it("inks in the frost ramp and foam only", () => {
    const cloud = frostNovaCloud(at(60));
    expect(cloud.every((pixel) => pixel.ink.startsWith("frost-") || pixel.ink === "foam")).toBe(true);
  });

  it("is deterministic, lights briefly, and ends", () => {
    expect(frostNovaCloud(at(90))).toEqual(frostNovaCloud(at(90)));
    expect(frostNovaLight(at(0), 0, 0)?.intensity ?? 0).toBeGreaterThan(1);
    expect(frostNovaLight(at(400), 0, 0)).toBeNull();
    expect(frostNovaDone(at(NOVA_MS))).toBe(true);
  });
});
