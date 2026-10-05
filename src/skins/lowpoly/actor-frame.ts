/**
 * Everything that moves, as this frame's four meshes: the hero (built in his
 * own local frame, so he never turns with the world) and the actors round him
 * (slimes, fireballs, bursts, in the planet frame), each split into what is
 * solid and what is sheer. No GL: the frame hands the bytes to the renderer.
 */

import type { EncounterSim } from "../../game/encounter-sim";
import { layeredPose } from "../../game/hero/hero-figure";
import { tracksOf } from "../../game/hero/hero-look";
import { bladeSweep } from "../../game/hero/swing-trail";
import { wadeDepth } from "../../game/lakes";
import type { PlanetPoint } from "../../game/planet";
import type { PlayerState } from "../../game/player";
import { burstMesh, fireballMesh, slimeMesh } from "./actor-mesh";
import { heroMesh, swingTrailMesh } from "./hero-mesh";
import { MeshBuilder } from "./mesh";
import { shadowUnder } from "./scenery-mesh";

/** How far into a lake the hero's shins go, tiles, at the edge of the deep water. */
const WADE_SINK = 0.4;

/** The hero's contact shadow, tiles across. */
const HERO_SHADOW = 0.32;

export interface ActorInput {
  readonly player: PlayerState;
  readonly elapsedMs: number;
  /** The yaw his rig is drawn at: facing, eased (`easeYaw`). */
  readonly yaw: number;
  /** His live planet point - what the actors are placed relative to. */
  readonly live: PlanetPoint;
  readonly encounter: EncounterSim;
}

export type ActorMeshKey = "heroSolid" | "heroSheer" | "actorSolid" | "actorSheer";

export const ACTOR_MESH_KEYS: readonly ActorMeshKey[] = ["heroSolid", "heroSheer", "actorSolid", "actorSheer"];

export class ActorMeshes {
  private readonly builders: Readonly<Record<ActorMeshKey, MeshBuilder>> = {
    heroSolid: new MeshBuilder(),
    heroSheer: new MeshBuilder(),
    actorSolid: new MeshBuilder(),
    actorSheer: new MeshBuilder(),
  };

  /** Rebuild all four for this frame. */
  build(input: ActorInput): void {
    const b = this.builders;
    for (const key of ACTOR_MESH_KEYS) {
      b[key].reset();
    }
    const { player, live, encounter } = input;
    const tracks = tracksOf(player, input.elapsedMs);
    const sunk = wadeDepth(live) * WADE_SINK;
    heroMesh(b.heroSolid, layeredPose(tracks), { yaw: input.yaw, enchanted: player.enchanted, sunk });
    shadowUnder(b.heroSheer, [0, 0, 0], HERO_SHADOW);
    if (player.attackMs !== undefined) {
      const sweep = bladeSweep(player.attackMs, layeredPose({ ...tracks, swingMs: undefined }), { yaw: input.yaw });
      swingTrailMesh(b.heroSheer, sweep, { enchanted: player.enchanted, sunk });
    }
    for (const slime of encounter.slimes.slimes) {
      slimeMesh(b.actorSolid, b.actorSheer, slime, live);
    }
    for (const ball of encounter.fireballs) {
      fireballMesh(b.actorSheer, ball, live);
    }
    for (const burst of encounter.bursts) {
      burstMesh(b.actorSheer, burst, live);
    }
  }

  /** One mesh's bytes, as last built. */
  bytes(key: ActorMeshKey): Uint8Array {
    return this.builders[key].bytesView();
  }
}
