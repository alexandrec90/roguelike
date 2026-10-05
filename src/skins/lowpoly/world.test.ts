import { describe, expect, it } from "vitest";

import { planetLandforms } from "../../game/landforms";
import { PLACED_SPECIES } from "../../game/scenery-features";
import { PLANET_TILES } from "../../game/planet";
import { heroHeight } from "../../game/hero-layer";
import { HERO_EQUIPPED, SWING, SWING_BEATS } from "../../game/models";
import { EncounterSim } from "../../game/encounter-sim";
import { HeroDriver } from "../../game/hero/hero-driver";
import { bladeSweep } from "../../game/hero/swing-trail";
import { ACTOR_MESH_KEYS, ActorMeshes } from "./actor-frame";
import { nearestFirst } from "./lowpoly-game";
import { heroHeightPx, heroMesh, swingTrailMesh } from "./hero-mesh";
import { Kind, MeshBuilder, VERTEX_BYTES } from "./mesh";
import { lightDirection } from "./sky-light";
import { MESHED_SPECIES } from "./scenery-mesh";
import { WORLD_FRAGMENT, WORLD_VERTEX } from "./shaders";
import { landformStep } from "./terrain-mesh";
import { buildChunk, chunkOffset, CHUNK_TILES, CHUNKS_PER_SIDE } from "./world-chunks";

describe("the planet in chunks", () => {
  it("builds the same chunk every time, and every chunk has ground", () => {
    const one = buildChunk(3, 5);
    const two = buildChunk(3, 5);
    expect(one.solid).toEqual(two.solid);
    expect(one.ground).toEqual(two.ground);
    // Two flat triangles a tile, kept apart from what stands so the mirror never draws them.
    expect(one.ground.byteLength / VERTEX_BYTES).toBe(CHUNK_TILES * CHUNK_TILES * 2 * 3);
  });

  it("draws each chunk at its image nearest the hero, round the wrap", () => {
    const chunk = { origin: { x: 224, y: 0 } };
    expect(chunkOffset(chunk, { x: 8, y: 8 })).toEqual({ x: -40, y: -8 });
    expect(chunkOffset(chunk, { x: 230, y: 8 })).toEqual({ x: -6, y: -8 });
    for (const hero of [{ x: 0, y: 0 }, { x: 255.5, y: 128 }]) {
      const offset = chunkOffset(chunk, hero);
      expect(Math.abs(offset.x + CHUNK_TILES / 2)).toBeLessThanOrEqual(PLANET_TILES / 2);
    }
  });

  it("builds every chunk once, nearest the hero first", () => {
    const order = nearestFirst({ x: 140, y: 140 });
    expect(order).toHaveLength(CHUNKS_PER_SIDE * CHUNKS_PER_SIDE);
    expect(new Set(order.map(({ cx, cy }) => `${cx},${cy}`)).size).toBe(order.length);
    expect(order[0]).toEqual({ cx: 4, cy: 4 });
  });

  it("has a body for every species the planet places", () => {
    for (const species of PLACED_SPECIES) {
      expect(MESHED_SPECIES).toContain(species);
    }
  });

  it("meshes every landform coarse enough to be low poly and fine enough for a tower's walls", () => {
    for (const landform of planetLandforms()) {
      const step = landformStep(landform);
      expect(step).toBeGreaterThanOrEqual(0.3);
      expect(step).toBeLessThanOrEqual(landform.radius / 2);
    }
  });
});

describe("the low-poly hero", () => {
  it("stands as tall as the pixel skin's, so both centre him alike", () => {
    expect(Math.abs(heroHeightPx() - heroHeight())).toBeLessThanOrEqual(3);
  });

  it("turns with his yaw: the same rig, not another model", () => {
    const front = new MeshBuilder();
    const back = new MeshBuilder();
    heroMesh(front, HERO_EQUIPPED.basePose, { yaw: 0, enchanted: false, sunk: 0 });
    heroMesh(back, HERO_EQUIPPED.basePose, { yaw: Math.PI, enchanted: false, sunk: 0 });
    expect(front.vertexCount).toBeGreaterThan(300);
    expect(back.vertexCount).toBe(front.vertexCount);
    expect(back.bytesView()).not.toEqual(front.bytesView());
  });
});

