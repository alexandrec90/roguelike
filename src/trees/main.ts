/**
 * The tree lab's entry point: DOM chrome around one nearest-neighbour canvas.
 *
 * Nothing here is exported. Every decision worth being sure about lives in a
 * pure module — `gallery.ts` for the state and the grid, `game/trees/*` for the
 * species, `game/wind.ts` for the weather — and is tested there. This file owns
 * the render loop, the controls and `window.treeGallery`, the capture handle a
 * browser-driving agent uses.
 *
 * The loop steps every species with the *same* clamped delta and the *same*
 * wind, which is the entire point of the page: eight mechanisms cannot be
 * compared one at a time, because the thing being judged is how each one
 * answers a gust the others are also feeling.
 */

import { fillRect, paintCloud, paintRgba, type RasterBuffer } from "../game/cloud-raster";
import { createVolumeGl, drawVolume, readVolume, type VolumeGl } from "../game/gpu/volume-gl";
import type { PixelCloud } from "../game/ink";
import { particleAlpha, stepEmitter, type EmitterState } from "../game/spark-emitter";
import { stageTree, type SceneryEnv, type SceneryInstance } from "../game/trees";
import type { VolumePart } from "../game/scenery";
import { volumeCloud } from "../game/procgen/volume";
import { hexToRgb } from "../game/color";
import { INK_COLORS } from "../game/ink";
import { SCENERY_SPECIES } from "../game/trees";
import { detailFor } from "../game/lod";
import { createRain, RAIN_SLANT } from "../game/weather";
import {
  createGalleryBuffer,
  galleryLayout,
  GROUNDS,
  lightVector,
  RENDERERS,
  paintGround,
  parseGalleryState,
  serializeGalleryState,
  ZOOMS,
  type GalleryState,
} from "./gallery";

import "./trees.css";

const CELL = { width: 88, height: 76 };
const SOLO_CELL = { width: 108, height: 84 };
const COLUMNS = 4;
const MAX_DELTA_MS = 100;

interface Entry {
  readonly id: string;
  readonly instance: SceneryInstance;
}

const canvas = need<HTMLCanvasElement>("canvas");
const context = canvas.getContext("2d", { alpha: false });
if (context === null) {
  throw new Error("The tree lab needs a 2d canvas context");
}
context.imageSmoothingEnabled = false;

let state = parseGalleryState(window.location.search);
let entries = build(state.seed);
let rain: EmitterState = createRain(CELL.width * COLUMNS);
let elapsedMs = 0;
let lastFrameMs = performance.now();
// One context for the page. A WebGL context per body is not a performance
// idea, it is a crash: browsers cap them at around sixteen.
const volumeGl: VolumeGl | null = createVolumeGl();
let mismatched = 0;
let gpuBodies = 0;

function build(seed: number): Entry[] {
  // A different seed per species, derived from the one the user sees, so
  // typing a seed reshuffles the whole gallery reproducibly.
  return SCENERY_SPECIES.map((species, index) => ({
    id: species.id,
    instance: species.create(seed + index * 1013),
  }));
}

function shown(): Entry[] {
  return state.solo === "" ? entries : entries.filter((entry) => entry.id === state.solo);
}

/**
 * Set alight everything that can be.
 *
 * Duck-typed rather than switched on an id, because the whole point of
 * `burnable.ts` is that catching fire is a capability an object either has or
 * does not — not a list this page has to be told about. A species that grows an
 * `ignite` tomorrow lights up here with no change to this file.
 */
function igniteAll(): void {
  for (const entry of shown()) {
    const candidate = entry.instance as { ignite?: (x?: number, y?: number) => void };
    candidate.ignite?.();
  }
}

function cellSize(): { width: number; height: number } {
  return state.solo === "" ? CELL : SOLO_CELL;
}

function envFor(cell: { readonly footX: number; readonly footY: number }): SceneryEnv {
  return {
    elapsedMs,
    wind: { strength: state.wind, gustiness: state.gust },
    light: lightVector(state.lightAngle),
    // The wind wave travels across the grid, so the cells lean in sequence
    // rather than in unison — the same thing a row of real trees does.
    fieldX: cell.footX,
    fieldY: cell.footY,
    weather: { rain: state.rain, snow: state.snow },
    // Distance buys nothing in size here — the ground is affine — so all it
    // changes is how much work the body is worth. Slide it and watch for a pop:
    // there should not be one, because every tier is the same field.
    detail: detailFor(state.distance),
  };
}

