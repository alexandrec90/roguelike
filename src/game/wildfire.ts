/**
 * Wildfire: the first column of the effect field — fire that lives in the grass.
 *
 * `procedural-effects.md` asks for elemental state to belong to the *world*
 * rather than to an animation, with interactions that fall out of a rule. This
 * is that rule for one element and one surface: a burning planet cell ignites
 * the grass cells beside it, burns out, and leaves scorched earth that slowly
 * greens over again. Nothing about a particular fire is drawn — a fireball's
 * blast, the burning blade and a dying fire slime all just call `ignite`, and
 * the spread, the wind's bias, the rain's dousing and the scar are the rule's.
 *
 * It is a cellular automaton over **planet cells** (whole tiles), stored
 * sparsely: only cells that are burning or burnt exist, so the planet costs
 * nothing until something catches. Stepped on a fixed tick with every roll
 * seeded from the cell and the tick, so a fire replays identically.
 *
 * Two caps keep a meadow from going up entirely. A fire carries a *generation*
 * from the cell that lit it, and stops spreading after `MAX_GENERATION`; and the
 * number of cells burning at once is capped, oldest first.
 */

import { wrapTile, type PlanetPoint } from "./planet";
import { nearLake } from "./lakes";
import { terrainAt } from "./terrain";
import { pixelHash } from "./transforms";

/** The automaton's clock. */
export const WILDFIRE_TICK_MS = 140;
/** How long a cell burns before it is spent. */
export const BURN_MS = 3200;
/** How long a scorched cell stays scorched before the grass is back. */
export const REGROW_MS = 45_000;
/** How many cells from the spark a fire may walk. */
export const MAX_GENERATION = 4;
/** No more than this many cells burn at once. */
export const MAX_BURNING = 48;
/** Chance per tick that a burning cell lights a given grass neighbour. */
const SPREAD = 0.075;

export interface FireCell {
  readonly x: number;
  readonly y: number;
  /** Tick the cell caught on, or -1 once it has burnt out. */
  litTick: number;
  /** When it went out, ms of play — the scar fades from here. */
  outMs: number;
  readonly generation: number;
  readonly seed: number;
}

export interface Wildfire {
  readonly cells: Map<string, FireCell>;
  tick: number;
  carryMs: number;
  nowMs: number;
}

export function createWildfire(): Wildfire {
  return { cells: new Map(), tick: 0, carryMs: 0, nowMs: 0 };
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function cellOf(point: PlanetPoint): { x: number; y: number } {
  return { x: Math.floor(wrapTile(point.x)), y: Math.floor(wrapTile(point.y)) };
}

/** Whether a cell can catch: grass, and not already burning or burnt. */
function flammable(fire: Wildfire, x: number, y: number): boolean {
  if (fire.cells.has(keyOf(x, y))) {
    return false;
  }
  const centre = { x: x + 0.5, y: y + 0.5 };
  return terrainAt(centre) === "grass" && !nearLake(centre);
}

function light(fire: Wildfire, x: number, y: number, generation: number): void {
  const wx = Math.floor(wrapTile(x));
  const wy = Math.floor(wrapTile(y));
  if (!flammable(fire, wx, wy)) {
    return;
  }
  fire.cells.set(keyOf(wx, wy), {
    x: wx,
    y: wy,
    litTick: fire.tick,
    outMs: 0,
    generation,
    seed: Math.floor(pixelHash(wx, wy, 0xf17e, fire.tick) * 0xffff),
  });
}

/** Set the grass alight in every cell within `radius` tiles of a point. */
export function ignite(fire: Wildfire, at: PlanetPoint, radius = 0.6): void {
  const centre = cellOf(at);
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (Math.hypot(dx, dy) <= radius + 0.25) {
        light(fire, centre.x + dx, centre.y + dy, 0);
      }
    }
  }
}

