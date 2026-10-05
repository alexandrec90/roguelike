import { describe, expect, it } from "vitest";

import { layeredPose } from "../../game/hero/hero-figure";
import { SWING, WALK } from "../../game/models";
import type { Vec3 } from "../../game/rig";
import { freeOf, looseSkeleton, type SwayTracks } from "./hero-sway";

function loose(tracks: SwayTracks) {
  const pose = layeredPose(tracks);
  return { pose, out: looseSkeleton(pose, tracks) };
}

/** How far a bone's direction turned, radians. */
function turned(a: Vec3 | undefined, b: Vec3 | undefined): number {
  const u = a!;
  const v = b!;
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  return Math.acos(Math.min(1, dot / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z))));
}

describe("the skeleton's loose upper body", () => {
  it("lets a one-shot clip have its bones in the middle, and hands them back eased", () => {
    expect(freeOf(undefined, 500)).toBe(1);
    expect(freeOf(0, 500)).toBe(1);
    expect(freeOf(250, 500)).toBe(0);
    expect(freeOf(500, 500)).toBe(1);
    expect(freeOf(50, 500)).toBeCloseTo(0.5, 6);
    expect(freeOf(900, 500)).toBe(1);
  });

  it("never touches the legs or the root - where he stands is the clips' alone", () => {
    for (const tracks of [{ idleMs: 700 }, { idleMs: 0, walkMs: 160 }]) {
      const { pose, out } = loose(tracks);
      expect(out.root).toEqual(pose.root);
      expect(out.bones["leg-l"]).toEqual(pose.bones["leg-l"]);
      expect(out.bones["leg-r"]).toEqual(pose.bones["leg-r"]);
    }
  });

  it("leans the spine over the stride and tilts the shoulder line with it", () => {
    const { pose, out } = loose({ idleMs: 0, walkMs: WALK.durationMs / 4 });
    expect(out.bones.torso!.x).toBeGreaterThan(pose.bones.torso!.x);
    // Leaning right: the right shoulder drops, the left one rises.
    expect(out.bones["shoulder-r"]!.z).toBeLessThan(pose.bones["shoulder-r"]!.z);
    expect(out.bones["shoulder-l"]!.z).toBeGreaterThan(pose.bones["shoulder-l"]!.z);
    // The skull lolls against the lean.
    expect(out.bones.head!.x).toBeLessThan(0);
  });

  it("sways less standing than walking", () => {
    const most = (tracks: (ms: number) => SwayTracks, period: number) =>
      Math.max(
        ...Array.from({ length: 16 }, (_, i) => {
          const { pose, out } = loose(tracks((period * i) / 16));
          return turned(pose.bones.torso, out.bones.torso);
        }),
      );
    const walking = most((ms) => ({ idleMs: 0, walkMs: ms }), WALK.durationMs);
    const standing = most((ms) => ({ idleMs: ms }), 2600);
    expect(standing).toBeGreaterThan(0);
    expect(standing).toBeLessThan(walking);
  });

  it("keeps out of the sword arm and the spine mid-swing, so the blow lands as authored", () => {
    const tracks = { idleMs: 0, walkMs: 100, swingMs: SWING.durationMs / 2 };
    const { pose, out } = loose(tracks);
    expect(out.bones.torso).toEqual(pose.bones.torso);
    expect(out.bones["arm-r"]).toEqual(pose.bones["arm-r"]);
  });

  it("is a pure function of the pose and the clocks", () => {
    const tracks = { idleMs: 1234, walkMs: 321 };
    expect(loose(tracks).out).toEqual(loose(tracks).out);
  });
});