/**
 * Draw one body's volumes through the shader, and say whether it could.
 *
 * Returns false for a species that is not made of volumes — a Verlet willow, a
 * leaf swarm — so the caller falls back to the CPU path that has always worked.
 * The same is true when the machine has no WebGL2 at all.
 */
function drawOnGpu(
  buffer: RasterBuffer,
  entry: Entry,
  env: SceneryEnv,
  cell: { readonly footX: number; readonly footY: number },
): boolean {
  const parts = volumeGl === null ? undefined : entry.instance.volumes?.(env);
  if (volumeGl === null || parts === undefined || parts.length === 0) {
    return false;
  }
  gpuBodies += 1;

  // In diff mode the CPU picture goes down for context and the magenta is
  // painted over it, so a disagreement is visible where it happens.
  if (state.renderer === "diff") {
    paintCloud(buffer, entry.instance.cloud(env), cell.footX, cell.footY);
  }

  for (const part of parts) {
    const draw = drawVolume(volumeGl, part.spec, part.light, part.clip);
    const pixels = readVolume(volumeGl, draw);
    if (state.renderer === "diff") {
      mismatched += diffPart(buffer, part, pixels, draw, cell);
    } else {
      paintRgba(buffer, pixels, draw, cell.footX + draw.box.left, cell.footY + draw.box.top);
    }
  }
  return true;
}

/**
 * Compare one part's GPU output against the **CPU render of that same part**,
 * and mark every pixel they disagree about.
 *
 * Per part, not against the finished buffer, and that distinction is the whole
 * test. Diffing against the composited cell reported 132 disagreements on the
 * chestnut, every one of them a trunk pixel the canopy had already painted
 * over — the measurement was wrong, not the shader. A parity check has to
 * compare like with like or it invents its own failures.
 */
function diffPart(
  buffer: RasterBuffer,
  part: VolumePart,
  pixels: Uint8ClampedArray,
  draw: { readonly width: number; readonly height: number; readonly box: { left: number; top: number } },
  cell: { readonly footX: number; readonly footY: number },
): number {
  const reference = new Map<number, readonly [number, number, number]>();
  for (const pixel of volumeCloud(part.spec, part.light, part.clip)) {
    const { r, g, b } = hexToRgb(INK_COLORS[pixel.ink]);
    reference.set((pixel.x + 512) * 4096 + (pixel.y + 512), [r, g, b]);
  }

  let differences = 0;
  for (let row = 0; row < draw.height; row += 1) {
    for (let column = 0; column < draw.width; column += 1) {
      const from = (row * draw.width + column) * 4;
      const at = { x: draw.box.left + column, y: draw.box.top + row };
      const onGpu = (pixels[from + 3] ?? 0) > 0;
      const onCpu = reference.get((at.x + 512) * 4096 + (at.y + 512));
      if (!onGpu && onCpu === undefined) {
        continue;
      }
      const same =
        onGpu &&
        onCpu !== undefined &&
        onCpu.every((channel, index) => Math.abs(channel - (pixels[from + index] ?? 0)) <= 1);
      if (same) {
        continue;
      }
      differences += 1;
      const x = cell.footX + at.x;
      const y = cell.footY + at.y;
      if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
        continue;
      }
      const to = (y * buffer.width + x) * 4;
      buffer.data[to] = 255;
      buffer.data[to + 1] = 68;
      buffer.data[to + 2] = 224;
      buffer.data[to + 3] = 255;
    }
  }
  return differences;
}

function render(): void {
  mismatched = 0;
  gpuBodies = 0;
  const visible = shown();
  const size = cellSize();
  const grid = galleryLayout(visible.length, size.width, size.height, state.solo === "" ? COLUMNS : 1);
  const buffer = createGalleryBuffer(grid);
  // Clear to the background before any cell is laid. A fresh buffer is fully
  // transparent, and the canvas is created with `alpha: false`, so any region
  // no cell covers — the empty tail of the last grid row — is composited from
  // undefined bytes and comes out white.
  fillRect(buffer, { x: 0, y: 0, width: grid.width, height: grid.height }, "#000000");

  grid.cells.forEach((cell, index) => {
    const entry = visible[index];
    if (entry === undefined) {
      return;
    }
    paintGround(buffer, cell, state.ground, state.seed);
    const env = envFor(cell);
    const cloud = stageTree(entry.instance, env, {
      shadow: state.shadow,
      elevation: state.elevation,
      reflection: state.reflection,
      // The water is only the band below the foot; a reflection longer than
      // that lands on dry ground and reads as scattered litter.
      reflectionDepth: cell.top + cell.height - cell.footY,
    });
    if (state.renderer === "cpu" || !drawOnGpu(buffer, entry, env, cell)) {
      paintCloud(buffer, cloud, cell.footX, cell.footY);
    }
  });

  if (state.rain > 0) {
    paintCloud(buffer, rainCloud(grid.height), 0, 0);
  }

  canvas.width = grid.width;
  canvas.height = grid.height;
  canvas.style.width = `${grid.width * state.zoom}px`;
  canvas.style.height = `${grid.height * state.zoom}px`;
  context?.putImageData(new ImageData(buffer.data, grid.width, grid.height), 0, 0);
}

