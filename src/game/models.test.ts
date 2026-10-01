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

  it("shows two eyes from the front, one in profile, and none from behind", () => {
    const eyes = (yaw: number) =>
      renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose, { yaw })
        .filter((pixel) => pixel.ink === "void")
        .map((pixel) => pixel.x)
        .sort((a, b) => a - b);

    expect(eyes(0)).toEqual([-1, 1]);
    // Three-quarter: still both, slid a pixel toward the way he faces.
    expect(eyes(Math.PI / 4)).toEqual([0, 2]);
    expect(eyes(-Math.PI / 4)).toEqual([-2, 0]);
    // Profile: the near eye only, on the side he faces.
    expect(eyes(Math.PI / 2)).toEqual([1]);
    expect(eyes(-Math.PI / 2)).toEqual([-1]);
    // Anything with his back to the viewer shows none.
    expect(eyes((3 * Math.PI) / 4)).toEqual([]);
    expect(eyes(Math.PI)).toEqual([]);
    expect(eyes((-3 * Math.PI) / 4)).toEqual([]);
  });

  it("keeps the sword in the same hand facing toward and away from the viewer", () => {
    const swordSide = (yaw: number) => {
      const xs = renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose, { yaw })
        .filter((pixel) => pixel.ink === "cyan")
        .map((pixel) => pixel.x);
      return Math.sign(xs.reduce((sum, x) => sum + x, 0));
    };
    // Same hand, so it crosses the screen: the outline turned, not mirrored in place.
    expect(swordSide(0)).toBe(1);
    expect(swordSide(Math.PI)).toBe(-1);
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

describe("swinging while walking", () => {
  /**
   * The renderer layers the two clips rather than choosing between them
   * (`hero-layer.ts`): a walk sample is the *base* the swing is sampled onto,
   * and unkeyed channels fall through. That works only because `SWING` keys the
   * sword arm, the sword and the torso and nothing else — this is the test that
   * fails if a later keyframe quietly puts a leg in it.
   */
  const walking = samplePose(WALK, HERO_EQUIPPED.basePose, 0.25 * WALK.durationMs);
  const both = samplePose(SWING, walking, 0.45 * SWING.durationMs);

  it("keeps the legs on the walk cycle underneath the swing", () => {
    expect(both.bones["leg-l"]).toEqual(walking.bones["leg-l"]);
    expect(both.bones["leg-r"]).toEqual(walking.bones["leg-r"]);
    expect(both.root).toEqual(walking.root);
  });

  it("still leads the wrist with the blade, exactly as the swing alone does", () => {
    const swingOnly = samplePose(SWING, HERO_EQUIPPED.basePose, 0.45 * SWING.durationMs);
    expect(both.bones["arm-r"]).toEqual(swingOnly.bones["arm-r"]);
    expect(both.bones["sword"]).toEqual(swingOnly.bones["sword"]);
    expect(both.bones["sword"]?.y).toBeGreaterThan(0);
  });

  it("leaves the free arm swinging with the stride", () => {
    expect(both.bones["arm-l"]).toEqual(walking.bones["arm-l"]);
    expect(both.bones["arm-l"]).not.toEqual(HERO_EQUIPPED.basePose.bones["arm-l"]);
  });
});
