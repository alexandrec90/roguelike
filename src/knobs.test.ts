import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DAY_MS } from "./game/atmosphere";
import { DEFAULT_SKY_FRACTION } from "./game/horizon";
import { wantsMap } from "./game/map-overlay";
import { DEFAULT_STRAFE_RADIUS } from "./game/planet";
import { DEFAULT_SCENE_OPTIONS, readSceneOptions, type SceneOptions } from "./game/scene-options";
import { hrefReset, hrefWith, KNOB_GROUPS, knobApplies, knobChecked, KNOBS, knobsFor, knobValue, type Knob } from "./knobs";
import { parseGpu, parseMsaa } from "./skins/lowpoly/backend";
import { DEFAULT_SKIN, parseSkin, SKINS } from "./skins/skin";

const root = resolve(import.meta.dirname, "..");

function knob(key: string): Knob {
  const found = KNOBS.find((candidate) => candidate.key === key);
  expect(found, `no knob ${key}`).toBeDefined();
  return found!;
}

function selectValues(key: string): readonly string[] {
  const control = knob(key).control;
  return control.kind === "select" ? control.options.map((option) => option.value) : [];
}

function labelOf(key: string, value: string): string | undefined {
  const control = knob(key).control;
  return control.kind === "select" ? control.options.find((option) => option.value === value)?.label : undefined;
}

/** Which field of `SceneOptions` each world knob sets. */
const SCENE_FIELDS: Readonly<Record<string, keyof SceneOptions>> = {
  time: "pinnedHours",
  day: "dayMs",
  weather: "weather",
  horizon: "skyFraction",
  radius: "radius",
  render: "render",
  sky: "sky",
};

describe("the knob table", () => {
  it("offers every key the page reads from its address", () => {
    // A knob read in one of these and missing here is one the panel cannot set.
    const readers = ["src/main.ts", "src/game/scene-options.ts", "src/skins/pixel.ts", "src/skins/lowpoly/index.ts"];
    const read = readers.flatMap((file) =>
      [...readFileSync(resolve(root, file), "utf8").matchAll(/query\.get\("([a-z]+)"\)/g)].map((match) => match[1]!),
    );
    expect(read.length).toBeGreaterThan(10);
    for (const key of read) {
      expect(KNOBS.map((candidate) => candidate.key), `?${key}= is read but not in the panel`).toContain(key);
    }
  });

  it("names each knob once, in a group the panel draws", () => {
    expect(new Set(KNOBS.map((candidate) => candidate.key)).size).toBe(KNOBS.length);
    for (const candidate of KNOBS) {
      expect(KNOB_GROUPS).toContain(candidate.group);
      expect(candidate.skins.length).toBeGreaterThan(0);
    }
  });

  it("has a fallback that is one of the values it offers", () => {
    for (const candidate of KNOBS) {
      const { control } = candidate;
      const values = control.kind === "select" ? control.options.map((o) => o.value) : [control.checked, control.unchecked];
      expect(values, candidate.key).toContain(candidate.fallback);
      expect(new Set(values).size, `${candidate.key} offers a value twice`).toBe(values.length);
    }
  });

  it("offers only world values the parsers read as something other than the default", () => {
    for (const [key, field] of Object.entries(SCENE_FIELDS)) {
      for (const value of selectValues(key)) {
        const parsed = readSceneOptions(new URLSearchParams(value === "" ? "" : `${key}=${value}`))[field];
        if (value === "") {
          expect(parsed, `${key} fallback`).toEqual(DEFAULT_SCENE_OPTIONS[field]);
        } else {
          expect(parsed, `${key}=${value}`).not.toEqual(DEFAULT_SCENE_OPTIONS[field]);
        }
      }
    }
  });

  it("labels each default with what the default really is", () => {
    expect(labelOf("horizon", "")).toBe(`${Math.round(DEFAULT_SKY_FRACTION * 100)}%`);
    expect(labelOf("radius", "")).toBe(`${DEFAULT_STRAFE_RADIUS} tiles`);
    expect(labelOf("day", "")).toBe(`${DEFAULT_DAY_MS / 60_000} min`);
  });

  it("pins the hour each time option names", () => {
    for (const value of selectValues("time").filter((v) => v !== "")) {
      expect(readSceneOptions(new URLSearchParams(`time=${value}`)).pinnedHours).toBe(Number(value));
      expect(labelOf("time", value)).toBe(`${value.padStart(2, "0")}:00`);
    }
  });

  it("offers every skin, each loading as itself", () => {
    const values = selectValues("skin");
    expect(values).toEqual(SKINS.map((skin) => skin.id));
    for (const value of values) {
      expect(parseSkin(value)).toBe(value);
    }
    // The default skin is what loads with no `?skin=`, so it is written by leaving the key out.
    expect(knob("skin").fallback).toBe(parseSkin(null));
    expect(knobValue(knob("skin"), new URLSearchParams(""))).toBe(DEFAULT_SKIN);
    expect(new URL(hrefWith("http://h/?skin=pixel", knob("skin"), DEFAULT_SKIN)).searchParams.has("skin")).toBe(false);
  });

  it("offers backends and toggles the skins really read", () => {
    for (const value of selectValues("gpu")) {
      expect(parseGpu(value === "" ? null : value)).toBe(value === "" ? "auto" : value);
    }
    const msaa = knob("msaa").control;
    expect(msaa.kind === "toggle" && parseMsaa(msaa.checked === "" ? null : msaa.checked)).toBe(4);
    expect(msaa.kind === "toggle" && parseMsaa(msaa.unchecked)).toBe(1);
    const map = knob("map").control;
    expect(map.kind === "toggle" && wantsMap(map.checked)).toBe(true);
  });
});