/** Drops as short streaks leaning by exactly the slant they are travelling on. */
function rainCloud(height: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (const drop of rain.particles) {
    if (!drop.active || particleAlpha(drop) <= 0) {
      continue;
    }
    const x = Math.round(drop.x);
    const y = Math.round(drop.y);
    if (y < 0 || y > height) {
      continue;
    }
    for (let step = 0; step < 3; step += 1) {
      cloud.push({ x: x - Math.round(step * RAIN_SLANT), y: y - step, ink: step === 0 ? "ice" : "steel" });
    }
  }
  return cloud;
}

function frame(now: number): void {
  const delta = Math.min(now - lastFrameMs, MAX_DELTA_MS) * state.speed;
  lastFrameMs = now;
  if (state.play) {
    advance(delta);
  }
  render();
  updateStatus();
  window.requestAnimationFrame(frame);
}

function advance(delta: number): void {
  elapsedMs += delta;
  const size = cellSize();
  const grid = galleryLayout(shown().length, size.width, size.height, state.solo === "" ? COLUMNS : 1);
  shown().forEach((entry, index) => {
    const cell = grid.cells[index];
    if (cell !== undefined) {
      entry.instance.step?.(delta, envFor(cell));
    }
  });
  if (state.rain > 0) {
    stepEmitter(rain, delta * (0.3 + state.rain));
  }
}

function updateStatus(): void {
  const active = SCENERY_SPECIES.find((species) => species.id === state.solo);
  need<HTMLElement>("clock").textContent = `${(elapsedMs / 1000).toFixed(1)} s`;
  const tier = detailFor(state.distance).tier;
  const gpu =
    state.renderer === "cpu"
      ? ""
      : ` · ${state.renderer} · ${gpuBodies} on GPU` +
        (state.renderer === "diff" ? ` · ${mismatched} px differ` : "") +
        (volumeGl === null ? " · no WebGL2" : "");
  need<HTMLElement>("status").textContent = active
    ? `${active.label} — ${active.technique} · ${tier} detail${gpu}`
    : `${SCENERY_SPECIES.length} species · wind ${state.wind.toFixed(2)} · ${state.distance} rows away · ${tier} detail${gpu}`;
  need<HTMLElement>("notes").textContent = active?.notes ?? "Click a species on the left to show it alone.";
}

/* ---------- controls ---------- */

function need<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`The tree lab is missing #${id}`);
  }
  return element as T;
}

function apply(patch: Partial<GalleryState>): GalleryState {
  const reseeded = patch.seed !== undefined && patch.seed !== state.seed;
  state = { ...state, ...patch };
  if (reseeded) {
    entries = build(state.seed);
    elapsedMs = 0;
  }
  window.history.replaceState(null, "", serializeGalleryState(state));
  syncControls();
  return state;
}

const SLIDER_IDS: Readonly<Record<string, string>> = {
  wind: "wind",
  gust: "gust",
  distance: "distance",
  speed: "speed",
  rain: "rain",
  snow: "snow",
  lightAngle: "light",
  elevation: "sun",
};

function syncControls(): void {
  for (const [key, id] of Object.entries(SLIDER_IDS)) {
    need<HTMLInputElement>(id).value = String(state[key as keyof GalleryState]);
  }
  need<HTMLInputElement>("shadow").checked = state.shadow;
  need<HTMLInputElement>("reflect").checked = state.reflection;
  need<HTMLSelectElement>("ground").value = state.ground;
  need<HTMLSelectElement>("zoom").value = String(state.zoom);
  need<HTMLSelectElement>("renderer").value = state.renderer;
  need<HTMLInputElement>("seed").value = String(state.seed);
  need<HTMLButtonElement>("play").textContent = state.play ? "Pause" : "Play";
  for (const button of document.querySelectorAll<HTMLButtonElement>("#species button")) {
    button.classList.toggle("active", button.dataset.id === state.solo);
  }
}

