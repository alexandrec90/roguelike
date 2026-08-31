import { describe, expect, it } from "vitest";

import { hexToInt, hexToRgb, mixHex, rgbToHex, sampleRamp } from "./color";

describe("colour arithmetic", () => {
  it("round-trips hex through rgb", () => {
    expect(rgbToHex(hexToRgb("#1b2440"))).toBe("#1b2440");
  });

  it("rejects anything that is not #rrggbb, rather than drawing black", () => {
    expect(() => hexToRgb("1b2440")).toThrow(/#rrggbb/);
    expect(() => hexToRgb("#1b24")).toThrow(/#rrggbb/);
  });

  it("mixes to whole channels and clamps its parameter", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#000000", "#ffffff", -2)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 9)).toBe("#ffffff");
  });

  it("samples a multi-stop ramp at its ends exactly", () => {
    const ramp = ["#000000", "#800000", "#ff0000"];

    expect(sampleRamp(ramp, 0)).toBe("#000000");
    expect(sampleRamp(ramp, 1)).toBe("#ff0000");
    expect(sampleRamp(ramp, 0.5)).toBe("#800000");
  });

  it("handles a one-stop ramp instead of dividing by zero", () => {
    expect(sampleRamp(["#123456"], 0.7)).toBe("#123456");
    expect(() => sampleRamp([], 0)).toThrow(/at least one stop/);
  });

  it("converts to the integer Phaser fills want", () => {
    expect(hexToInt("#ff8000")).toBe(0xff8000);
  });
});
