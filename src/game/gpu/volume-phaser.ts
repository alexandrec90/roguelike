/**
 * A volume body as a Phaser `GameObjects.Shader`.
 *
 * This is the route the game takes. Phaser 4.2 creates a WebGL1 context by
 * default — which is where the first attempt at this stopped, because
 * `pixelHash` cannot be written in GLSL ES 1.00 — but it also accepts a context
 * you hand it (`game.config.context`), and given a WebGL2 one it compiles
 * `#version 300 es` through its own shader path perfectly well. So the body
 * draws inside Phaser's renderer rather than beside it.
 *
 * What that buys, over rendering in a second context and uploading the result:
 *
 * - **One context**, and no per-frame texture upload of the whole frame.
 * - **Per-body depth.** A shader body is an ordinary game object, so it takes a
 *   `setDepth` like everything else and interleaves with the hero for free. The
 *   texture-handoff version could not: one texture has one depth, so it needed
 *   two of them bracketing the hero, which was a workaround for a seam in the
 *   wrong place.
 * - Phaser's camera, scroll factor and blend modes, already written.
 *
 * The quad is a **fixed rectangle** — the species' footprint — rather than one
 * resized per frame to the body's box. The body's real box goes across as
 * `u_clipRect`, which the shader uses both to discard and to normalise the flat
 * light, so a fixed quad lights and clips exactly as the CPU's tight box does.
 * The cost is scanning a few hundred fragments of empty quad, which on a GPU is
 * not measurable; the benefit is that nothing resizes while the wind blows.
 */

import Phaser from "phaser";

import type { VolumePart } from "../scenery";
import { volumeBox, type Box } from "../procgen/volume";
import {
  activeUniformName,
  burnUniforms,
  shadowBox,
  volumeUniforms,
  withQuad,
  type VolumeShadow,
} from "./volume-uniforms";
import { VOLUME_FRAGMENT_SHADER, VOLUME_PHASER_VERTEX_SHADER } from "./volume-shader";

export interface Quad {
  /** Cloud coordinate of the quad's top-left, relative to the body's foot. */
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

export interface VolumeShaderSource {
  /** The part to draw right now, or null to draw nothing this frame. */
  readonly part: () => VolumePart | null;
  /** When present, the object draws the body's shadow instead of the body. */
  readonly shadow?: () => VolumeShadow | null;
}

/**
 * Build the config for one shader game object.
 *
 * `setupUniforms` runs per render, so it reads the species' current pose rather
 * than a snapshot — the same closure serves a body that is swaying, burning, or
 * standing still.
 */
export function volumeShaderConfig(
  name: string,
  quad: Quad,
  source: VolumeShaderSource,
): Phaser.Types.GameObjects.Shader.ShaderQuadConfig {
  return {
    name,
    fragmentSource: VOLUME_FRAGMENT_SHADER,
    vertexSource: VOLUME_PHASER_VERTEX_SHADER,
    setupUniforms: (setUniform: (uniform: string, value: unknown) => void) => {
      const part = source.part();
      if (part === null) {
        // Nothing to draw: a body with no lobes discards every fragment, which
        // is cheaper and simpler than toggling the object's visibility from
        // inside a render callback.
        setUniform("u_lobeCount", 0);
        return;
      }
      for (const [uniform, value] of Object.entries(uniformsFor(part, quad, source))) {
        setUniform(activeUniformName(uniform), value);
      }
    },
  };
}

function uniformsFor(
  part: VolumePart,
  quad: Quad,
  source: VolumeShaderSource,
): Record<string, unknown> {
  const shadow = source.shadow?.() ?? null;
  const box: Box =
    shadow === null ? { ...volumeBox(part.spec), ...part.clip } : shadowBox(part.spec, shadow);
  const burn =
    part.burn === undefined
      ? undefined
      : burnUniforms(part.burn.grid, part.burn.elapsedMs, part.burn.seed);

  return withQuad(
    volumeUniforms(part.spec, part.light, box, shadow ?? undefined, burn),
    quad,
  ) as unknown as Record<string, unknown>;
}
