import { describe, expect, it } from "vitest";

import {
  createDecal,
  createDecalField,
  DECAL_CAP,
  DECAL_LIFE,
  decalCloud,
  EMBER_GLOW_MS,
  pruneDecals,
  stampDecal,
  type DecalKind,
} from "./decals";

const KINDS: readonly DecalKind[] = ["scorch", "goo", "frost"];
const AT = { x: 3, y: 4 };

describe("shapes", () => {
  it.each(KINDS)("builds a %s mark that lies flat and is seeded", (kind) => {
    const decal = createDecal(AT, kind, 5, 0);
    const cloud = decalCloud(decal, 0);
    expect(cloud.length).toBeGreaterThan(20);
    const width = Math.max(...cloud.map((p) => p.x)) - Math.min(...cloud.map((p) => p.x));
    const height = Math.max(...cloud.map((p) => p.y)) - Math.min(...cloud.map((p) => p.y));
    expect(height).toBeLessThan(width);
    expect(createDecal(AT, kind, 5, 0).pixels).toEqual(decal.pixels);
    expect(createDecal(AT, kind, 6, 0).pixels).not.toEqual(decal.pixels);
  });

  it("inks a scorch from char and shadow, a goo from slime, a frost from frost", () => {
    const inks = (kind: DecalKind): string[] => decalCloud(createDecal(AT, kind, 5, 0), EMBER_GLOW_MS).map((p) => p.ink);
    expect(inks("scorch").some((ink) => ink === "shadow" || ink === "shadow-soft")).toBe(true);
    expect(inks("goo").every((ink) => ink.startsWith("slime-"))).toBe(true);
    expect(inks("frost").every((ink) => ink.startsWith("frost-"))).toBe(true);
  });
});

describe("ageing", () => {
  it("is whole when fresh and gone at the end of its life, eroding in between", () => {
    const decal = createDecal(AT, "scorch", 5, 1000);
    const whole = decalCloud(decal, 1000).length;
    expect(decal.pixels).toHaveLength(whole);
    const late = decalCloud(decal, 1000 + DECAL_LIFE.scorch * 0.85).length;
    expect(late).toBeLessThan(whole);
    expect(late).toBeGreaterThan(0);
    expect(decalCloud(decal, 1000 + DECAL_LIFE.scorch)).toEqual([]);
  });

  it("glows with embers only in its first seconds", () => {
    const decal = createDecal(AT, "scorch", 5, 0);
    const glowing = (ms: number): number => decalCloud(decal, ms).filter((p) => p.ink.startsWith("fire-")).length;
    expect(glowing(200)).toBeGreaterThan(0);
    expect(glowing(EMBER_GLOW_MS + 10)).toBe(0);
  });
});

describe("the field", () => {
  it("caps its marks, dropping the oldest, and counts every change", () => {
    const field = createDecalField();
    for (let index = 0; index < DECAL_CAP + 3; index += 1) {
      stampDecal(field, createDecal(AT, "goo", index, index));
    }
    expect(field.decals).toHaveLength(DECAL_CAP);
    expect(field.decals[0]?.seed).toBe(3);
    expect(field.version).toBe(DECAL_CAP + 3);
  });

  it("prunes what has faded, and only bumps the version when it did", () => {
    const field = createDecalField();
    stampDecal(field, createDecal(AT, "frost", 1, 0));
    stampDecal(field, createDecal(AT, "scorch", 1, 0));
    pruneDecals(field, 100);
    expect(field.version).toBe(2);
    pruneDecals(field, DECAL_LIFE.frost);
    expect(field.decals.map((decal) => decal.kind)).toEqual(["scorch"]);
    expect(field.version).toBe(3);
  });
});
