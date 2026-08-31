import { describe, expect, it } from "vitest";

import { DEPTH_RATIO } from "./projection";
import {
  effectiveSkeleton,
  equip,
  partBoneNames,
  projectRigPoint,
  renderModel,
  samplePose,
  solvePose,
  validateClip,
  validateModel,
  validateSkeleton,
  vec3,
  type Clip,
  type RigModel,
  type SkeletonDef,
} from "./rig";

const STICK: SkeletonDef = {
  bones: [
    { name: "spine", parent: null, attach: "end", length: 4 },
    { name: "arm", parent: "spine", attach: "end", length: 2 },
  ],
};

const STICK_MODEL: RigModel = {
  skeleton: STICK,
  basePose: {
    root: vec3(0, 0, 4),
    bones: { spine: vec3(0, 0, 1), arm: vec3(1, 0, 0) },
  },
  style: { spine: { ink: "bone" }, arm: { ink: "bone" } },
  parts: [],
};

describe("validateSkeleton", () => {
  it("accepts a well-formed tree", () => {
    expect(validateSkeleton(STICK)).toEqual([]);
  });

  it("collects every structural problem at once", () => {
    const problems = validateSkeleton({
      bones: [
        { name: "a", parent: "ghost", attach: "end", length: 0 },
        { name: "a", parent: null, attach: "end", length: 1 },
        { name: "b", parent: null, attach: "end", length: 1 },
      ],
    });
    expect(problems.join("\n")).toMatch(/Duplicate bone 'a'/);
    expect(problems.join("\n")).toMatch(/non-positive length/);
    expect(problems.join("\n")).toMatch(/unknown parent 'ghost'/);
    expect(problems.join("\n")).toMatch(/2 root bones/);
  });

  it("requires parent-first declaration, the solve order", () => {
    const problems = validateSkeleton({
      bones: [
        { name: "child", parent: "root", attach: "end", length: 1 },
        { name: "root", parent: null, attach: "end", length: 1 },
      ],
    });
    expect(problems.join("\n")).toMatch(/before its parent/);
  });
});

describe("solvePose", () => {
  it("chains bones from the root, scaling directions to bone length", () => {
    const solved = solvePose(STICK, STICK_MODEL.basePose);
    expect(solved["spine"]?.start).toEqual(vec3(0, 0, 4));
    expect(solved["spine"]?.end).toEqual(vec3(0, 0, 8));
    // The arm hangs off the spine's end and points +x, length 2.
    expect(solved["arm"]?.start).toEqual(vec3(0, 0, 8));
    expect(solved["arm"]?.end).toEqual(vec3(2, 0, 8));
  });

  it("falls back per bone, and throws when a bone has no direction anywhere", () => {
    const sparse = { root: vec3(0, 0, 4), bones: { spine: vec3(0, 0, 1) } };
    const solved = solvePose(STICK, sparse, STICK_MODEL.basePose);
    expect(solved["arm"]?.end).toEqual(vec3(2, 0, 8));
    expect(() => solvePose(STICK, sparse)).toThrow(/No direction for bone 'arm'/);
  });

  it("collapses a zero direction to a point rather than crashing", () => {
    const pose = { root: vec3(0, 0, 4), bones: { spine: vec3(0, 0, 0), arm: vec3(1, 0, 0) } };
    const solved = solvePose(STICK, pose);
    expect(solved["spine"]?.end).toEqual(solved["spine"]?.start);
  });
});

describe("projectRigPoint", () => {
  it("projects exactly like the world: y foreshortened, z straight up", () => {
    expect(projectRigPoint(vec3(3, 0, 0))).toEqual({ x: 3, y: 0 });
    expect(projectRigPoint(vec3(0, 4, 0))).toEqual({ x: 0, y: Math.round(4 * DEPTH_RATIO) });
    expect(projectRigPoint(vec3(0, 0, 5))).toEqual({ x: 0, y: -5 });
  });
});

