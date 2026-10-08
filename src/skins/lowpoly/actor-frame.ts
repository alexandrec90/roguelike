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
import { easeYaw } from "../../game/hero/turn";
import { wadeDepth } from "../../game/lakes";
import type { PlanetPoint } from "../../game/planet";
import type { PlayerState } from "../../game/player";
import { burstMesh, fireballMesh } from "./actor-mesh";
import { heroMesh, swingTrailMesh } from "./hero-mesh";
import { looseSkeleton } from "./hero-sway";
import { MeshBuilder } from "./mesh";
import { shadowUnder } from "./scenery-mesh";
import { slimeGaze, slimeMesh } from "./slime-mesh";
import { standingHeight } from "./terrain-mesh";

/** How far into a lake the hero's shins go, tiles, at the edge of the deep water. */
const WADE_SINK = 0.4;

/** The hero's contact shadow, tiles across. */
const HERO_SHADOW = 0.32;

/** How long a slime's eyes take to swing round to a new gaze, ms: a glance, not a cut. */
const GAZE_EASE_MS = 90;

export interface ActorInput {
  readonly player: PlayerState;
  readonly elapsedMs: number;
  /** The yaw his rig is drawn at: facing, eased (`easeYaw`). */
  readonly yaw: number;
  /** His live planet point - what the actors are placed relative to. */
  readonly live: PlanetPoint;
  /** The world's turn this frame - what the actors' meshes are drawn rotated by. */
  readonly turn: number;
  readonly encounter: EncounterSim;
  /** Cast shadows and the swing's trail, each left unbuilt when off (`?off=`); both when absent. */
  readonly shows?: { readonly shadows: boolean; readonly trail: boolean };
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
  /** Each slime's drawn gaze, by id, chasing `slimeGaze`. Presentation only. */
  private readonly gazes = new Map<number, number>();
  private lastMs: number | undefined;

  /** Rebuild all four for this frame. */
  build(input: ActorInput): void {
    const b = this.builders;
    for (const key of ACTOR_MESH_KEYS) {
      b[key].reset();
    }
    const { player, live, encounter } = input;
    const shows = input.shows ?? { shadows: true, trail: true };
    const ground = standingHeight(live);
    const tracks = tracksOf(player, input.elapsedMs);
    const stance = { enchanted: player.enchanted, sunk: wadeDepth(live) * WADE_SINK, ground };
    heroMesh(b.heroSolid, looseSkeleton(layeredPose(tracks), tracks), { yaw: input.yaw, ...stance });
    if (shows.shadows) {
      shadowUnder(b.heroSheer, [0, 0, ground], HERO_SHADOW);
    }
    if (player.attackMs !== undefined && shows.trail) {
      const sweep = bladeSweep(player.attackMs, layeredPose({ ...tracks, swingMs: undefined }), { yaw: input.yaw });
      swingTrailMesh(b.heroSheer, sweep, stance);
    }
    const deltaMs = input.elapsedMs - (this.lastMs ?? input.elapsedMs);
    this.lastMs = input.elapsedMs;
    const seen = new Set<number>();
    for (const slime of encounter.slimes.slimes) {
      const target = slimeGaze(slime, live);
      const gaze = easeYaw(this.gazes.get(slime.id) ?? target, target, deltaMs, GAZE_EASE_MS);
      this.gazes.set(slime.id, gaze);
      seen.add(slime.id);
      slimeMesh(b.actorSolid, b.actorSheer, slime, live, { elapsedMs: input.elapsedMs, turn: input.turn, gaze, shadow: shows.shadows });
    }
    for (const id of this.gazes.keys()) {
      if (!seen.has(id)) {
        this.gazes.delete(id);
      }
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
