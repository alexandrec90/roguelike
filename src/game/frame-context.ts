/**
 * Everything a layer is told about one frame, in one object.
 *
 * The scene builds this once per `update` and hands the same instance to every
 * layer, so the ground, the grass, the slimes and the fire cannot disagree
 * about where the world has got to, what time of day it is, or which way the
 * light is falling. A layer reads it and draws; the only things it may *write*
 * are the two outboxes — `lights` (what it illuminates) and `impulse` (how hard
 * it kicks the camera) — which the scene consumes after every layer has run.
 */

import type { Atmosphere } from "./atmosphere";
import type { CameraFrame } from "./camera";
import type { CloudShade } from "./cloud-shadow";
import type { ImpulseSink } from "./impulse";
import type { LightSource } from "./lights";
import type { PlanetPose } from "./planet";
import type { WindOptions } from "./wind";

export interface FrameContext {
  /** The camera this instant: where the hero is pinned and how far a step has slid. */
  readonly frame: CameraFrame;
  /** The pose the ground is sampled from — frozen for the length of a step. */
  readonly pose: PlanetPose;
  /** Play time, ms. Frozen while a hit stop holds. */
  readonly elapsedMs: number;
  /** This frame's (clamped, hit-stop-aware) delta, ms. */
  readonly deltaMs: number;
  readonly atmosphere: Atmosphere;
  readonly wind: WindOptions;
  /** 0..1: how hard it is raining. Wetness, splashes and darkening read it. */
  readonly rain: number;
  /**
   * The cloud shadow on the ground at a screen point. The ground has it from the
   * lighting pass; anything standing asks here and takes it as a tint.
   */
  readonly shade: CloudShade;
  /** Render-target size, logical pixels. */
  readonly width: number;
  readonly height: number;
  /** Push a light here and the lighting pass draws it this frame. */
  readonly lights: LightSource[];
  readonly impulse: ImpulseSink;
}

/**
 * A frame's context with a fresh, empty light outbox — the one way a frame is
 * started, so no layer ever pushes a light into last frame's list.
 */
export function beginFrame(fields: Omit<FrameContext, "lights">): FrameContext {
  return { ...fields, lights: [] };
}