describe("samplePose", () => {
  const clip: Clip = {
    id: "test",
    durationMs: 100,
    loop: false,
    keys: [
      { t: 0, root: vec3(0, 0, 0), bones: { spine: vec3(1, 0, 0) } },
      { t: 1, root: vec3(0, 0, 2), bones: { spine: vec3(0, 1, 0) } },
    ],
  };

  it("lerps between keys per channel", () => {
    const pose = samplePose(clip, STICK_MODEL.basePose, 50);
    expect(pose.root.z).toBeCloseTo(1);
    expect(pose.bones["spine"]?.x).toBeCloseTo(0.5);
    expect(pose.bones["spine"]?.y).toBeCloseTo(0.5);
  });

  it("fills unkeyed channels from the base pose", () => {
    const pose = samplePose(clip, STICK_MODEL.basePose, 50);
    expect(pose.bones["arm"]).toEqual(vec3(1, 0, 0));
  });

  it("clamps a one-shot to its last key and holds", () => {
    const pose = samplePose(clip, STICK_MODEL.basePose, 900);
    expect(pose.root.z).toBe(2);
  });

  it("wraps a looping clip across the seam", () => {
    const looping: Clip = { ...clip, loop: true };
    const early = samplePose(looping, STICK_MODEL.basePose, 10);
    const wrapped = samplePose(looping, STICK_MODEL.basePose, 110);
    expect(wrapped.root.z).toBeCloseTo(early.root.z);
  });
});

describe("validateClip", () => {
  it("accepts a clean clip and flags out-of-order or unknown-bone keys", () => {
    const good: Clip = {
      id: "ok",
      durationMs: 100,
      loop: true,
      keys: [{ t: 0, bones: { spine: vec3(0, 0, 1) } }],
    };
    expect(validateClip(good, STICK)).toEqual([]);

    const bad: Clip = {
      id: "bad",
      durationMs: 0,
      loop: false,
      keys: [
        { t: 0.5, bones: { ghost: vec3(1, 0, 0) } },
        { t: 0.5 },
        { t: 2 },
      ],
    };
    const problems = validateClip(bad, STICK).join("\n");
    expect(problems).toMatch(/non-positive duration/);
    expect(problems).toMatch(/unknown bone 'ghost'/);
    expect(problems).toMatch(/not strictly ascending/);
    expect(problems).toMatch(/outside 0..1/);
  });

  it("accepts gear bones through extraBones", () => {
    const clip: Clip = {
      id: "swing",
      durationMs: 100,
      loop: false,
      keys: [{ t: 0, bones: { sword: vec3(1, 0, 0) } }],
    };
    expect(validateClip(clip, STICK, ["sword"])).toEqual([]);
    expect(validateClip(clip, STICK).join("\n")).toMatch(/unknown bone 'sword'/);
  });
});

describe("equip and the effective skeleton", () => {
  const armed = equip(STICK_MODEL, {
    kind: "bone",
    id: "sword",
    bone: { name: "sword", parent: "arm", attach: "end", length: 3 },
    ink: "cyan",
  });

  it("adds gear without touching the base model", () => {
    expect(STICK_MODEL.parts).toHaveLength(0);
    expect(partBoneNames(armed)).toEqual(["sword"]);
    expect(effectiveSkeleton(armed).bones.map((bone) => bone.name)).toEqual([
      "spine",
      "arm",
      "sword",
    ]);
  });

  it("validates the combined skeleton and every part's target", () => {
    expect(validateModel(armed)).toEqual([]);
    const broken = equip(STICK_MODEL, {
      kind: "stamp",
      id: "hat",
      bone: "ghost",
      at: "end",
      mask: { width: 1, height: 1, pixels: [{ x: 0, y: 0 }] },
      anchor: { x: 0, y: 0 },
      ink: "magenta",
    });
    expect(validateModel(broken).join("\n")).toMatch(/unknown bone 'ghost'/);
  });
});

