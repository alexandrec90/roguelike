/**
 * The shape rules the asset catalogue holds to.
 *
 * Split from `asset-registry.ts` when that file crossed the module size cap,
 * along the seam its own imports drew: the registry is *data*, and this is what
 * that data must be true of. Adding an asset still means adding an entry there
 * and nothing here - which is the whole point of keeping the two apart, because
 * the file an agent edits every week should not also be the file holding a
 * hundred lines of validation it never reads.
 *
 * Every rule here is one an eye cannot check. A palette swap aimed at a token
 * the sprite stopped using renders in the authored colour and looks *fine*; a
 * variant list that lost its authored entry silently makes the lab open on a
 * recolour. Both fail a test instead, which is the only reason they are found.
 */

import { rasterizeSprite } from "./pixel-art";
import {
  ASSET_REGISTRY,
  AUTHORED_VARIANT_ID,
  type AssetEntry,
  type PaletteVariant,
} from "./asset-registry";

/**
 * Every structural rule the catalogue holds to, as a list of problems.
 *
 * Returned rather than thrown so one test can report all of them at once; a
 * registry that fails five ways should not need five runs to find out.
 */
export function validateRegistry(registry: readonly AssetEntry[] = ASSET_REGISTRY): string[] {
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
