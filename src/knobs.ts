/**
 * Every address-bar knob, as a table the options panel draws.
 *
 * The knobs are still read where they always were - `scene-options.ts` for the
 * world, `skin.ts` for the skin, each skin's `mount` for its own - and a value
 * typed into the URL still works. This only names them, with the values worth
 * offering, so the panel (`options-panel.ts`) can show a control for each
 * instead of a player having to remember the spelling.
 *
 * A knob at its default is left out of the URL rather than written, so the
 * address a panel produces is the shortest one that means the same game.
 */

import { DEFAULT_SKIN, SKINS, type SkinId } from "./skins/skin";

export interface KnobOption {
  /** What goes in the URL; `""` is the knob left out. */
  readonly value: string;
  readonly label: string;
}

export type KnobControl =
  | { readonly kind: "select"; readonly options: readonly KnobOption[] }
  /** A checkbox: `checked` in the URL when ticked, `unchecked` when not. */
  | { readonly kind: "toggle"; readonly checked: string; readonly unchecked: string };

export type KnobGroup = "World" | "Rendering" | "Debug";

export interface Knob {
  readonly key: string;
  readonly label: string;
  readonly group: KnobGroup;
  /** The skins that read it; a knob the shown skin ignores is not offered. */
  readonly skins: readonly SkinId[];
  /** The value that means "as if absent": written by removing the key. */
  readonly fallback: string;
  readonly control: KnobControl;
  /** Another knob this one only matters under, as `[key, value]`. */
  readonly requires?: readonly [string, string];
}

const ALL_SKINS: readonly SkinId[] = SKINS.map((skin) => skin.id);

const HOURS: readonly KnobOption[] = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

export const KNOBS: readonly Knob[] = [
  {
    key: "skin",
    label: "Skin",
    group: "Rendering",
    skins: ALL_SKINS,
    fallback: DEFAULT_SKIN,
    control: { kind: "select", options: SKINS.map((s) => ({ value: s.id, label: s.label })) },
  },
  {
    key: "time",
    label: "Time",
    group: "World",
    skins: ALL_SKINS,
    fallback: "",
    control: { kind: "select", options: [{ value: "", label: "Clock runs" }, ...HOURS] },
  },
  {
    key: "day",
    label: "Day length",
    group: "World",
    skins: ALL_SKINS,
    fallback: "",
    requires: ["time", ""],
    control: {
      kind: "select",
      options: [
        { value: "", label: "20 min" },
        { value: "60", label: "1 min" },
        { value: "120", label: "2 min" },
        { value: "300", label: "5 min" },
        { value: "600", label: "10 min" },
        { value: "3600", label: "1 hour" },
      ],
    },
  },
  {
    key: "weather",
    label: "Weather",
    group: "World",
    skins: ALL_SKINS,
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "Changes" },
        { value: "clear", label: "Clear" },
        { value: "rain", label: "Rain" },
        { value: "storm", label: "Storm" },
      ],
    },
  },
  {
    key: "horizon",
    label: "Sky share",
    group: "World",
    skins: ALL_SKINS,
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "22%" },
        ...["8%", "12%", "16%", "30%", "40%", "50%"].map((value) => ({ value, label: value })),
      ],
    },
  },
  {
    key: "radius",
    label: "Strafe radius",
    group: "World",
    skins: ALL_SKINS,
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "512 tiles" },
        ...["32", "64", "128", "256", "1024", "2048"].map((value) => ({ value, label: `${value} tiles` })),
      ],
    },
  },
  {
    key: "render",
    label: "Per-pixel passes",
    group: "Rendering",
    skins: ["pixel"],
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "GPU" },
        { value: "cpu", label: "CPU (reference)" },
      ],
    },
  },
  {
    key: "sky",
    label: "Sky",
    group: "Rendering",
    skins: ["pixel"],
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "Pixel" },
        { value: "hd", label: "Screen resolution" },
      ],
    },
  },
  {
    key: "gpu",
    label: "Graphics API",
    group: "Rendering",
    skins: ["lowpoly"],
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "Auto" },
        { value: "webgpu", label: "WebGPU" },
        { value: "webgl", label: "WebGL2" },
      ],
    },
  },
  {
    key: "msaa",
    label: "Antialiasing",
    group: "Rendering",
    skins: ["lowpoly"],
    fallback: "",
    control: { kind: "toggle", checked: "", unchecked: "1" },
  },
  {
    key: "look",
    label: "Look",
    group: "Rendering",
    skins: ["lowpoly"],
    fallback: "",
    control: {
      kind: "select",
      options: [
        { value: "", label: "Flat" },
        { value: "painted", label: "Painted" },
      ],
    },
  },
  {
    key: "map",
    label: "Debug map",
    group: "Debug",
    skins: ["pixel"],
    fallback: "",
    control: { kind: "toggle", checked: "1", unchecked: "" },
  },
  {
    key: "bench",
    label: "Benchmark route",
    group: "Debug",
    skins: ["pixel"],
    fallback: "",
    control: { kind: "toggle", checked: "1", unchecked: "" },
  },
  {
    key: "sync",
    label: "Count GPU time",
    group: "Debug",
    skins: ["pixel"],
    fallback: "",
    requires: ["bench", "1"],
    control: { kind: "toggle", checked: "1", unchecked: "" },
  },
];

/** The panel's sections, top to bottom: the skin first, as the biggest switch. */
export const KNOB_GROUPS: readonly KnobGroup[] = ["Rendering", "World", "Debug"];

/** The knobs the shown skin reads, in table order. */
export function knobsFor(skin: SkinId): readonly Knob[] {
  return KNOBS.filter((knob) => knob.skins.includes(skin));
}

/**
 * What a knob is set to in `query`. A select matches its options ignoring case
 * and spaces, as the parsers do; a value the table does not offer (`time=18:30`)
 * comes back as typed, so the panel can show it rather than lie about it.
 */
export function knobValue(knob: Knob, query: URLSearchParams): string {
  const raw = query.get(knob.key)?.trim() ?? knob.fallback;
  if (knob.control.kind === "toggle") {
    return raw;
  }
  const match = knob.control.options.find((option) => option.value.toLowerCase() === raw.toLowerCase());
  return match?.value ?? raw;
}

/** Whether a toggle is ticked: anything but its `unchecked` value is. */
export function knobChecked(knob: Knob, query: URLSearchParams): boolean {
  if (knob.control.kind !== "toggle") {
    return false;
  }
  return knobValue(knob, query) !== knob.control.unchecked;
}

/** Whether the knob it depends on is where this one matters. */
export function knobApplies(knob: Knob, query: URLSearchParams): boolean {
  if (knob.requires === undefined) {
    return true;
  }
  const [key, value] = knob.requires;
  const other = KNOBS.find((candidate) => candidate.key === key);
  return (other === undefined ? (query.get(key) ?? "") : knobValue(other, query)) === value;
}

/** The same address with one knob changed: its key removed at the fallback. */
export function hrefWith(href: string, knob: Knob, value: string): string {
  const url = new URL(href);
  if (value === knob.fallback) {
    url.searchParams.delete(knob.key);
  } else {
    url.searchParams.set(knob.key, value);
  }
  return url.toString();
}

/** The same address with every knob removed; anything else in the query is kept. */
export function hrefReset(href: string): string {
  const url = new URL(href);
  for (const knob of KNOBS) {
    url.searchParams.delete(knob.key);
  }
  return url.toString();
}
