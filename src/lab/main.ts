/**
 * The asset lab's entry point: DOM chrome around one 320x180 Phaser canvas.
 *
 * Nothing here is exported. Every decision worth testing lives in a pure module
 * (`lab-state`, `lab-timeline`, `lab-layout`, `asset-registry`, `textures`) and
 * is covered there; this file only wires those to elements and to the URL.
 *
 * The controls are HTML rather than pixels on purpose. The canvas is the art
 * surface — putting readable 11px chrome inside it would mean either resampling
 * the art or rendering text at a size no 320x180 screen would ever use.
 */

import Phaser from "phaser";

import { ASSET_REGISTRY, assetFrame, findAsset, type AssetCategory } from "../game/asset-registry";
import { integerScale, letterbox } from "../game/integer-scale";
import { TILE_PREVIEW_COLUMNS, TILE_PREVIEW_ROWS } from "../game/textures";
import { LAB_SIZE, LabScene } from "./lab-scene";
import {
  BACKGROUND_MODES,
  normalizeLabState,
  parseLabState,
  serializeLabState,
  ZOOM_STEPS,
  type BackgroundMode,
  type LabState,
} from "./lab-state";
import { frameIndexAt, stepFrame, timeForFrame } from "./lab-timeline";

import "./lab.css";

/** Order the catalog by how often art gets looked at, not alphabetically. */
const CATEGORY_ORDER: readonly AssetCategory[] = ["actor", "prop", "tile", "effect"];
const CATEGORY_LABELS: Record<AssetCategory, string> = {
  actor: "Actors",
  prop: "Props",
  tile: "Terrain",
  effect: "Effects",
};
const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  duo: "Dark / light",
  checker: "Alpha checker",
  contrast: "Black / white",
};

const scene = new LabScene();
let state = parseLabState(window.location.search);

const canvasHost = need<HTMLDivElement>("lab-canvas");
const catalogHost = need<HTMLElement>("catalog");
const playButton = need<HTMLButtonElement>("play");
const prevButton = need<HTMLButtonElement>("prev");
const nextButton = need<HTMLButtonElement>("next");
const frameReadout = need<HTMLSpanElement>("frame-readout");
const variantSelect = need<HTMLSelectElement>("variant");
const zoomSelect = need<HTMLSelectElement>("zoom");
const backgroundSelect = need<HTMLSelectElement>("bg");
const gridToggle = need<HTMLInputElement>("grid");
const boundsToggle = need<HTMLInputElement>("bounds");
const tileToggle = need<HTMLInputElement>("tile");
const statusText = need<HTMLParagraphElement>("status");
const notesText = need<HTMLParagraphElement>("notes");

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: canvasHost,
  width: LAB_SIZE.width,
  height: LAB_SIZE.height,
  backgroundColor: "#0e1015",
  pixelArt: true,
  roundPixels: true,
  // A snapshot has to be readable after the frame it was drawn in, or the
  // capture API returns a blank PNG on every browser that clears eagerly.
  render: { preserveDrawingBuffer: true },
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [scene],
});

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`The lab page is missing #${id}`);
  }
  return node as T;
}

function currentEntry(): (typeof ASSET_REGISTRY)[number] {
  const entry = findAsset(state.assetId);
  if (entry === undefined) {
    throw new Error(`Unknown asset '${state.assetId}'`);
  }
  return entry;
}

/** The one way anything changes: normalize, hand to the scene, mirror to chrome and URL. */
function apply(patch: Partial<LabState>): LabState {
  state = normalizeLabState({ ...state, ...patch });
  scene.setState(state);
  syncChrome();
  window.history.replaceState(null, "", serializeLabState(state));
  return state;
}

/** Move to a frame and pause there — what every manual frame control means. */
function gotoFrame(frame: number): void {
  const entry = currentEntry();
  const next = stepFrame(state.frame, frame - state.frame, entry.frames.length);
  apply({ frame: next, playing: false, timeMs: timeForFrame(next, entry.frameDurationMs) });
}

function seek(timeMs: number): LabState {
  const entry = currentEntry();
  return apply({
    playing: false,
    timeMs: Math.max(timeMs, 0),
    frame: frameIndexAt(timeMs, entry.frames.length, entry.frameDurationMs),
  });
}

function buildCatalog(): void {
  for (const category of CATEGORY_ORDER) {
    const entries = ASSET_REGISTRY.filter((entry) => entry.category === category);
    if (entries.length === 0) {
      continue;
    }

    const heading = document.createElement("h2");
    heading.textContent = CATEGORY_LABELS[category];
    catalogHost.append(heading);

    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["asset"] = entry.id;
      button.textContent = entry.label;
      button.addEventListener("click", () => {
        // Clearing variant/frame/tiled lets normalize re-derive them for the
        // asset being opened, instead of carrying the last one's choices over.
        apply({
          assetId: entry.id,
          variantId: undefined,
          frame: 0,
          timeMs: 0,
          playing: true,
          tiled: undefined,
        });
      });
      catalogHost.append(button);
    }
  }
}

function buildSelects(): void {
  for (const step of ZOOM_STEPS) {
    const option = document.createElement("option");
    option.value = String(step);
    option.textContent = `${step}x`;
    zoomSelect.append(option);
  }
  for (const mode of BACKGROUND_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = BACKGROUND_LABELS[mode];
    backgroundSelect.append(option);
  }
}