describe("the frame's moving meshes", () => {
  it("builds the hero solid with his shadow, and nothing for actors that are not there", () => {
    const actors = new ActorMeshes();
    const hero = new HeroDriver({ x: 128, y: 128, turn: 0 });
    actors.build({ player: hero.player, elapsedMs: 0, yaw: 0, live: { x: 128, y: 128 }, encounter: new EncounterSim() });
    expect(ACTOR_MESH_KEYS).toHaveLength(4);
    expect(actors.bytes("heroSolid").byteLength).toBeGreaterThan(0);
    expect(actors.bytes("heroSheer").byteLength).toBeGreaterThan(0);
    expect(actors.bytes("actorSolid").byteLength).toBe(0);
  });

  it("leaves a trail through the air mid-swing, and none at rest", () => {
    const actors = new ActorMeshes();
    const hero = new HeroDriver({ x: 128, y: 128, turn: 0 });
    const build = (attackMs: number | undefined) => {
      actors.build({ player: { ...hero.player, attackMs }, elapsedMs: 0, yaw: 0, live: { x: 128, y: 128 }, encounter: new EncounterSim() });
      return actors.bytes("heroSheer").byteLength;
    };
    const resting = build(undefined);
    const swinging = build(Math.round(SWING_BEATS.contact * SWING.durationMs));
    expect(swinging).toBeGreaterThan(resting);
  });
});

describe("the swing's trail", () => {
  const sweep = bladeSweep(Math.round(SWING_BEATS.contact * SWING.durationMs), HERO_EQUIPPED.basePose);

  it("is one sheer, glowing strip between each pair of blade samples", () => {
    const b = new MeshBuilder();
    swingTrailMesh(b, sweep, { enchanted: false, sunk: 0 });
    expect(b.vertexCount).toBe((sweep.length - 1) * 6);
    const bytes = b.bytesView();
    for (let vertex = 0; vertex < b.vertexCount; vertex += 1) {
      expect(bytes[vertex * VERTEX_BYTES + 23]).toBe(Kind.glow);
      expect(bytes[vertex * VERTEX_BYTES + 27]).toBeLessThan(255);
    }
  });

  it("fades toward its tail", () => {
    const b = new MeshBuilder();
    swingTrailMesh(b, sweep, { enchanted: false, sunk: 0 });
    const alpha = (strip: number) => b.bytesView()[strip * 6 * VERTEX_BYTES + 27]!;
    expect(alpha(0)).toBeGreaterThan(alpha(sweep.length - 2));
  });

  it("burns when the blade does", () => {
    const steel = new MeshBuilder();
    const fire = new MeshBuilder();
    swingTrailMesh(steel, sweep, { enchanted: false, sunk: 0 });
    swingTrailMesh(fire, sweep, { enchanted: true, sunk: 0 });
    expect(fire.bytesView()).not.toEqual(steel.bytesView());
  });

  it("draws nothing from fewer than two samples", () => {
    const b = new MeshBuilder();
    swingTrailMesh(b, sweep.slice(0, 1), { enchanted: false, sunk: 0 });
    expect(b.vertexCount).toBe(0);
  });
});

describe("the shaders and the light", () => {
  it("bake the horizon's constants in, and treat what lies on the ground apart", () => {
    expect(WORLD_VERTEX).toContain("const float ROLL_ROWS = 48.0;");
    expect(WORLD_VERTEX).toContain("const float TILE_DEPTH = 12.0;");
    expect(WORLD_FRAGMENT).toContain("discard");
  });

  it("lights from the atmosphere's screen direction: left light, lit from the left, always from above", () => {
    const [x, , z] = lightDirection({ light: { x: -0.6, y: -0.8 }, elevation: 0.7 });
    expect(x).toBeLessThan(0);
    expect(z).toBeGreaterThan(0);
    const unit = lightDirection({ light: { x: 0.3, y: -0.9 }, elevation: 0.15 });
    expect(Math.hypot(...unit)).toBeCloseTo(1, 9);
  });
});