function bindControls(): void {
  for (const [key, id] of Object.entries(SLIDER_IDS)) {
    need<HTMLInputElement>(id).addEventListener("input", (event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      apply({ [key]: value } as Partial<GalleryState>);
    });
  }
  need<HTMLInputElement>("shadow").addEventListener("change", (event) => {
    apply({ shadow: (event.target as HTMLInputElement).checked });
  });
  need<HTMLInputElement>("reflect").addEventListener("change", (event) => {
    apply({ reflection: (event.target as HTMLInputElement).checked });
  });
  need<HTMLInputElement>("seed").addEventListener("change", (event) => {
    apply({ seed: Math.trunc(Number.parseFloat((event.target as HTMLInputElement).value) || 0) });
  });
  need<HTMLButtonElement>("play").addEventListener("click", () => apply({ play: !state.play }));
  need<HTMLButtonElement>("ignite").addEventListener("click", igniteAll);
  bindSelects();
  window.addEventListener("keydown", onKey);
}

function bindSelects(): void {
  const ground = need<HTMLSelectElement>("ground");
  ground.append(...GROUNDS.map((id) => new Option(id, id)));
  ground.addEventListener("change", () => apply({ ground: ground.value as GalleryState["ground"] }));

  const zoom = need<HTMLSelectElement>("zoom");
  zoom.append(...ZOOMS.map((value) => new Option(`${value}x`, String(value))));
  zoom.addEventListener("change", () => apply({ zoom: Number.parseInt(zoom.value, 10) }));

  const renderer = need<HTMLSelectElement>("renderer");
  renderer.append(...RENDERERS.map((id) => new Option(id, id)));
  renderer.addEventListener("change", () =>
    apply({ renderer: renderer.value as GalleryState["renderer"] }),
  );
}

function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    apply({ play: !state.play });
  } else if (event.code === "Escape") {
    apply({ solo: "" });
  } else if (event.code === "BracketLeft" || event.code === "BracketRight") {
    const step = event.code === "BracketRight" ? 1 : -1;
    const index = ZOOMS.indexOf(state.zoom as (typeof ZOOMS)[number]);
    apply({ zoom: ZOOMS[Math.min(Math.max(index + step, 0), ZOOMS.length - 1)] ?? state.zoom });
  }
}

function buildCatalog(): void {
  const nav = need<HTMLElement>("species");
  for (const species of SCENERY_SPECIES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = species.id;
    button.innerHTML = `${species.label}<small>${species.technique}</small>`;
    button.addEventListener("click", () => apply({ solo: state.solo === species.id ? "" : species.id }));
    nav.append(button);
  }
}

/**
 * The capture handle, mirroring the asset lab's.
 *
 * `seek` rebuilds every species and replays it from zero in fixed slices,
 * because several of them integrate: asking a Verlet willow for its shape at
 * t=8000 without having run it there returns a tree that has never felt a gust.
 *
 * `advance` is the other half, and it exists because `requestAnimationFrame`
 * does not run in a backgrounded tab — so an agent that sets a bush alight and
 * then waits two seconds of wall clock captures a bush that has not burned at
 * all. Driving the clock explicitly is the only way to photograph a simulation
 * from outside the browser's own idea of time.
 */
declare global {
  interface Window {
    treeGallery: {
      state: () => GalleryState;
      apply: (patch: Partial<GalleryState>) => GalleryState;
      seek: (ms: number) => number;
      advance: (ms: number) => number;
      ignite: () => number;
      species: () => readonly { id: string; label: string; technique: string }[];
      parity: () => { bodies: number; mismatched: number; webgl2: boolean };
      snapshot: () => string;
    };
  }
}

function advanceBy(ms: number): number {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    const slice = Math.min(16, remaining);
    advance(slice);
    remaining -= slice;
  }
  render();
  return elapsedMs;
}

window.treeGallery = {
  state: () => state,
  apply,
  seek: (ms: number) => {
    entries = build(state.seed);
    rain = createRain(CELL.width * COLUMNS);
    elapsedMs = 0;
    return advanceBy(ms);
  },
  advance: advanceBy,
  ignite: () => {
    igniteAll();
    render();
    return shown().length;
  },
  species: () => SCENERY_SPECIES.map(({ id, label, technique }) => ({ id, label, technique })),
  parity: () => ({ bodies: gpuBodies, mismatched, webgl2: volumeGl !== null }),
  snapshot: () => canvas.toDataURL("image/png"),
};

buildCatalog();
bindControls();
syncControls();
window.requestAnimationFrame(frame);
