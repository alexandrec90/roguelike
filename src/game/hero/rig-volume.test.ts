import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import { HERO_EQUIPPED, HERO_FACE, HERO_MODEL, SWING, SWING_BEATS } from "../models";
import { samplePose, solveModel, vec3, type RigModel } from "../rig";
import { boneSpan, modelPrims, projectPoint, renderVolume } from "./rig-volume";

const BASE = HERO_EQUIPPED.basePose;

describe("projectPoint", () => {
  it("is the world's projection, unrounded, with rig y kept as depth", () => {
    expect(projectPoint(vec3(2, 4, 10))).toEqual({ x: 2, y: 4 * 0.75 - 10, depth: 4 });
  });
});

describe("modelPrims", () => {
  it("makes one body per piece, and none for a bone with no pieces", () => {
    const solved = solveModel(HERO_EQUIPPED, BASE);
    const pieces = Object.values(HERO_EQUIPPED.volumes ?? {}).reduce((sum, list) => sum + list.length, 0);
    const sword = HERO_EQUIPPED.parts.find((part) => part.kind === "bone");
    const gear = sword?.kind === "bone" ? (sword.volumes?.length ?? 0) : 0;
    expect(modelPrims(HERO_EQUIPPED, solved)).toHaveLength(pieces + gear);
  });

  it("swaps a bone's material wholesale when retinted", () => {
    const solved = solveModel(HERO_EQUIPPED, BASE);
    const prims = modelPrims(HERO_EQUIPPED, solved, { retint: { sword: "fire" } });
    expect(prims.filter((prim) => prim.material === "fire")).toHaveLength(4);
    expect(prims.some((prim) => prim.material === "metal")).toBe(false);
  });

  it("carries a piece's offset round to the back when he turns away", () => {
    const model: RigModel = {
      ...HERO_MODEL,
      volumes: { torso: [{ from: 0.5, radius: 1, material: "gold", offset: vec3(0, 2, 0) }] },
    };
    const front = modelPrims(model, solveModel(model, BASE))[0];
    const back = modelPrims(model, solveModel(model, BASE, { yaw: Math.PI }), { yaw: Math.PI })[0];
    expect(front?.da).toBeGreaterThan(0);
    expect(back?.da).toBeLessThan(0);
  });

  it("lays a crossbar square to its bone on screen", () => {
    const solved = solveModel(HERO_EQUIPPED, BASE);
    const guard = modelPrims(HERO_EQUIPPED, solved).find((prim) => prim.material === "gold" && prim.ax !== prim.bx);
    const blade = boneSpan(solved, "sword");
    expect(guard).toBeDefined();
    expect(blade).toBeDefined();
    const bar = { x: guard!.bx - guard!.ax, y: guard!.by - guard!.ay };
    const along = { x: blade!.b.x - blade!.a.x, y: blade!.b.y - blade!.a.y };
    expect(bar.x * along.x + bar.y * along.y).toBeCloseTo(0, 6);
  });
});

describe("renderVolume", () => {
  it("stands on the ground, about twenty pixels tall", () => {
    const bounds = cloudBounds(renderVolume(HERO_EQUIPPED, BASE).cloud);
    expect(bounds?.bottom).toBe(0);
    expect(bounds?.top).toBeLessThanOrEqual(-19);
    expect(bounds?.top).toBeGreaterThanOrEqual(-24);
  });

  it("draws eyes from the front only, and only when a face is asked for", () => {
    const eyes = (cloud: { ink: string }[]) => cloud.filter((p) => p.ink === HERO_FACE.ink).length;
    const front = renderVolume(HERO_EQUIPPED, BASE, { face: HERO_FACE }).cloud;
    const back = renderVolume(HERO_EQUIPPED, BASE, { face: HERO_FACE, yaw: Math.PI }).cloud;
    const faceless = renderVolume(HERO_EQUIPPED, BASE).cloud;
    expect(eyes(front) - eyes(faceless)).toBe(2);
    expect(eyes(back)).toBe(eyes(renderVolume(HERO_EQUIPPED, BASE, { yaw: Math.PI }).cloud));
  });

  it("turns the eyes with the head: one in profile, both on a three-quarter view", () => {
    const eyes = (yaw: number) =>
      renderVolume(HERO_EQUIPPED, BASE, { face: HERO_FACE, yaw }).cloud.filter((p) => p.ink === HERO_FACE.ink).length -
      renderVolume(HERO_EQUIPPED, BASE, { yaw }).cloud.filter((p) => p.ink === HERO_FACE.ink).length;
    expect(eyes(Math.PI / 2)).toBeLessThanOrEqual(1);
    expect(eyes(-Math.PI / 2)).toBeLessThanOrEqual(1);
    expect(eyes(Math.PI / 4)).toBeGreaterThanOrEqual(1);
  });

  it("shows more hair from behind than from the front", () => {
    const hair = (cloud: { ink: string }[]) => cloud.filter((p) => p.ink.startsWith("hair")).length;
    const front = renderVolume(HERO_EQUIPPED, BASE).cloud;
    const back = renderVolume(HERO_EQUIPPED, BASE, { yaw: Math.PI }).cloud;
    expect(hair(back)).toBeGreaterThan(hair(front) * 1.5);
  });

  it("mirrors with flipX", () => {
    const right = cloudBounds(renderVolume(HERO_EQUIPPED, BASE).cloud);
    const left = cloudBounds(renderVolume(HERO_EQUIPPED, BASE, { flipX: true }).cloud);
    expect(left?.left).toBe(-(right?.right ?? 0));
  });

  it("puts the blade behind him at the windup and in front at contact", () => {
    const tip = (ms: number) => boneSpan(renderVolume(HERO_EQUIPPED, samplePose(SWING, BASE, ms)).solved, "sword")?.b.depth;
    expect(tip(SWING_BEATS.windup * SWING.durationMs)).toBeLessThan(0);
    expect(tip(SWING_BEATS.contact * SWING.durationMs)).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(renderVolume(HERO_EQUIPPED, BASE, { face: HERO_FACE }).cloud).toEqual(
      renderVolume(HERO_EQUIPPED, BASE, { face: HERO_FACE }).cloud,
    );
  });
});

describe("boneSpan", () => {
  it("is undefined for a bone the model does not have", () => {
    expect(boneSpan(solveModel(HERO_MODEL, BASE), "sword")).toBeUndefined();
  });
});
