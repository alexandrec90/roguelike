import { describe, expect, it } from "vitest";

import { coverOffset, integerCoverScale, integerScale, letterbox } from "./integer-scale";

describe("integerScale", () => {
  it("picks the largest whole factor that fits", () => {
    expect(integerScale(1280, 720, 320, 180)).toEqual({ factor: 4, width: 1280, height: 720 });
  });

  it("never returns a fractional factor for an awkward viewport", () => {
    const result = integerScale(1000, 700, 320, 180);

    expect(result.factor).toBe(3);
    expect(result.width).toBe(960);
  });

  it("is bounded by the narrower axis", () => {
    expect(integerScale(1920, 400, 320, 180).factor).toBe(2);
  });

  it("clamps to 1 rather than shrinking below the base size", () => {
    expect(integerScale(200, 100, 320, 180)).toEqual({ factor: 1, width: 320, height: 180 });
  });

  it("honours a maximum factor", () => {
    expect(integerScale(4000, 4000, 320, 180, { maxFactor: 3 }).factor).toBe(3);
  });

  it("rejects a non-positive base size", () => {
    expect(() => integerScale(100, 100, 0, 180)).toThrow(/positive/);
  });

  it("rejects a maximum below one", () => {
    expect(() => integerScale(100, 100, 320, 180, { maxFactor: 0 })).toThrow(/at least 1/);
  });
});

describe("letterbox", () => {
  it("centres the content on whole pixels", () => {
    expect(letterbox(1000, 700, 960, 540)).toEqual({ left: 20, top: 80 });
  });

  it("rounds the odd remainder down so the offset stays integral", () => {
    expect(letterbox(961, 541, 960, 540)).toEqual({ left: 0, top: 0 });
  });

  it("never offsets content larger than the viewport", () => {
    expect(letterbox(320, 180, 640, 360)).toEqual({ left: 0, top: 0 });
  });
});

describe("integerCoverScale", () => {
  it("picks the smallest whole factor that covers an awkward viewport", () => {
    expect(integerCoverScale(1000, 700, 320, 180)).toEqual({
      factor: 4,
      width: 1280,
      height: 720,
    });
  });

  it("does not enlarge a canvas that already covers the viewport", () => {
    expect(integerCoverScale(200, 100, 320, 180)).toEqual({
      factor: 1,
      width: 320,
      height: 180,
    });
  });

  it("rejects a non-positive base size", () => {
    expect(() => integerCoverScale(100, 100, 0, 180)).toThrow(/positive/);
  });
});

describe("coverOffset", () => {
  it("centres horizontal overflow while preserving the top edge", () => {
    expect(coverOffset(1000, 1280)).toEqual({ left: -140, top: 0 });
  });

  it("centres an odd horizontal crop without using half pixels", () => {
    expect(coverOffset(999, 1280)).toEqual({ left: -141, top: 0 });
  });
});
