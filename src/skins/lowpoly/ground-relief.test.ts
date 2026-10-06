import { describe, expect, it } from "vitest";

import { EncounterSim } from "../../game/encounter-sim";
import { HeroDriver } from "../../game/hero/hero-driver";
import { lakeDistance, planetLakes } from "../../game/lakes";
import { planetLandforms } from "../../game/landforms";
import { PLANET_TILES, wrapDelta, type PlanetPoint } from "../../game/planet";
import { terrainAt } from "../../game/terrain";
import { basinAt } from "../../game/water/puddle-field";
import { ActorMeshes } from "./actor-frame";
import { groundSurface, groundVertex, SHORE } from "./ground-relief";
import { FLAT_LOOK, PAINTED_LOOK } from "./look";
import { MeshBuilder, VERTEX_BYTES } from "./mesh";
import { groundMesh, standingHeight } from "./terrain-mesh";
import { buildChunk, CHUNK_TILES } from "./world-chunks";

/**
 * The oracle: `groundMesh` built round `point` and probed straight down. Slow
 * and independent of `groundSurface`, so the two agreeing means a foot stands
 * on what is drawn.
 */
function drawnGround(point: PlanetPoint): number {
  const origin = { x: Math.floor(point.x) - 2, y: Math.floor(point.y) - 2 };
  const b = new MeshBuilder();
  groundMesh(b, origin, 5, [], PAINTED_LOOK);
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i: number) => [0, 4, 8].map((o) => view.getFloat32(i * VERTEX_BYTES + o, true)) as [number, number, number];
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  for (let t = 0; t < b.vertexCount; t += 3) {
    const [p, q, r] = [at(t), at(t + 1), at(t + 2)];
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

/** Lattice points over a stretch of the planet, every `step` tiles. */
function lattice(step: number): PlanetPoint[] {
  const count = PLANET_TILES / step;
  return Array.from({ length: count * count }, (_, i) => ({ x: (i % count) * step, y: Math.floor(i / count) * step }));
}

const ORIGIN = { x: 0, y: 0 };

describe("the flat look's ground", () => {
  it("is level under a foot, with only a hair of relief between", () => {
    for (const point of lattice(16)) {
      expect(groundSurface(point, FLAT_LOOK)).toBe(0);
      expect(Math.abs(groundVertex(point.x, point.y, ORIGIN, FLAT_LOOK)[2])).toBeLessThanOrEqual(FLAT_LOOK.relief);
    }
  });
});

describe("the painted look's hills", () => {
  const points = lattice(2);
  const heights = points.map((p) => groundVertex(p.x, p.y, ORIGIN, PAINTED_LOOK)[2]);

  it("rise to most of their height somewhere, and never past it", () => {
    expect(Math.max(...heights)).toBeGreaterThan(PAINTED_LOOK.hills * 0.6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(PAINTED_LOOK.hills + PAINTED_LOOK.relief);
    // Rolling, not a plateau: a good share of the land is well up off level.
    expect(heights.filter((h) => h > 0.2).length).toBeGreaterThan(points.length * 0.2);
  });

  it("lie dead level wherever a puddle can stand, so the water's mirror at height 0 is true", () => {
    let wet = 0;
    points.forEach((p, i) => {
      if (basinAt(p, terrainAt(p) === "dirt") >= 0.58) {
        wet += 1;
        expect(heights[i]).toBe(0);
      }
    });
    expect(wet).toBeGreaterThan(100);
  });

  it("lie level on a lake's shore and round a landform's foot", () => {
    points.forEach((p, i) => {
      for (const lake of planetLakes()) {
        if (lakeDistance(lake, p) <= lake.reach + SHORE) {
          expect(heights[i]).toBe(0);
        }
      }
      for (const landform of planetLandforms()) {
        if (Math.hypot(wrapDelta(p.x, landform.x), wrapDelta(p.y, landform.y)) <= landform.radius + 2) {
          expect(heights[i]).toBe(0);
        }
      }
    });
  });

  it("close round the planet's seam: a lattice point is the same vertex a lap on", () => {
    for (const y of [0, 37, 128, 255]) {
      const here = groundVertex(0, y, ORIGIN, PAINTED_LOOK);
      const lap = groundVertex(PLANET_TILES, y, { x: PLANET_TILES, y: 0 }, PAINTED_LOOK);
      expect(lap).toEqual(here);
    }
  });

  it("hand a foot the height of the very triangle drawn under it", () => {
    let raised = 0;
    for (let k = 0; k < 120; k += 1) {
      const point = { x: 17.37 + k * 1.913, y: 41.11 + ((k * 7.31) % 150) };
      const drawn = drawnGround(point);
      expect(groundSurface(point, PAINTED_LOOK)).toBeCloseTo(drawn, 5);
      raised += drawn > 0.15 ? 1 : 0;
    }
    expect(raised).toBeGreaterThan(10);
  });

  it("stand the hero, and a tree, on the hill", () => {
    const point = lattice(2).find((p) => groundSurface({ x: p.x + 0.5, y: p.y + 0.5 }, PAINTED_LOOK) > 0.4)!;
    const live = { x: point.x + 0.5, y: point.y + 0.5 };
    const surface = groundSurface(live, PAINTED_LOOK);
    expect(standingHeight(live, PAINTED_LOOK)).toBeCloseTo(surface, 9);
    const lowest = (actors: ActorMeshes): number => {
      const bytes = actors.bytes("heroSolid");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Math.min(...Array.from({ length: bytes.byteLength / VERTEX_BYTES }, (_, i) => view.getFloat32(i * VERTEX_BYTES + 8, true)));
    };
    const build = (look: typeof FLAT_LOOK): ActorMeshes => {
      const actors = new ActorMeshes(look);
      actors.build({ player: new HeroDriver({ ...live, turn: 0 }).player, elapsedMs: 0, yaw: 0, live, encounter: new EncounterSim() });
      return actors;
    };
    expect(lowest(build(PAINTED_LOOK)) - lowest(build(FLAT_LOOK))).toBeCloseTo(surface, 4);
  });

  it("build a painted chunk the same every time, and still two triangles a tile", () => {
    const one = buildChunk(2, 6, PAINTED_LOOK);
    const two = buildChunk(2, 6, PAINTED_LOOK);
    expect(one.ground).toEqual(two.ground);
    expect(one.solid).toEqual(two.solid);
    expect(one.ground.byteLength / VERTEX_BYTES).toBe(CHUNK_TILES * CHUNK_TILES * 2 * 3);
    expect(one.ground).not.toEqual(buildChunk(2, 6).ground);
  });
});
