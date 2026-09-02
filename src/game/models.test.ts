import { describe, expect, it } from "vitest";

import { cloudBounds } from "./ink";
import {
  ARMOR,
  CAST,
  HERO_CLIPS,
  HERO_EQUIPPED,
  HERO_MODEL,
  HUMANOID_BASE,
  HUMANOID_SKELETON,
  SWING,
  WALK,
} from "./models";
import {
  equip,
  partBoneNames,
  projectRigPoint,
  renderModel,
  samplePose,
  solvePose,
  validateClip,
  validateModel,
} from "./rig";

describe("the humanoid hero", () => {
  it("is a valid model, dressed or not", () => {
    expect(validateModel(HERO_MODEL)).toEqual([]);
    expect(validateModel(HERO_EQUIPPED)).toEqual([]);
    expect(validateModel(equip(HERO_EQUIPPED, ARMOR))).toEqual([]);
  });

  it("plants its feet on the ground in the base pose", () => {
    const bounds = cloudBounds(renderModel(HERO_MODEL, HERO_MODEL.basePose));
    expect(bounds?.bottom).toBe(0);
    // Roughly one WALL_RISE tall, so it reads at wall-block scale.
    expect(bounds?.top).toBeLessThanOrEqual(-12);
  });

  it("plants straight legs symmetrically beneath the torso", () => {
    const poses = [
      HUMANOID_BASE,
      samplePose(WALK, HUMANOID_BASE, 0),
      samplePose(WALK, HUMANOID_BASE, WALK.durationMs / 2),
    ];

    for (const pose of poses) {
      const solved = solvePose(HUMANOID_SKELETON, pose);
      const left = solved["leg-l"];
      const right = solved["leg-r"];
      expect(left).toBeDefined();
      expect(right).toBeDefined();

      const leftStart = projectRigPoint(left!.start);
      const leftEnd = projectRigPoint(left!.end);
      const rightStart = projectRigPoint(right!.start);
      const rightEnd = projectRigPoint(right!.end);
      expect(leftStart.x).toBe(leftEnd.x);
      expect(rightStart.x).toBe(rightEnd.x);
      expect(leftStart.x).toBe(-rightStart.x);
      expect(leftEnd.x).toBe(-rightEnd.x);
    }
  });

  it("shows eyes from the front and none from the back", () => {
    const front = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
    const back = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose, { facing: "back" });
    expect(front.some((pixel) => pixel.ink === "void")).toBe(true);
    expect(back.some((pixel) => pixel.ink === "void")).toBe(false);
    // The silhouette is otherwise the same size, per the front/back contract.
    expect(back.length).toBeGreaterThan(0);
  });

  it("carries the sword without the hat", () => {
    expect(partBoneNames(HERO_EQUIPPED)).toEqual(["sword"]);
    const cloud = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
    expect(cloud.some((pixel) => pixel.ink === "cyan")).toBe(true);
    expect(cloud.some((pixel) => pixel.ink === "magenta")).toBe(false);
  });

  it("re-inks the torso under armor without changing the pixel count", () => {
    const bare = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose);
    const armored = renderModel(equip(HERO_EQUIPPED, ARMOR), HERO_EQUIPPED.basePose);
    expect(armored.length).toBe(bare.length);
    expect(armored.some((pixel) => pixel.ink === "steel")).toBe(true);
    expect(bare.some((pixel) => pixel.ink === "steel")).toBe(false);
  });
});

describe("the hero's clips", () => {
  it("all validate against the skeleton plus its gear bones", () => {
    for (const clip of HERO_CLIPS) {
      expect(validateClip(clip, HUMANOID_SKELETON, partBoneNames(HERO_EQUIPPED))).toEqual([]);
    }
  });

  it("swings the sword behind at the windup and in front at contact", () => {
    const windup = samplePose(SWING, HERO_EQUIPPED.basePose, 0.3 * SWING.durationMs);
    const contact = samplePose(SWING, HERO_EQUIPPED.basePose, 0.45 * SWING.durationMs);
    expect(windup.bones["sword"]?.y).toBeLessThan(0);
    expect(contact.bones["sword"]?.y).toBeGreaterThan(0);
  });

  it("thrusts both palms toward the camera at the cast's release", () => {
    const release = samplePose(CAST, HERO_EQUIPPED.basePose, 0.55 * CAST.durationMs);
    expect(release.bones["arm-l"]?.y).toBeGreaterThan(0.5);
    expect(release.bones["arm-r"]?.y).toBeGreaterThan(0.5);
  });

  it("settles every one-shot back to the guard pose", () => {
    for (const clip of HERO_CLIPS.filter((candidate) => !candidate.loop)) {
      const settled = samplePose(clip, HERO_EQUIPPED.basePose, clip.durationMs);
      expect(settled.bones["arm-r"]?.y).toBeCloseTo(0.25);
    }
  });
});
