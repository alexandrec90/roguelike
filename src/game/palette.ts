/**
 * The full-colour palette: material families, each an ordered ramp.
 *
 * The first art direction was a one-bit neon field — twelve inks on pitch black —
 * and it was lifted deliberately: the procedural mechanisms (volumes lit from
 * their own normals, noise, dithered light) can carry a much richer picture than
 * twelve colours let them show. What survives from it is the part that was
 * actually doing the work: **every colour is still a named ink from a closed
 * set**, so an asset picks `grass-3` rather than inventing `#3a7031`, and the
 * scene cannot drift off-palette one asset at a time.
 *
 * A family is a *material*, and its entries are a ramp, darkest first. Ramps are
 * hue-shifted the way painted pixel art is — shadows fall toward blue and
 * violet, highlights climb toward yellow — because a ramp that only changes
 * value reads as grey plastic, and one that also changes hue reads as light.
 *
 * Families are data rather than a union written out by hand: `InkId` is derived
 * from this table, so adding a step to a ramp is one hex in one place and the
 * type, the token table and `INK_RAMPS` all follow.
 */

/** Every material ramp, darkest first. Index `n` of family `f` is the ink `f-n`. */
export const INK_FAMILIES = {
  /** Field grass: the ground's own green, cool in the roots and warm at the tips. */
  grass: ["#13261f", "#1b3a25", "#26542b", "#3a7031", "#5a8f37", "#8bb04a"],
  /** Sunlit meadow tips and dry blades — the grass ramp's warm continuation. */
  meadow: ["#4b7a2f", "#6e9a38", "#97b845", "#c2d05e", "#e6e592"],
  /** Broadleaf canopy: bluer in the shade than grass, yellower where the sun lands. */
  leaf: ["#10251f", "#1b3d2b", "#285a30", "#3c7a35", "#5f9e3d", "#9ac858"],
  /** Conifer needles: darker and bluer than any broadleaf. */
  pine: ["#0c1d20", "#133530", "#1e4d39", "#2d6a41", "#4a8c4c"],
  autumn: ["#3a1a14", "#6b2c17", "#a8481d", "#d8752a", "#f1b04a"],
  bark: ["#1b1313", "#2f201b", "#472f22", "#62432d", "#82603f"],
  /** Trodden earth and path dust. */
  earth: ["#241915", "#36261c", "#4d3825", "#665033", "#836a45", "#a78b5f"],
  stone: ["#15161d", "#23252e", "#353946", "#4d5361", "#6c7382", "#9aa0ab"],
  moss: ["#1c3021", "#2a4726", "#40652b", "#648a38"],
  water: ["#0a1628", "#0f2440", "#16385c", "#1f5379", "#347a9c", "#6fb0c8"],
  /** Flame, from the red of a dying coal to the near-white of the hottest core. */
  fire: ["#2a0a08", "#5c130e", "#9a2410", "#d4441a", "#f2782a", "#ffb445", "#ffe596"],
  /** Smoke and ash. Sheer: see `FAMILY_ALPHA`. */
  smoke: ["#151417", "#29262b", "#3f3b42", "#5d5862"],
  skin: ["#4a2a22", "#7e4a37", "#b87a5c", "#e2ae8c"],
  hair: ["#22130f", "#3f2216", "#62361f"],
  /** The hero's tunic: a blue that no grass or leaf ink can be mistaken for. */
  tunic: ["#182040", "#25346a", "#34509a", "#5274c2"],
  leather: ["#24160f", "#3f2718", "#5e3d24", "#825a36"],
  crimson: ["#330c14", "#5f1520", "#9a2630", "#cf4a45"],
  /** Forged steel: a blade, a buckle, a helm. */
  metal: ["#242a36", "#3e4758", "#66748a", "#9fadc0", "#e2eaf2"],
  gold: ["#402508", "#7a4c10", "#bd8423", "#f0c24a"],
  /** Slime jelly. The body steps are sheer, so the ground shows through it. */
  slime: ["#0d3131", "#15564a", "#1f8566", "#3fba85", "#9ce8b0"],
  arcane: ["#1a0e33", "#35195f", "#5a2ca0", "#8f55e0", "#cfaaff"],
  frost: ["#13283f", "#244d73", "#3f82b0", "#7cc0e2", "#d7f6ff"],
  /** Wildflowers: single accents, not a ramp — red, gold, white, blue, pink, violet. */
  petal: ["#d44550", "#efc440", "#ece9dc", "#6d8fe0", "#e48bb8", "#9a6fd6"],
} as const;

export type Family = keyof typeof INK_FAMILIES;

type TupleIndex<T extends readonly unknown[]> = Exclude<keyof T, keyof readonly unknown[]> & string;

/** `grass-0` … `grass-5`, `fire-0` … `fire-6`, and so on for every family. */
export type FamilyInk = {
  [F in Family]: `${F}-${TupleIndex<(typeof INK_FAMILIES)[F]>}`;
}[Family];

/**
 * Inks that are not steps of a material: cast shadow, water foam, the sky's
 * reflection in standing water.
 */
export const SINGLE_INKS = {
  /** A cast shadow. Sheer and cold, so it darkens whatever it falls on. */
  shadow: "#0b0c1a",
  /** The penumbra: a lighter shadow for soft edges and far-from-contact spread. */
  "shadow-soft": "#101226",
  foam: "#e2f3f5",
} as const;

export type SingleInk = keyof typeof SINGLE_INKS;

/**
 * Opacity per family, per step. A family absent here is opaque.
 *
 * Only materials that are genuinely sheer carry alpha: smoke, the body of a
 * slime, cast shadow. Everything else is solid, which keeps the look crisp.
 */
export const FAMILY_ALPHA: Partial<Record<Family, readonly number[]>> = {
  smoke: [0.55, 0.5, 0.45, 0.4],
  slime: [0.92, 0.84, 0.8, 0.86, 1],
};

export const SINGLE_ALPHA: Readonly<Record<SingleInk, number>> = {
  shadow: 0.46,
  "shadow-soft": 0.26,
  foam: 1,
};

/** Every family ink, in declaration order. */
export function familyInks(): FamilyInk[] {
  return (Object.keys(INK_FAMILIES) as Family[]).flatMap((family) =>
    INK_FAMILIES[family].map((_hex, index) => `${family}-${index}` as FamilyInk),
  );
}

/** A family's whole ramp, darkest first. */
export function familyRamp(family: Family): FamilyInk[] {
  return INK_FAMILIES[family].map((_hex, index) => `${family}-${index}` as FamilyInk);
}

/**
 * A contiguous slice of a family's ramp — `rampSlice("fire", 2, 5)` is the
 * orange middle of a flame without its dying coals or its white core.
 */
export function rampSlice(family: Family, from: number, to: number): FamilyInk[] {
  return familyRamp(family).slice(from, to + 1);
}

/** The hex of a family ink, without going through the whole ink table. */
export function familyHex(ink: FamilyInk): string {
  const cut = ink.lastIndexOf("-");
  const family = ink.slice(0, cut) as Family;
  const index = Number(ink.slice(cut + 1));
  const hex = (INK_FAMILIES[family] as readonly string[])[index];
  if (hex === undefined) {
    throw new Error(`No ink '${ink}' in the palette`);
  }
  return hex;
}