describe("knobsFor", () => {
  it("offers a skin only the knobs it reads", () => {
    const pixel = knobsFor("pixel").map((k) => k.key);
    const lowpoly = knobsFor("lowpoly").map((k) => k.key);
    expect(pixel).toEqual(expect.arrayContaining(["skin", "time", "render", "sky", "map", "bench"]));
    expect(pixel).not.toContain("gpu");
    expect(lowpoly).toEqual(expect.arrayContaining(["skin", "time", "weather", "gpu", "msaa"]));
    expect(lowpoly).not.toContain("render");
    expect(lowpoly).not.toContain("map");
  });
});

describe("knobValue", () => {
  it("reads the fallback when the key is absent", () => {
    expect(knobValue(knob("weather"), new URLSearchParams(""))).toBe("");
  });

  it("matches an offered value ignoring case and spaces, as the parsers do", () => {
    expect(knobValue(knob("weather"), new URLSearchParams("weather=%20Storm"))).toBe("storm");
    expect(knobValue(knob("sky"), new URLSearchParams("sky=HD"))).toBe("hd");
  });

  it("hands back a value the table does not offer as typed", () => {
    expect(knobValue(knob("time"), new URLSearchParams("time=18:30"))).toBe("18:30");
  });
});

describe("knobChecked", () => {
  it("ticks a toggle for anything but its unchecked value", () => {
    expect(knobChecked(knob("map"), new URLSearchParams(""))).toBe(false);
    expect(knobChecked(knob("map"), new URLSearchParams("map=1"))).toBe(true);
    expect(knobChecked(knob("msaa"), new URLSearchParams(""))).toBe(true);
    expect(knobChecked(knob("msaa"), new URLSearchParams("msaa=1"))).toBe(false);
  });

  it("is never true for a select", () => {
    expect(knobChecked(knob("weather"), new URLSearchParams("weather=rain"))).toBe(false);
  });
});

describe("knobApplies", () => {
  it("holds a knob with no dependency always", () => {
    expect(knobApplies(knob("weather"), new URLSearchParams("time=3"))).toBe(true);
  });

  it("idles the day length while the clock is pinned", () => {
    expect(knobApplies(knob("day"), new URLSearchParams(""))).toBe(true);
    expect(knobApplies(knob("day"), new URLSearchParams("time=21"))).toBe(false);
  });

  it("idles the GPU count until the benchmark runs", () => {
    expect(knobApplies(knob("sync"), new URLSearchParams(""))).toBe(false);
    expect(knobApplies(knob("sync"), new URLSearchParams("bench=1"))).toBe(true);
  });
});

describe("hrefWith", () => {
  const base = "http://127.0.0.1:4100/?skin=pixel&time=21";

  it("sets a knob and keeps every other one", () => {
    const url = new URL(hrefWith(base, knob("weather"), "storm"));
    expect(url.searchParams.get("weather")).toBe("storm");
    expect(url.searchParams.get("skin")).toBe("pixel");
    expect(url.searchParams.get("time")).toBe("21");
  });

  it("replaces a value already there", () => {
    expect(new URL(hrefWith(base, knob("time"), "6")).searchParams.get("time")).toBe("6");
  });

  it("removes the key at the fallback rather than writing it", () => {
    const url = new URL(hrefWith(base, knob("time"), ""));
    expect(url.searchParams.has("time")).toBe(false);
    expect(url.searchParams.get("skin")).toBe("pixel");
  });

  it("keeps the path and the hash", () => {
    const url = new URL(hrefWith("http://127.0.0.1:4100/index.html?skin=pixel#x", knob("map"), "1"));
    expect(url.pathname).toBe("/index.html");
    expect(url.hash).toBe("#x");
  });
});

describe("hrefReset", () => {
  it("removes every knob and keeps what is not one", () => {
    const url = new URL(hrefReset("http://127.0.0.1:4100/?skin=pixel&time=21&map=1&other=7"));
    expect([...url.searchParams.keys()]).toEqual(["other"]);
  });
});
