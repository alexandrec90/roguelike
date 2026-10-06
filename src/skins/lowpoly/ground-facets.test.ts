import { describe, expect, it } from "vitest";

import { EncounterSim } from "../../game/encounter-sim";
import { HeroDriver } from "../../game/hero/hero-driver";
import { type PlanetPoint } from "../../game/planet";
import { ActorMeshes } from "./actor-frame";
import { groundCell, groundSurface, groundVertex } from "./ground-facets";
import { freeToTilt } from "./ground-relief";
import { FLAT_LOOK, PAINTED_LOOK, type Look } from "./look";
import { MeshBuilder, VERTEX_BYTES, type Vec3 } from "./mesh";
import { groundMesh, standingHeight } from "./terrain-mesh";
import { buildChunk, CHUNK_TILES, CHUNKS_PER_SIDE } from "./world-chunks";

type Triangle = [Vec3, Vec3, Vec3];

function triangles(bytes: Uint8Array): Triangle[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i: number) => [0, 4, 8].map((o) => view.getFloat32(i * VERTEX_BYTES + o, true)) as unknown as Vec3;
  return Array.from({ length: bytes.byteLength / VERTEX_BYTES / 3 }, (_, t) => [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)]);
}

/** Twice the signed area of a triangle seen from above. */
function area2([p, q, r]: Triangle): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
}

/**
 * The oracle: `groundMesh` built round `point` - whole 4×4 squares, so every
 * merged plane over it is in - and probed straight down. Slow and independent
 * of `groundSurface`, so the two agreeing means a foot stands on what is drawn.
 */
function drawnGround(point: PlanetPoint): number {
  const origin = { x: Math.floor(point.x / 4) * 4 - 4, y: Math.floor(point.y / 4) * 4 - 4 };
  const b = new MeshBuilder();
  groundMesh(b, origin, 12, [], PAINTED_LOOK);
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  for (const [p, q, r] of triangles(b.bytesView())) {
    const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    const l1 = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (y - r[1])) / det;
    const l2 = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (y - r[1])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) {
      return l1 * p[2] + l2 * q[2] + l3 * r[2];
    }
  }
  throw new Error(`no triangle over ${point.x}, ${point.y}`);
}

/** Every tile's faces over a stretch of the planet, by size class. */
function census(look: Look, span: number): { owners: number; empty: number; four: number; merged: Triangle[] } {
  let owners = 0;
  let empty = 0;
  let four = 0;
  const merged: Triangle[] = [];
  const origin = { x: 0, y: 0 };
  for (let y = 0; y < span; y += 1) {
    for (let x = 0; x < span; x += 1) {
      const { faces } = groundCell(x, y, origin, look);
      if (faces.length === 0) {
        empty += 1;
        continue;
      }
      owners += 1;
      four += faces.length === 4 ? 1 : 0;
      for (const face of faces) {
        if (Math.abs(area2(face as Triangle)) > 4) {
          merged.push(face as Triangle);
        }
      }
    }
  }
  return { owners, empty, four, merged };
}

describe("the flat look's ground", () => {
  it("is two triangles a tile, level under a foot", () => {
    const { owners, empty, four } = census(FLAT_LOOK, 32);
    expect([owners, empty, four]).toEqual([32 * 32, 0, 0]);
    expect(groundSurface({ x: 40.3, y: 71.8 }, FLAT_LOOK)).toBe(0);
  });
});

