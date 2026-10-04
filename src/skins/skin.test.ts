import { describe, expect, it } from "vitest";

import { DEFAULT_SKIN, nextSkin, parseSkin, SKINS, skinHref } from "./skin";

describe("choosing a skin", () => {
  it("reads every registered skin, ignoring case and space", () => {
    for (const skin of SKINS) {
      expect(parseSkin(` ${skin.id.toUpperCase()} `)).toBe(skin.id);
    }
  });

  it("opens on the low-poly skin, and the default leads the switch order", () => {
    expect(DEFAULT_SKIN).toBe("lowpoly");
    expect(SKINS[0]?.id).toBe(DEFAULT_SKIN);
  });

  it("falls back to the default for nothing or a typo, rather than blanking the page", () => {
    expect(parseSkin(null)).toBe(DEFAULT_SKIN);
    expect(parseSkin("")).toBe(DEFAULT_SKIN);
    expect(parseSkin("voxel")).toBe(DEFAULT_SKIN);
  });

  it("steps through every skin and wraps round", () => {
    const seen = new Set<string>();
    let skin = DEFAULT_SKIN;
    for (let step = 0; step < SKINS.length; step += 1) {
      seen.add(skin);
      skin = nextSkin(skin);
    }
    expect(skin).toBe(DEFAULT_SKIN);
    expect(seen.size).toBe(SKINS.length);
  });

  it("switches skin and keeps every other knob in the address", () => {
    const href = skinHref("http://localhost:4100/?time=21&weather=storm&skin=pixel", "lowpoly");
    const query = new URL(href).searchParams;
    expect(query.get("skin")).toBe("lowpoly");
    expect(query.get("time")).toBe("21");
    expect(query.get("weather")).toBe("storm");
  });
});
