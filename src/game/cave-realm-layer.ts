/**
 * Caves, as the scene sees them: one object to step, ask and draw.
 *
 * It holds the realm (`realm.ts`) - outside, inside, or changing - and turns
 * it into what the frame needs:
 *
 * - **what the hero walks by**: the cave's walls inside (`cave-map.ts`), the
 *   overworld's lakes and landforms outside (`blocked`);
 * - **what the world is lit by**: the backdrop's ambient eased in, the sun's
 *   shadows and the cloud shadows eased out (`atmosphere`);
 * - **which of the scene's layers draw**: the overworld while less than half
 *   inside, the sky, lip and ground until wholly inside (`share`);
 * - **the cave itself**: the mouths on the overworld; inside, the cave's world
 *   through the treadmill (`cave-interior-layer.ts`) and its roof above the
 *   horizon line (`backdrop-layer.ts`), swept in by one mask.
 */

import type { Scene } from "../engine";

import type { Atmosphere } from "./atmosphere";
import { OUTDOORS } from "./backdrop";
import { BackdropLayer, type HorizonState } from "./backdrop-layer";
import type { LocalBounds } from "./camera";
import { CAVE_BACKDROP } from "./cave-backdrop";
import { CaveEntranceLayer } from "./cave-entrance-layer";
import { CaveInteriorLayer } from "./cave-interior-layer";
import { caveBlocked, caveMap, type CaveMap } from "./cave-map";
import type { Cave } from "./caves";
import type { FrameContext } from "./frame-context";
import { blockedGround } from "./lakes";
import type { PlanetPoint, PlanetPose } from "./planet";
import { CAVE, caveShare, OUTSIDE, stepRealm, type RealmState } from "./realm";

/** The render target, and the band above the horizon line the roof fills. */
export interface CaveScreen {
  readonly width: number;
  readonly height: number;
  readonly horizonY: number;
}

export class CaveRealm {
  private state: RealmState = OUTSIDE;
  /** The cave last stood in and its map: still drawn while it fades out on the way back to the sky. */
  private shown: { readonly cave: Cave; readonly map: CaveMap } | undefined;
  private readonly entrances = new CaveEntranceLayer();
  private readonly interior = new CaveInteriorLayer();
  private readonly backdrop = new BackdropLayer([CAVE_BACKDROP]);
  private nowMs = 0;

  create(scene: Scene, bounds: LocalBounds, screen: CaveScreen): void {
    this.entrances.create(scene, bounds);
    this.interior.create(scene, screen.width, screen.height);
    this.backdrop.create(scene, screen.width, screen.horizonY);
  }

  layout(bounds: LocalBounds): void {
    this.entrances.layout(bounds);
  }

  /** Go in or out if the hero, at his live pose, has just stepped into a mouth. */
  step(at: PlanetPose, nowMs: number): void {
    this.nowMs = nowMs;
    this.state = stepRealm(this.state, at, nowMs);
    const cave = this.state.cave;
    if (cave !== undefined && this.shown?.cave !== cave) {
      this.shown = { cave, map: caveMap(cave) };
    }
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
  readonly blocked = (point: PlanetPoint): boolean => {
    const entry = this.state.entry;
    if (this.state.cave === undefined || this.shown === undefined || entry === undefined) {
      return blockedGround(point);
    }
    return caveBlocked(this.shown.map, entry, point);
  };

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

  /** Draw the mouths (outside), the cave's world and its roof (inside, or changing). */
  update(ctx: FrameContext, turn: number): void {
    const share = this.share();
    if (share < 0.5) {
      this.entrances.update(ctx);
    } else {
      this.entrances.hide();
    }
    const entry = this.state.entry;
    if (share > 0 && this.shown !== undefined && entry !== undefined) {
      this.interior.update(ctx, this.shown.map, entry, this.state.transition);
    } else {
      this.interior.hide();
    }
    this.backdrop.update(ctx, turn, this.horizon());
  }

  private horizon(): HorizonState {
    return { current: this.state.cave === undefined ? OUTDOORS : CAVE, transition: this.state.transition };
  }
}
