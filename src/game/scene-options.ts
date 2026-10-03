/**
 * Every knob the address bar can turn, read in one place.
 *
 * All of them are retuned by eye rather than in a rebuild, and every one of
 * them falls back rather than throwing — a typo in a URL should start the game
 * with the default, never blank it.
 *
 * | Key        | Meaning                                                     |
 * | ---------- | ----------------------------------------------------------- |
 * | `horizon`  | the sky/ground split (`0.12` or `12%`)                       |
 * | `radius`   | the sideways circle a strafe walks round, tiles             |
 * | `time`     | pin the clock at an hour: `21`, `6.5`, `18:30`              |
 * | `day`      | length of a day in seconds of play, when the clock runs     |
 * | `weather`  | pin the weather: `clear`, `rain` or `storm`                 |
 * | `render`   | `cpu` draws every per-pixel pass on the CPU, as before the  |
 * |            | GPU ports: the reference to compare a capture against       |
 * | `map`      | `1` stacks the debug map over the canvas                    |
 */

import { DEFAULT_DAY_MS, parseDayLength, parseTime } from "./atmosphere";
import { DEFAULT_SKY_FRACTION, parseSkyFraction } from "./horizon";
import { DEFAULT_STRAFE_RADIUS, parseStrafeRadius } from "./planet";

export type WeatherPin = "clear" | "rain" | "storm";

/** Where the per-pixel passes run: the GPU where WebGL2 allows, or the CPU. */
export type RenderPath = "gpu" | "cpu";

export interface SceneOptions {
  readonly skyFraction: number;
  readonly radius: number;
  /** The hour the clock is pinned at, or undefined when the day runs. */
  readonly pinnedHours: number | undefined;
  readonly dayMs: number;
  readonly weather: WeatherPin | undefined;
  readonly render: RenderPath;
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  skyFraction: DEFAULT_SKY_FRACTION,
  radius: DEFAULT_STRAFE_RADIUS,
  pinnedHours: undefined,
  dayMs: DEFAULT_DAY_MS,
  weather: undefined,
  render: "gpu",
};

export function parseWeather(raw: string | null): WeatherPin | undefined {
  const value = raw?.trim().toLowerCase();
  return value === "clear" || value === "rain" || value === "storm" ? value : undefined;
}

/** `cpu` asks for the CPU passes; anything else, or nothing, the GPU. */
export function parseRenderPath(raw: string | null): RenderPath {
  return raw?.trim().toLowerCase() === "cpu" ? "cpu" : "gpu";
}

export function readSceneOptions(query: URLSearchParams): SceneOptions {
  return {
    skyFraction: parseSkyFraction(query.get("horizon")),
    radius: parseStrafeRadius(query.get("radius")),
    pinnedHours: parseTime(query.get("time")),
    dayMs: parseDayLength(query.get("day")),
    weather: parseWeather(query.get("weather")),
    render: parseRenderPath(query.get("render")),
  };
}
