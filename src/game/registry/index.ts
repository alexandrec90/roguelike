/**
 * Every area's asset-lab entries, in one list for `asset-registry.ts`.
 *
 * Areas keep their own files so parallel work never shares one; this is the only
 * place that knows them all.
 */

import type { AssetEntry } from "../asset-types";
import { CREATURE_ASSETS } from "./creatures";
import { FIRE_ASSETS } from "./fire";
import { GROUND_ASSETS } from "./ground";
import { HERO_ASSETS } from "./hero";
import { SCENERY_ASSETS } from "./scenery";
import { WEATHER_ASSETS } from "./weather";

export const AREA_ASSETS: readonly AssetEntry[] = [
  ...HERO_ASSETS,
  ...CREATURE_ASSETS,
  ...FIRE_ASSETS,
  ...GROUND_ASSETS,
  ...SCENERY_ASSETS,
  ...WEATHER_ASSETS,
];
