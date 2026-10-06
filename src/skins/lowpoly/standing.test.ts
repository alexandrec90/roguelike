import { describe, expect, it } from "vitest";

import { spawnSlime } from "../../game/creatures/slime-sim";
import { EncounterSim } from "../../game/encounter-sim";
import { HeroDriver } from "../../game/hero/hero-driver";
import { wadeDepth } from "../../game/lakes";
import { blockedByLand, planetLandforms, type Landform } from "../../game/landforms";
import { wrapDelta, wrapTile, type PlanetPoint } from "../../game/planet";
import { ActorMeshes, type ActorMeshKey } from "./actor-frame";
import { MeshBuilder, VERTEX_BYTES } from "./mesh";
import { landformMesh, standingHeight } from "./terrain-mesh";

/** Every vertex's height in a mesh, tiles. */
function heights(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / VERTEX_BYTES }, (_, i) => view.getFloat32(i * VERTEX_BYTES + 8, true));
}

/**
 * The oracle: the landform's drawn mesh, built round `point` and probed
 * straight down - the tallest triangle over it. Slow and independent of
 * `standingHeight`, so the two agreeing means the foot is on what is drawn.
 */
function drawnSurface(landform: Landform, point: PlanetPoint): number {
  const origin = { x: landform.x - wrapDelta(landform.x, point.x), y: landform.y - wrapDelta(landform.y, point.y) };
  const b = new MeshBuilder();
  landformMesh(b, landform, origin);
  const bytes = b.bytesView();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i: number) => [0, 4, 8].map((o) => view.getFloat32(i * VERTEX_BYTES + o, true)) as [number, number, number];
  let tallest = 0;
  for (let t = 0; t < b.vertexCount; t += 3) {
    const [p, q, r] = [at(t), at(t + 1), at(t + 2)];
    const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    const l1 = ((q[1] - r[1]) * (0 - r[0]) + (r[0] - q[0]) * (0 - r[1])) / det;
    const l2 = ((r[1] - p[1]) * (0 - r[0]) + (p[0] - r[0]) * (0 - r[1])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) {
      tallest = Math.max(tallest, l1 * p[2] + l2 * q[2] + l3 * r[2]);
    }
  }
  return tallest;
}

/** Points a walker can reach on a landform's lower slope: out from its centre to the first open ground, eight ways. */
function slopeFeet(): { landform: Landform; point: PlanetPoint }[] {
  return planetLandforms()
    .filter((landform) => landform.kind === "mountain")
    .slice(0, 3)
    .flatMap((landform) =>
      Array.from({ length: 8 }, (_, k) => {
        const angle = (k / 8) * Math.PI * 2 + 0.3;
        for (let d = 0; d < landform.radius + 3; d += 0.05) {
          const point = { x: wrapTile(landform.x + Math.cos(angle) * d), y: wrapTile(landform.y + Math.sin(angle) * d) };
          if (!blockedByLand(point) && d > landform.radius * 0.3) {
            return { landform, point };
          }
        }
        return null;
      }).filter((foot) => foot !== null && wadeDepth(foot.point) === 0) as { landform: Landform; point: PlanetPoint }[],
    );
}

function lowest(actors: ActorMeshes, key: ActorMeshKey): number {
  return Math.min(...heights(actors.bytes(key)));
}

function build(live: PlanetPoint, encounter = new EncounterSim()): ActorMeshes {
  const actors = new ActorMeshes();
  actors.build({ player: new HeroDriver({ ...live, turn: 0 }).player, elapsedMs: 0, yaw: 0, live, encounter });
  return actors;
}

describe("standing on the drawn land", () => {
  const feet = slopeFeet();

  it("finds walkable ground on a mountain's slope that the mesh draws raised", () => {
    expect(feet.length).toBeGreaterThan(8);
    expect(Math.max(...feet.map(({ landform, point }) => drawnSurface(landform, point)))).toBeGreaterThan(0.15);
  });

  it("reads the height of the drawn facets, not the field between them", () => {
    for (const { landform, point } of feet) {
      expect(standingHeight(point)).toBeCloseTo(drawnSurface(landform, point), 5);
    }
  });

  it("is nothing on open ground", () => {
    const clear = (point: PlanetPoint) =>
      planetLandforms().every((l) => Math.hypot(wrapDelta(point.x, l.x), wrapDelta(point.y, l.y)) > l.radius * 1.5 + 4);
    const open = Array.from({ length: 64 * 64 }, (_, i) => ({ x: (i % 64) * 4 + 0.5, y: Math.floor(i / 64) * 4 + 0.5 })).filter(clear);
    expect(open.length).toBeGreaterThan(20);
    for (const point of open.slice(0, 20)) {
      expect(standingHeight(point)).toBe(0);
    }
  });

  it("stands the hero and his shadow on the slope, not sunk to the shins in it", () => {
    const flat = build({ x: 0.5, y: 0.5 });
    const sole = lowest(flat, "heroSolid");
    for (const { landform, point } of feet) {
      const surface = drawnSurface(landform, point);
      const actors = build(point);
      expect(lowest(actors, "heroSolid") - sole).toBeCloseTo(surface, 4);
      expect(lowest(actors, "heroSheer")).toBeGreaterThanOrEqual(surface);
    }
  });

  it("stands a slime on the slope too", () => {
    const { landform, point } = feet.reduce((a, b) => (drawnSurface(b.landform, b.point) > drawnSurface(a.landform, a.point) ? b : a));
    const surface = drawnSurface(landform, point);
    const slimeAt = (at: PlanetPoint): ActorMeshes => {
      const encounter = new EncounterSim();
      spawnSlime(encounter.slimes, at, { seed: 7 });
      return build(at, encounter);
    };
    const flat = slimeAt({ x: 0.5, y: 0.5 });
    const actors = slimeAt(point);
    expect(surface).toBeGreaterThan(0.15);
    expect(lowest(actors, "actorSolid") - lowest(flat, "actorSolid")).toBeCloseTo(surface, 4);
    expect(lowest(actors, "actorSheer")).toBeGreaterThanOrEqual(surface);
  });
});