/** Put out every burning cell within `radius` tiles — frost, or a doused patch. */
export function douse(fire: Wildfire, at: PlanetPoint, radius: number): void {
  const centre = cellOf(at);
  for (const cell of fire.cells.values()) {
    const dx = Math.abs(cell.x - centre.x);
    const dy = Math.abs(cell.y - centre.y);
    if (cell.litTick >= 0 && Math.hypot(Math.min(dx, 256 - dx), Math.min(dy, 256 - dy)) <= radius + 0.25) {
      cell.litTick = -1;
      cell.outMs = fire.nowMs;
    }
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Advance the fire. `rain` 0..1 slows spreading and shortens burning; `wind`
 * (signed, planet +x) makes the downwind neighbour likelier to catch.
 */
export function stepWildfire(fire: Wildfire, deltaMs: number, rain = 0, wind = 0): void {
  fire.nowMs += Math.max(deltaMs, 0);
  fire.carryMs += Math.min(Math.max(deltaMs, 0), 500);
  while (fire.carryMs >= WILDFIRE_TICK_MS) {
    fire.carryMs -= WILDFIRE_TICK_MS;
    fire.tick += 1;
    tick(fire, rain, wind);
  }
}

function tick(fire: Wildfire, rain: number, wind: number): void {
  const burnTicks = Math.round((BURN_MS * (1 - rain * 0.6)) / WILDFIRE_TICK_MS);
  const burning = [...fire.cells.values()].filter((cell) => cell.litTick >= 0);
  for (const cell of burning) {
    if (fire.tick - cell.litTick >= burnTicks) {
      cell.litTick = -1;
      cell.outMs = fire.nowMs;
      continue;
    }
    if (cell.generation >= MAX_GENERATION) {
      continue;
    }
    NEIGHBOURS.forEach(([dx, dy], side) => {
      const downwind = 1 + Math.sign(wind) * dx * Math.min(Math.abs(wind), 1) * 0.8;
      const chance = SPREAD * downwind * (1 - rain);
      if (pixelHash(cell.x * 4 + side, cell.y, cell.seed, fire.tick) < chance) {
        light(fire, cell.x + dx, cell.y + dy, cell.generation + 1);
      }
    });
  }
  capBurning(fire);
  regrow(fire);
}

/** Past the cap, the oldest fires go out first. */
function capBurning(fire: Wildfire): void {
  const burning = [...fire.cells.values()].filter((cell) => cell.litTick >= 0);
  if (burning.length <= MAX_BURNING) {
    return;
  }
  burning.sort((a, b) => a.litTick - b.litTick);
  for (const cell of burning.slice(0, burning.length - MAX_BURNING)) {
    cell.litTick = -1;
    cell.outMs = fire.nowMs;
  }
}

function regrow(fire: Wildfire): void {
  for (const [key, cell] of fire.cells) {
    if (cell.litTick < 0 && fire.nowMs - cell.outMs >= REGROW_MS) {
      fire.cells.delete(key);
    }
  }
}

/** A cell's fire right now: 0 unlit, rising to 1 and falling as it burns out. */
export function flameAt(fire: Wildfire, cell: FireCell): number {
  if (cell.litTick < 0) {
    return 0;
  }
  const age = ((fire.tick - cell.litTick) * WILDFIRE_TICK_MS + fire.carryMs) / BURN_MS;
  return Math.max(0, Math.min(1, age * 5, (1 - age) * 2.5));
}

/** How scorched a cell is, 0..1: 1 while burning and just after, fading as it regrows. */
export function scorchAt(fire: Wildfire, point: PlanetPoint): number {
  const cell = fire.cells.get(keyOf(Math.floor(wrapTile(point.x)), Math.floor(wrapTile(point.y))));
  if (cell === undefined) {
    return 0;
  }
  if (cell.litTick >= 0) {
    return 1;
  }
  return Math.max(0, 1 - (fire.nowMs - cell.outMs) / REGROW_MS);
}

export function burningCells(fire: Wildfire): FireCell[] {
  return [...fire.cells.values()].filter((cell) => cell.litTick >= 0);
}

export function scorchedCells(fire: Wildfire): FireCell[] {
  return [...fire.cells.values()];
}
