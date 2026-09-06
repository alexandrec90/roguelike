/**
 * Props: everything that is scenery and is not a tree.
 *
 * Kept beside `trees/` rather than inside it because they are peers — both
 * implement `ScenerySpecies`, both are staged, lit, shadowed, reflected and
 * burnt by the same code — and because the split is the evidence that the
 * chestnut's mechanism generalised. A boulder, a bush and a mushroom ring were
 * about forty lines each once `procgen/volume.ts` existed.
 */

import type { ScenerySpecies } from "../scenery";
import { BOULDER } from "./boulder";
import { BUSH } from "./bush";
import { MUSHROOM_RING } from "./mushroom";

export const PROP_SPECIES: readonly ScenerySpecies[] = [BOULDER, BUSH, MUSHROOM_RING];

export { BOULDER, BUSH, MUSHROOM_RING };
export type { BushInstance } from "./bush";
