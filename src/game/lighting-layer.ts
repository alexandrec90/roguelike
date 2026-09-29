/**
 * The light pass: the world multiplied by the sky, plus every flame's pool.
 *
 * One render texture the size of the target, drawn over the whole world with a
 * MULTIPLY blend. Each frame it is filled with the atmosphere's ambient colour —
 * white at noon (and then skipped entirely), amber at sunset, moonlit blue at
 * night — and every `LightSource` the layers pushed this frame is stamped into
 * it additively as a baked, banded, dithered pool. So `final = albedo × (ambient
 * + lights)`: a campfire lifts exactly the grass around it out of the night,
 * warm, and leaves the rest of the field blue.
 *
 * Because it multiplies, a light can only reveal what is there; nothing drawn
 * here invents colour. The flames themselves stay bright at night for the same
 * reason — a fire stands at the centre of its own pool, where the pass is white.
 *
 * A second, much fainter additive layer puts a halo round each light, which is
 * what makes a fire read as *glowing* against the dark rather than merely lit.
 *
 * Pools are baked per radius bucket (`lights.ts` `lightFalloff`), never scaled
 * at draw time, so the dither in them stays locked to the pixel grid.
 */

import Phaser from "phaser";

import { CLOUD_TILE_HEIGHT, cloudShadowTile, tileOrigins } from "./cloud-shadow";
import { hexToInt, mixHex } from "./color";
import { MAX_SHAKE } from "./impulse";
import { lightPool, type LightSource } from "./lights";
import { installBuffer } from "./pixel-surface";

/** Over everything in the world, under the weather's flash and the debug map. */
export const LIGHTING_DEPTH = 4500;
export const GLOW_DEPTH = 4550;

/** Pixels of pass beyond each edge of the target: at least the largest shake. */
const MARGIN = MAX_SHAKE;

/** Pools are baked at radii rounded up to this step. */
const RADIUS_STEP = 8;

/** How bright a light's halo is against the dark, at most. */
const GLOW_STRENGTH = 0.28;

const CLOUD_KEY = "cloud-shadow";

/** What the pass is asked to show this frame. */
export interface LightingFrame {
  /** The atmosphere's multiply colour. */
  readonly ambient: string;
  readonly lights: readonly LightSource[];
  /** A lightning strike's share of full daylight, 0..1. */
  readonly flash: number;
  /** 1 - daylight: how much a light's halo shows. */
  readonly night: number;
  /** Cloud shadows: where the tile has drifted to, and how dark they fall. */
  readonly clouds: { readonly x: number; readonly y: number; readonly strength: number };
  /** Scanlines of sky at the top: never shaded by a cloud. */
  readonly skyRows: number;
}

export class LightingLayer {
  private scene!: Phaser.Scene;
  private shade!: Phaser.GameObjects.RenderTexture;
  private glow!: Phaser.GameObjects.RenderTexture;
  private readonly baked = new Set<number>();

  create(scene: Phaser.Scene, width: number, height: number): void {
    this.scene = scene;
    installBuffer(scene.textures, CLOUD_KEY, cloudShadowTile(0xc1d5));
    // A margin all round, so a camera shake never slides an unlit strip of
    // the world out from under the pass.
    this.shade = scene.add
      .renderTexture(-MARGIN, -MARGIN, width + MARGIN * 2, height + MARGIN * 2)
      .setOrigin(0, 0)
      .setDepth(LIGHTING_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.glow = scene.add
      .renderTexture(-MARGIN, -MARGIN, width + MARGIN * 2, height + MARGIN * 2)
      .setOrigin(0, 0)
      .setDepth(GLOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  /** Light one frame: ambient, then cloud shade, then every light's pool. */
  draw(frame: LightingFrame): void {
    const { lights, night } = frame;
    const lit = frame.flash > 0 ? mixHex(frame.ambient, "#ffffff", Math.min(frame.flash, 1)) : frame.ambient;
    const clouded = frame.clouds.strength > 0.02;
    const plainDay = lit.toLowerCase() === "#ffffff" && lights.length === 0 && !clouded;
    this.shade.setVisible(!plainDay);
    if (!plainDay) {
      this.shade.clear();
      this.shade.fill(hexToInt(lit), 1);
      if (clouded) {
        this.cloudShade(frame, hexToInt(lit));
      }
      for (const light of lights) {
        this.stamp(this.shade, light, light.radius, Math.min(light.intensity, 1.5) * 0.85);
      }
      this.shade.render();
    }

    const haloes = lights.length > 0 && night > 0.05;
    this.glow.setVisible(haloes);
    if (haloes) {
      this.glow.clear();
      for (const light of lights) {
        const strength = GLOW_STRENGTH * night * Math.min(light.intensity, 1.2);
        this.stamp(this.glow, light, light.radius * 0.45, strength);
      }
      this.glow.render();
    }
  }

  /**
   * Multiply the drifting cloud tile over the ground, then paint the sky rows
   * back to plain ambient: a cloud's shadow falls on the field, not on the sky.
   */
  private cloudShade(frame: LightingFrame, ambient: number): void {
    const width = this.shade.width;
    const height = this.shade.height;
    for (const origin of tileOrigins(frame.clouds.x, frame.clouds.y, width, height + CLOUD_TILE_HEIGHT)) {
      this.shade.stamp(CLOUD_KEY, undefined, origin.x, origin.y, {
        originX: 0,
        originY: 0,
        alpha: Math.min(frame.clouds.strength, 1),
        blendMode: Phaser.BlendModes.MULTIPLY,
      });
    }
    this.shade.fill(ambient, 1, 0, 0, width, frame.skyRows + MARGIN);
  }

  private stamp(
    target: Phaser.GameObjects.RenderTexture,
    light: LightSource,
    radius: number,
    alpha: number,
  ): void {
    if (alpha <= 0.01 || radius < 2) {
      return;
    }
    const bucket = Math.max(RADIUS_STEP, Math.ceil(radius / RADIUS_STEP) * RADIUS_STEP);
    const key = this.poolKey(bucket);
    target.stamp(key, undefined, Math.round(light.x) + MARGIN, Math.round(light.y) + MARGIN, {
      tint: hexToInt(light.color),
      alpha: Math.min(alpha, 1),
      blendMode: Phaser.BlendModes.ADD,
    });
  }

  private poolKey(radius: number): string {
    const key = `light-pool-${radius}`;
    if (!this.baked.has(radius)) {
      installBuffer(this.scene.textures, key, lightPool(radius));
      this.baked.add(radius);
    }
    return key;
  }
}