function bindControls(): void {
  playButton.addEventListener("click", () => {
    apply({ playing: !state.playing, timeMs: state.playing ? state.timeMs : 0 });
  });
  prevButton.addEventListener("click", () => gotoFrame(state.frame - 1));
  nextButton.addEventListener("click", () => gotoFrame(state.frame + 1));

  variantSelect.addEventListener("change", () => apply({ variantId: variantSelect.value }));
  zoomSelect.addEventListener("change", () => apply({ zoom: Number(zoomSelect.value) }));
  backgroundSelect.addEventListener("change", () =>
    apply({ background: backgroundSelect.value as BackgroundMode }),
  );

  gridToggle.addEventListener("change", () => apply({ grid: gridToggle.checked }));
  boundsToggle.addEventListener("change", () => apply({ bounds: boundsToggle.checked }));
  tileToggle.addEventListener("change", () => apply({ tiled: tileToggle.checked }));
}

function bindKeys(): void {
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLSelectElement || event.ctrlKey || event.metaKey) {
      return;
    }
    const handled = runShortcut(event.key);
    if (handled) {
      event.preventDefault();
    }
  });
}

function runShortcut(key: string): boolean {
  switch (key) {
    case " ":
      apply({ playing: !state.playing });
      return true;
    case "ArrowLeft":
      gotoFrame(state.frame - 1);
      return true;
    case "ArrowRight":
      gotoFrame(state.frame + 1);
      return true;
    case "ArrowUp":
      stepAsset(-1);
      return true;
    case "ArrowDown":
      stepAsset(1);
      return true;
    case "g":
      apply({ grid: !state.grid });
      return true;
    case "b":
      apply({ bounds: !state.bounds });
      return true;
    case "t":
      apply({ tiled: !state.tiled });
      return true;
    case "[":
    case "]":
      stepZoom(key === "]" ? 1 : -1);
      return true;
    default:
      return false;
  }
}

function stepAsset(delta: number): void {
  const index = ASSET_REGISTRY.findIndex((entry) => entry.id === state.assetId);
  const count = ASSET_REGISTRY.length;
  const next = ASSET_REGISTRY[(((index + delta) % count) + count) % count];
  if (next === undefined) {
    return;
  }
  apply({ assetId: next.id, variantId: undefined, frame: 0, timeMs: 0, tiled: undefined });
}

function stepZoom(delta: number): void {
  const index = ZOOM_STEPS.indexOf(state.zoom);
  const clamped = Math.min(Math.max(index + delta, 0), ZOOM_STEPS.length - 1);
  apply({ zoom: ZOOM_STEPS[clamped] ?? state.zoom });
}

function syncChrome(): void {
  const entry = currentEntry();

  for (const button of catalogHost.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset["asset"] === state.assetId);
  }

  variantSelect.replaceChildren();
  for (const variant of entry.variants) {
    const option = document.createElement("option");
    option.value = variant.id;
    option.textContent = variant.label;
    variantSelect.append(option);
  }

  variantSelect.value = state.variantId;
  zoomSelect.value = String(state.zoom);
  backgroundSelect.value = state.background;
  gridToggle.checked = state.grid;
  boundsToggle.checked = state.bounds;
  tileToggle.checked = state.tiled;
  tileToggle.disabled = entry.category !== "tile";

  playButton.textContent = state.playing ? "Pause" : "Play";
  frameReadout.textContent = `${state.frame + 1} / ${entry.frames.length}`;
  notesText.textContent = entry.notes ?? "";
  statusText.textContent = describe();
}

/** The measurements a look at the art has to be checked against. */
function describe(): string {
  const entry = currentEntry();
  const source = assetFrame(entry, state.frame, state.variantId);

  return [
    `${entry.label} · ${entry.category}`,
    `${source.rows[0]?.length ?? 0}x${source.rows.length}px`,
    `${entry.frames.length} frame${entry.frames.length === 1 ? "" : "s"} @ ${entry.frameDurationMs}ms`,
    `${scene.effectiveZoom()}x`,
    state.playing ? "playing" : `paused @ ${Math.round(state.timeMs)}ms`,
    state.tiled ? `tiled ${TILE_PREVIEW_COLUMNS}x${TILE_PREVIEW_ROWS}` : "single",
  ].join("   ·   ");
}

/** Whole-factor CSS upscale — the same contract the game itself renders under. */
function fitCanvas(): void {
  const { factor, width, height } = integerScale(
    canvasHost.clientWidth,
    canvasHost.clientHeight,
    LAB_SIZE.width,
    LAB_SIZE.height,
  );
  const { left, top } = letterbox(canvasHost.clientWidth, canvasHost.clientHeight, width, height);
  const canvas = game.canvas;

  canvas.style.width = `${LAB_SIZE.width * factor}px`;
  canvas.style.height = `${LAB_SIZE.height * factor}px`;
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
}

/**
 * The capture handle, for a person in the console and for an agent driving the
 * browser. `apply` and `seek` return the state they settled on, so a caller
 * never has to guess how a request was normalized.
 */
function exposeApi(): void {
  const api = {
    state: (): LabState => state,
    apply: (patch: Partial<LabState>): LabState => apply(patch),
    seek: (timeMs: number): LabState => seek(timeMs),
    assets: () =>
      ASSET_REGISTRY.map((entry) => ({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        frames: entry.frames.length,
        variants: entry.variants.map((variant) => variant.id),
      })),
    snapshot: (): string => game.canvas.toDataURL("image/png"),
  };

  (window as unknown as { assetLab: typeof api }).assetLab = api;
}

scene.onFrameChange = (frame: number): void => {
  state = { ...state, frame };
  syncChrome();
};

buildCatalog();
buildSelects();
bindControls();
bindKeys();
exposeApi();
apply(state);

window.addEventListener("resize", fitCanvas);
game.events.once(Phaser.Core.Events.READY, fitCanvas);

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
