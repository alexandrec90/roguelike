/**
 * The structural rules the asset catalogue holds to.
 *
 * Kept apart from the catalogue itself because the two change for different
 * reasons and at different rates: entries are added weekly, rules almost never.
 * The rules are what turn "the palette variant silently did nothing" into a
 * failing test rather than a puzzling screenshot, so they are worth reading on
 * their own rather than at the bottom of four hundred lines of data.
 *
 * Problems are returned rather than thrown, so one test reports all of them at
 * once: a registry that is wrong five ways should not need five runs to say so.
 */

import { AUTHORED_VARIANT_ID, type AssetEntry, type PaletteVariant } from "./asset-types";
import { rasterizeSprite } from "./pixel-art";

export function validateRegistry(registry: readonly AssetEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const entry of registry) {
    if (seen.has(entry.id)) {
      problems.push(`Duplicate asset id '${entry.id}'`);
    }
    seen.add(entry.id);

    if (entry.frameDurationMs <= 0) {
      problems.push(`Asset '${entry.id}' has a non-positive frame duration`);
    }
    problems.push(...frameProblems(entry));
    problems.push(...variantProblems(entry));
  }

  return problems;
}

function frameProblems(entry: AssetEntry): string[] {
  const problems: string[] = [];
  if (entry.frames.length === 0) {
    problems.push(`Asset '${entry.id}' has no frames`);
    return problems;
  }

  const sizes = new Set<string>();
  entry.frames.forEach((frame, index) => {
    try {
      const raster = rasterizeSprite(frame);
      sizes.add(`${raster.width}x${raster.height}`);
    } catch (error) {
      problems.push(`Asset '${entry.id}' frame ${index} does not rasterize: ${String(error)}`);
    }
  });

  if (sizes.size > 1) {
    problems.push(`Asset '${entry.id}' mixes frame sizes: ${[...sizes].join(", ")}`);
  }
  return problems;
}

function variantProblems(entry: AssetEntry): string[] {
  const problems: string[] = [];
  const first = entry.variants[0];
  if (first === undefined) {
    problems.push(`Asset '${entry.id}' has no variants`);
    return problems;
  }
  if (first.id !== AUTHORED_VARIANT_ID) {
    problems.push(`Asset '${entry.id}' does not lead with the authored palette`);
  }

  const seen = new Set<string>();
  for (const variant of entry.variants) {
    if (seen.has(variant.id)) {
      problems.push(`Asset '${entry.id}' has duplicate variant '${variant.id}'`);
    }
    seen.add(variant.id);
    problems.push(...overrideProblems(entry, variant));
  }
  return problems;
}

function overrideProblems(entry: AssetEntry, variant: PaletteVariant): string[] {
  const problems: string[] = [];
  for (const token of Object.keys(variant.overrides)) {
    const missing = entry.frames.some((frame) => !(token in frame.palette));
    if (missing) {
      problems.push(`Asset '${entry.id}' variant '${variant.id}' targets unused token '${token}'`);
    }
  }
  return problems;
}