describe("renderModel", () => {
  const armed = equip(STICK_MODEL, {
    kind: "bone",
    id: "sword",
    bone: { name: "sword", parent: "arm", attach: "end", length: 3 },
    ink: "cyan",
  });

  it("anchors at the foot: a root at z=4 puts the spine's base 4 pixels up", () => {
    const cloud = renderModel(STICK_MODEL, STICK_MODEL.basePose);
    const ys = cloud.map((pixel) => pixel.y);
    expect(Math.max(...ys)).toBe(-4);
    expect(Math.min(...ys)).toBe(-8);
  });

  it("extends an unkeyed gear bone along its parent's direction", () => {
    const cloud = renderModel(armed, armed.basePose);
    const swordXs = cloud.filter((pixel) => pixel.ink === "cyan").map((pixel) => pixel.x);
    // Arm points +x from x=0 with length 2; the sword continues to x=5.
    expect(Math.max(...swordXs)).toBe(5);
  });

  it("negates depth for the back facing and drops front-only stamps", () => {
    const eyed = equip(STICK_MODEL, {
      kind: "stamp",
      id: "eyes",
      bone: "spine",
      at: "end",
      mask: { width: 1, height: 1, pixels: [{ x: 0, y: 0 }] },
      anchor: { x: 0, y: 0 },
      ink: "void",
      facing: "front",
    });
    const front = renderModel(eyed, eyed.basePose);
    const back = renderModel(eyed, eyed.basePose, { facing: "back" });
    expect(front.some((pixel) => pixel.ink === "void")).toBe(true);
    expect(back.some((pixel) => pixel.ink === "void")).toBe(false);

    const lean = { root: vec3(0, 0, 4), bones: { spine: vec3(0, 1, 1), arm: vec3(1, 0, 0) } };
    const leanFront = renderModel(STICK_MODEL, lean);
    const leanBack = renderModel(STICK_MODEL, lean, { facing: "back" });
    const topY = (cloud: ReturnType<typeof renderModel>) =>
      Math.min(...cloud.map((pixel) => pixel.y));
    // Leaning toward the camera drops the head lower on screen than leaning away.
    expect(topY(leanFront)).toBeGreaterThan(topY(leanBack));
  });

  it("mirrors the whole model with flipX", () => {
    const cloud = renderModel(armed, armed.basePose);
    const flipped = renderModel(armed, armed.basePose, { flipX: true });
    const xs = (pixels: ReturnType<typeof renderModel>) => pixels.map((pixel) => pixel.x).sort();
    expect(xs(flipped)).toEqual(xs(cloud).map((x) => -x).sort());
  });

  it("draws far limbs first so near limbs overwrite them", () => {
    const model: RigModel = {
      ...STICK_MODEL,
      style: { spine: { ink: "bone" }, arm: { ink: "cyan" } },
    };
    const firstOf = (cloud: ReturnType<typeof renderModel>, ink: string) =>
      cloud.findIndex((pixel) => pixel.ink === ink);

    const toward = renderModel(model, {
      root: vec3(0, 0, 4),
      bones: { spine: vec3(0, 0, 1), arm: vec3(0, 1, -1) },
    });
    const away = renderModel(model, {
      root: vec3(0, 0, 4),
      bones: { spine: vec3(0, 0, 1), arm: vec3(0, -1, -1) },
    });
    // Nearer the camera (positive y) draws later; farther draws earlier.
    expect(firstOf(toward, "cyan")).toBeGreaterThan(firstOf(toward, "bone"));
    expect(firstOf(away, "cyan")).toBeLessThan(firstOf(away, "bone"));
  });

  it("applies a reink to a bone's stroke", () => {
    const armored = equip(STICK_MODEL, {
      kind: "reink",
      id: "armor",
      bones: ["spine"],
      ink: "steel",
    });
    const cloud = renderModel(armored, armored.basePose);
    expect(cloud.some((pixel) => pixel.ink === "steel")).toBe(true);
  });
});
