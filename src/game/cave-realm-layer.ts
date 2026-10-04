/**
 * Caves, as the scene sees them: one object to step, ask and draw.
 *
 * It holds the realm (`realm.ts`) - outside, inside, or changing - and turns
 * it into what the frame needs:
 *
 * - **what the hero walks by**: the chamber's wall inside, the overworld's
 *   lakes and landforms outside (`blocked`);
 * - **what the world is lit by**: the backdrop's ambient eased in, the sun's
 *   shadows and the cloud shadows eased out (`atmosphere`);
 * - **which of the scene's layers draw**: the overworld while less than half
 *   inside, the sky, lip and ground until wholly inside (`share`);
 * - **the cave itself**: the mouths on the overworld, and inside, the floor
 *   and the band (`backdrop-layer.ts`), swept in by one mask.
 */

import type { Scene } from "../engine";

import type { Atmosphere } from "./atmosphere";
import { OUTDOORS } from "./backdrop";
import { BackdropLayer, type HorizonState } from "./backdrop-layer";
import type { CameraFrame, LocalBounds } from "./camera";
import { CAVE_BACKDROP } from "./cave-backdrop";
import { CaveEntranceLayer } from "./cave-entrance-layer";
import { CaveFloorLayer } from "./cave-floor-layer";
import { chamberBlocked, type Cave } from "./caves";
import type { FrameContext } from "./frame-context";
import { blockedGround } from "./lakes";
import type { PlanetPoint } from "./planet";
import { CAVE, caveShare, OUTSIDE, stepRealm, type RealmState } from "./realm";

export class CaveRealm {
  private state: RealmState = OUTSIDE;
  /** The cave last stood in: still drawn while its floor fades out on the way back to the sky. */
  private chamber: Cave | undefined;
  private readonly entrances = new CaveEntranceLayer();
  private readonly floor = new CaveFloorLayer();
  private readonly backdrop = new BackdropLayer([CAVE_BACKDROP]);
  private nowMs = 0;

  create(scene: Scene, frame: CameraFrame, bounds: LocalBounds, band: { width: number; height: number }): void {
    this.entrances.create(scene, bounds);
    this.floor.create(scene, frame, bounds);
    this.backdrop.create(scene, band.width, band.height);
  }

  layout(frame: CameraFrame, bounds: LocalBounds): void {
    this.entrances.layout(bounds);
    this.floor.layout(frame, bounds);
  }

  /** Go in or out if the hero has just stepped into a mouth. */
  step(at: PlanetPoint, nowMs: number): void {
    this.nowMs = nowMs;
    this.state = stepRealm(this.state, at, nowMs);
    this.chamber = this.state.cave ?? this.chamber;
  }

  /** 0 under the sky .. 1 in the cave. */
  share(): number {
    return caveShare(this.state, this.nowMs);
  }

  /** The cave he is in, or undefined under the sky - for a test, or a curious console. */
  inside(): Cave | undefined {
    return this.state.cave;
  }

  /** What stops the hero walking, wherever he is. Read at the call, so it follows him in and out. */
  readonly blocked = (point: PlanetPoint): boolean =>
    this.state.cave === undefined ? blockedGround(point) : chamberBlocked(this.state.cave, point);

  /** The hour's atmosphere, as it falls on the place he is in. */
  atmosphere(base: Atmosphere): Atmosphere {
    const share = this.share();
    if (share === 0) {
      return base;
    }
    return {
      ...base,
      ambient: this.backdrop.ambientFor(base.ambient, this.horizon(), this.nowMs),
      // Underground there is no sun to throw a shadow or a cloud's, and no day
      // for a light's halo to hide in.
      shadowStrength: base.shadowStrength * (1 - share),
      daylight: base.daylight * (1 - share),
    };
  }

  /** Draw the mouths (outside), the floor and the band (inside, or changing). */
  update(ctx: FrameContext, turn: number): void {
    const share = this.share();
    if (share < 0.5) {
      this.entrances.update(ctx);
    } else {
      this.entrances.hide();
    }
    if (share > 0 && this.chamber !== undefined) {
      this.floor.update(ctx, this.chamber, this.state.transition);
    } else {
      this.floor.hide();
    }
    this.backdrop.update(ctx, turn, this.horizon());
  }

  private horizon(): HorizonState {
    return { current: this.state.cave === undefined ? OUTDOORS : CAVE, transition: this.state.transition };
  }
}
