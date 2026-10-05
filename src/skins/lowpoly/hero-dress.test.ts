import { describe, expect, it } from "vitest";

import { HERO_EQUIPPED } from "../../game/models";
import { effectiveSkeleton } from "../../game/rig";
import { SKELETON_DRESS, SKULL, SKULL_HOLES, STICK_DRESS } from "./hero-dress";
import { heroMesh } from "./hero-mesh";
import { MeshBuilder } from "./mesh";
import { LOWPOLY } from "./palette";

const RIG_BONES = new Set(effectiveSkeleton(HERO_EQUIPPED).bones.map((bone) => bone.name));

function meshOf(enchanted: boolean): MeshBuilder {
  const b = new MeshBuilder();
  heroMesh(b, HERO_EQUIPPED.basePose, { yaw: 0, enchanted, sunk: 0 });
  return b;
}

describe("the low-poly hero's skeleton dress", () => {
  it("hangs only on bones the shared rig has, so the clips pose all of it", () => {
    for (const bone of Object.keys(SKELETON_DRESS)) {
      expect(RIG_BONES, bone).toContain(bone);
    }
    expect(RIG_BONES).toContain("sword");
  });

  it("dresses every limb and the skull, so no bone the clips move is invisible", () => {
    for (const bone of ["torso", "head", "arm-l", "arm-r", "leg-l", "leg-r"]) {
      expect(SKELETON_DRESS[bone]?.length ?? 0, bone).toBeGreaterThan(0);
    }
  });

  it("is bare bone, with the stick the one thing of wood", () => {
    const colours = new Set(Object.values(SKELETON_DRESS).flatMap((pieces) => pieces.map((piece) => piece.colour)));
    expect([...colours]).toEqual(["bone"]);
    expect(STICK_DRESS.every((piece) => piece.colour === "bark")).toBe(true);
  });

  it("leaves daylight between the ribs, where the spine shows through", () => {
    const ribs = (SKELETON_DRESS.torso ?? []).filter((piece) => piece.to !== undefined && piece.radius > 1.8 && piece.from > 0.3);
    expect(ribs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ribs.length; i += 1) {
      expect(ribs[i]!.from).toBeGreaterThan(ribs[i - 1]!.to!);
    }
  });

  it("puts the sockets on the face, either side of centre, and the nose between them", () => {
    const [left, right, nose] = SKULL_HOLES;
    expect(left!.at.x).toBeLessThan(0);
    expect(right!.at.x).toBe(-left!.at.x);
    expect(nose!.at.x).toBe(0);
    expect(nose!.at.z).toBeLessThan(left!.at.z);
    for (const hole of SKULL_HOLES) {
      expect(hole.at.y).toBeGreaterThan(0);
    }
  });

  it("sinks the holes into the cranium, so they read as hollows rather than eyeballs", () => {
    for (const hole of SKULL_HOLES) {
      const fromCentre = Math.hypot(hole.at.x - SKULL.at.x, hole.at.y - SKULL.at.y, hole.at.z - SKULL.at.z);
      const proud = fromCentre + hole.radius - SKULL.radius;
      expect(proud).toBeGreaterThan(0);
      expect(proud).toBeLessThan(0.25);
    }
    expect(LOWPOLY.socket).toBeDefined();
  });

  it("sets only the stick alight when enchanted, never the bones", () => {
    const plain = meshOf(false);
    const lit = meshOf(true);
    expect(lit.vertexCount).toBe(plain.vertexCount);
    expect(lit.bytesView()).not.toEqual(plain.bytesView());
    expect(STICK_DRESS.every((piece) => piece.burns === true)).toBe(true);
    for (const pieces of Object.values(SKELETON_DRESS)) {
      expect(pieces.some((piece) => piece.burns === true)).toBe(false);
    }
  });
});