describe("the painted look's ground", () => {
  const { empty, four, merged } = census(PAINTED_LOOK, 128);

  it("has faces of every size: merged planes over squares of tiles, and tiles split round a point", () => {
    expect(empty).toBeGreaterThan(128 * 128 * 0.05);
    // A merged 4×4 plane's two triangles are eight tiles each.
    expect(merged.some((face) => Math.abs(area2(face)) > 12)).toBe(true);
    expect(four).toBeGreaterThan(128 * 128 * 0.1);
  });

  it("bumps some split tiles up and dents others down", () => {
    let bumps = 0;
    let dents = 0;
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        const { faces } = groundCell(x, y, { x: 0, y: 0 }, PAINTED_LOOK);
        if (faces.length !== 4) {
          continue;
        }
        const [a, b, middle] = faces[0]!;
        const [c, d] = faces[2]!;
        const level = (a[2] + b[2] + c[2] + d[2]) / 4;
        bumps += middle[2] > level + 0.05 ? 1 : 0;
        dents += middle[2] < level - 0.05 ? 1 : 0;
      }
    }
    expect(bumps).toBeGreaterThan(50);
    expect(dents).toBeGreaterThan(50);
  });

  it("merges a plane only over ground free to tilt, so no plane tilts a puddle", () => {
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        if (groundCell(x, y, { x: 0, y: 0 }, PAINTED_LOOK).faces.length === 0) {
          // A merged tile's 2×2 square lies inside its plane, and a free square's every part is free.
          expect(freeToTilt(Math.floor(x / 2) * 2, Math.floor(y / 2) * 2, 2)).toBe(true);
        }
      }
    }
  });

  // Regression: a tile jittered out of convex once took the diagonal outside it, folding a face
  // back over its neighbour - 21 of them on the flat look's planet, 8 on the painted look's.
  it.each([["flat", FLAT_LOOK], ["painted", PAINTED_LOOK]] as const)(
    "is watertight on the %s look: no face folded, and every chunk's faces cover exactly the ground inside its rim",
    (_, look) => {
      const wrong: string[] = [];
      for (let cy = 0; cy < CHUNKS_PER_SIDE; cy += 1) {
        for (let cx = 0; cx < CHUNKS_PER_SIDE; cx += 1) {
          const faces = triangles(buildChunk(cx, cy, look).ground);
          const folded = faces.filter((face) => area2(face) <= 0).length;
          const covered = faces.reduce((sum, face) => sum + Math.abs(area2(face)) / 2, 0);
          const origin = { x: cx * CHUNK_TILES, y: cy * CHUNK_TILES };
          const rim: Vec3[] = [];
          for (let i = 0; i < CHUNK_TILES; i += 1) rim.push(groundVertex(origin.x + i, origin.y, origin, look));
          for (let j = 0; j < CHUNK_TILES; j += 1) rim.push(groundVertex(origin.x + CHUNK_TILES, origin.y + j, origin, look));
          for (let i = CHUNK_TILES; i > 0; i -= 1) rim.push(groundVertex(origin.x + i, origin.y + CHUNK_TILES, origin, look));
          for (let j = CHUNK_TILES; j > 0; j -= 1) rim.push(groundVertex(origin.x, origin.y + j, origin, look));
          const inside = Math.abs(rim.reduce((sum, p, k) => sum + p[0] * rim[(k + 1) % rim.length]![1] - rim[(k + 1) % rim.length]![0] * p[1], 0)) / 2;
          if (folded > 0 || Math.abs(covered - inside) > 0.01) {
            wrong.push(`chunk ${cx},${cy}: ${folded} folded, ${covered.toFixed(3)} covered of ${inside.toFixed(3)}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    },
    60_000,
  );

  it("hands a foot the height of the very face drawn under it", () => {
    let raised = 0;
    for (let k = 0; k < 160; k += 1) {
      const point = { x: 17.37 + k * 1.913, y: 41.11 + ((k * 7.31) % 150) };
      const drawn = drawnGround(point);
      expect(groundSurface(point, PAINTED_LOOK)).toBeCloseTo(drawn, 5);
      raised += drawn > 0.15 ? 1 : 0;
    }
    expect(raised).toBeGreaterThan(10);
  });

  it("stands the hero on the hill", () => {
    let live = { x: 0.5, y: 0.5 };
    for (let k = 0; groundSurface(live, PAINTED_LOOK) <= 0.4; k += 1) {
      live = { x: 0.5 + (k % 128) * 2, y: 0.5 + Math.floor(k / 128) * 2 };
    }
    const surface = groundSurface(live, PAINTED_LOOK);
    expect(standingHeight(live, PAINTED_LOOK)).toBeCloseTo(surface, 9);
    const lowest = (actors: ActorMeshes): number => Math.min(...triangles(actors.bytes("heroSolid")).flat().map((p) => p[2]));
    const build = (look: Look): ActorMeshes => {
      const actors = new ActorMeshes(look);
      actors.build({ player: new HeroDriver({ ...live, turn: 0 }).player, elapsedMs: 0, yaw: 0, live, encounter: new EncounterSim() });
      return actors;
    };
    expect(lowest(build(PAINTED_LOOK)) - lowest(build(FLAT_LOOK))).toBeCloseTo(surface, 4);
  });

  it("builds a painted chunk the same every time, and not the flat one", () => {
    const one = buildChunk(2, 6, PAINTED_LOOK);
    const two = buildChunk(2, 6, PAINTED_LOOK);
    expect(one.ground).toEqual(two.ground);
    expect(one.solid).toEqual(two.solid);
    expect(one.ground).not.toEqual(buildChunk(2, 6).ground);
  });
});
