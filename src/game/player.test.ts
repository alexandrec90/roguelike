import { describe, expect, it } from "vitest";

import type { Heading } from "./keybindings";
import {
  DEFAULT_STRAFE_RADIUS,
  strafeLap,
  wrapDelta,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";
import {
  advancePlayer,
  attackProgress,
  ATTACK_MS,
  CAST_COOLDOWN_MS,
  CAST_CYCLE_MS,
  CAST_RELEASE_MS,
  castProgress,
  createPlayer,
  SWING_CONTACT_MS,
  facingYaw,
  gaitOf,
  groundPose,
  livePose,
  nextAnchor,
  passable,
  upcomingAnchor,
  REACH_TILES,
  scrollPhase,
  STEP_MS,
  walkClipMs,
  WALK_TILES_PER_MS,
  type Intent,
  type PlayerState,
  type World,
} from "./player";

const R = DEFAULT_STRAFE_RADIUS;
const START: PlanetPose = { x: 128, y: 128, turn: 0 };
const OPEN: World = { radius: R, blocked: () => false };
const WALLED: World = { radius: R, blocked: () => true };
const FRAME_MS = 16;

/** Rock filling everything more than half a tile to the right of the start. */
const WALL_RIGHT: World = { radius: R, blocked: (p) => wrapDelta(p.x, START.x) > 0.5 };
/** Rock filling everything more than half a tile ahead of the start. */
const WALL_AHEAD: World = { radius: R, blocked: (p) => wrapDelta(p.y, START.y) > 0.5 };

const NOTHING: Intent = { attack: false };

function walk(heading: Heading): Intent {
  return { heading, attack: false };
}

const north = walk("north");
const south = walk("south");
const east = walk("east");
const west = walk("west");

/** Run `frames` frames of `intent` from `player` and hand back where it ended. */
function run(player: PlayerState, intent: Intent, frames: number, world: World = OPEN): PlayerState {
  let current = player;
  for (let frame = 0; frame < frames; frame += 1) {
    current = advancePlayer(current, intent, FRAME_MS, world).player;
  }
  return current;
}

/** Hold a heading for exactly `tiles` tiles' worth of walking time from the start. */
function hold(intent: Intent, tiles: number, world: World = OPEN): PlayerState {
  const ms = tiles * STEP_MS;
  const frames = Math.floor(ms / FRAME_MS);
  const whole = run(createPlayer(START), intent, frames, world);
  return advancePlayer(whole, intent, ms - frames * FRAME_MS, world).player;
}

describe("createPlayer", () => {
  it("starts standing on the pose it was handed", () => {
    const player = createPlayer(START);
    expect(groundPose(player)).toEqual(START);
    expect(scrollPhase(player)).toEqual({ x: 0, y: 0 });
    expect(player.motion).toBe("idle");
    expect(player.gait).toBeUndefined();
    expect(player.attackMs).toBeUndefined();
  });
});

describe("gaitOf", () => {
  it("reads the screen-space heading as the planet's two walks", () => {
    // `HEADING_VECTOR` says north is *up* (dy -1) and forward runs up the
    // screen, so this sign flip is the whole of the conversion.
    expect(gaitOf("north")).toEqual({ forward: 1, strafe: 0 });
    expect(gaitOf("south")).toEqual({ forward: -1, strafe: 0 });
    expect(gaitOf("east")).toEqual({ forward: 0, strafe: 1 });
    expect(gaitOf("west")).toEqual({ forward: 0, strafe: -1 });
    expect(gaitOf("northeast")).toEqual({ forward: 1, strafe: 1 });
    expect(gaitOf("southwest")).toEqual({ forward: -1, strafe: -1 });
  });
});

describe("free movement", () => {
  it("walks on the frame the heading arrives, by that frame's share of a tile", () => {
    const tick = advancePlayer(createPlayer(START), north, FRAME_MS, OPEN);
    expect(tick.player.motion).toBe("walk");
    expect(tick.usedHeading).toBe(true);
    expect(scrollPhase(tick.player).y).toBeCloseTo(FRAME_MS * WALK_TILES_PER_MS, 9);
    expect(tick.player.stepped.y).toBeCloseTo(FRAME_MS * WALK_TILES_PER_MS, 9);
  });

  it("stops on the frame the heading is released, wherever he is", () => {
    const walking = run(createPlayer(START), north, 3);
    const stopped = advancePlayer(walking, NOTHING, FRAME_MS, OPEN).player;
    expect(stopped.motion).toBe("idle");
    expect(stopped.stepped).toEqual({ x: 0, y: 0 });
    expect(scrollPhase(stopped)).toEqual(scrollPhase(walking));
    // Mid-tile, and staying there.
    expect(scrollPhase(stopped).y).toBeGreaterThan(0);
    expect(scrollPhase(stopped).y).toBeLessThan(1);
  });

  it("turns round on the frame a new heading arrives, without finishing a tile first", () => {
    const walking = run(createPlayer(START), north, 3);
    const back = advancePlayer(walking, south, FRAME_MS, OPEN).player;
    expect(scrollPhase(back).y).toBeLessThan(scrollPhase(walking).y);
  });

  it("covers a tile in STEP_MS whatever the frame rate", () => {
    const fine = run(createPlayer(START), north, 90);
    let coarse = createPlayer(START);
    for (let frame = 0; frame < 30; frame += 1) {
      coarse = advancePlayer(coarse, north, FRAME_MS * 3, OPEN).player;
    }
    expect(livePose(fine, R).y).toBeCloseTo(START.y + (90 * FRAME_MS) / STEP_MS, 6);
    expect(livePose(coarse, R).y).toBeCloseTo(livePose(fine, R).y, 6);
  });

  it("does not walk backwards on a negative delta", () => {
    const walking = run(createPlayer(START), north, 2);
    const after = advancePlayer(walking, north, -100, OPEN).player;
    expect(scrollPhase(after)).toEqual(scrollPhase(walking));
  });

  it("turns to face rock and stays put, spending a queued tap either way", () => {
    const blocked = advancePlayer(createPlayer(START), north, FRAME_MS, WALLED);
    expect(blocked.player.motion).toBe("idle");
    expect(livePose(blocked.player, R)).toEqual(START);
    expect(blocked.player.facing).toBe("north");
    expect(blocked.usedHeading).toBe(true);
  });

  it("stops short of rock by its reach, rather than standing half inside it", () => {
    const against = hold(north, 3, WALL_AHEAD);
    const ahead = wrapDelta(livePose(against, R).y, START.y);
    expect(ahead).toBeLessThanOrEqual(0.5 - REACH_TILES + 1e-9);
    expect(ahead).toBeGreaterThan(0.5 - REACH_TILES - FRAME_MS * WALK_TILES_PER_MS);
  });

  it("does nothing at all with an empty intent", () => {
    const idle = advancePlayer(createPlayer(START), NOTHING, FRAME_MS, OPEN);
    expect(idle.player.motion).toBe("idle");
    expect(idle.attacked).toBe(false);
    expect(idle.usedHeading).toBe(false);
  });
});

describe("the four directions", () => {
  it("walk forward and back along the heading without turning", () => {
    expect(livePose(hold(north, 4), R).y).toBeCloseTo(132, 6);
    expect(livePose(hold(north, 4), R).turn).toBe(0);
    expect(livePose(hold(south, 4), R).y).toBeCloseTo(124, 6);
  });

  it("walk sideways and turn while doing it", () => {
    // The whole shape of the planet in one assertion: pressing right moves you
    // right *and* swings the world, by one tile over the sideways circle.
    const right = livePose(hold(east, 4), R);
    expect(right.turn).toBeCloseTo(4 / R, 6);
    expect(wrapDelta(right.x, START.x)).toBeGreaterThan(0);

    expect(wrapDelta(livePose(hold(west, 4), R).x, START.x)).toBeLessThan(0);
  });

  it("bring a sideways walk back to where it began after one lap", () => {
    const round = livePose(hold(east, strafeLap(R)), R);
    expect(Math.abs(wrapDelta(round.x, START.x))).toBeLessThan(0.6);
    expect(Math.abs(wrapDelta(round.y, START.y))).toBeLessThan(0.6);
  });

  it("face the way they were pressed when nothing is aiming", () => {
    expect(hold(north, 1).facing).toBe("north");
    expect(hold(south, 1).facing).toBe("south");
    expect(hold(east, 1).facing).toBe("east");
    expect(hold(west, 1).facing).toBe("west");
  });
});

describe("walking diagonally", () => {
  it("walks forward and sideways at once, and the strafe still turns the world", () => {
    const player = hold(walk("northeast"), 2);
    const live = livePose(player, R);
    expect(player.gait).toEqual({ forward: 1, strafe: 1 });
    expect(wrapDelta(live.x, START.x)).toBeGreaterThan(0);
    expect(wrapDelta(live.y, START.y)).toBeGreaterThan(0);
    expect(live.turn).toBeGreaterThan(0);
  });

  it("reaches all four corners", () => {
    const corners = [
      ["northeast", { x: 1, y: 1 }],
      ["northwest", { x: -1, y: 1 }],
      ["southeast", { x: 1, y: -1 }],
      ["southwest", { x: -1, y: -1 }],
    ] as const;
    for (const [heading, sign] of corners) {
      const live = livePose(hold(walk(heading), 1), R);
      expect(Math.sign(wrapDelta(live.x, START.x))).toBe(sign.x);
      expect(Math.sign(wrapDelta(live.y, START.y))).toBe(sign.y);
    }
  });

  it("walks at the same speed as a cardinal, so a zigzag is not a shortcut", () => {
    const diagonal = hold(walk("northeast"), 3).walked;
    const straight = hold(north, 3).walked;
    expect(diagonal).toBeCloseTo(straight, 6);
    const tick = advancePlayer(createPlayer(START), walk("northeast"), FRAME_MS, OPEN).player;
    expect(Math.hypot(tick.stepped.x, tick.stepped.y)).toBeCloseTo(FRAME_MS * WALK_TILES_PER_MS, 9);
  });

  it("slides along the wall it clips instead of stopping dead against it", () => {
    // Rock to the right: the sideways half of the diagonal is refused, so it
    // walks the forward half rather than stopping.
    const sideways = livePose(hold(walk("northeast"), 1, WALL_RIGHT), R);
    expect(wrapDelta(sideways.x, START.x)).toBeLessThanOrEqual(0.5 - REACH_TILES + 1e-9);
    expect(wrapDelta(sideways.y, START.y)).toBeGreaterThan(0.6);

    // Rock straight ahead: the forward half is gone too, so it strafes.
    const ahead = livePose(hold(walk("northeast"), 1, WALL_AHEAD), R);
    expect(wrapDelta(ahead.y, START.y)).toBeLessThanOrEqual(0.5 - REACH_TILES + 1e-9);
    expect(wrapDelta(ahead.x, START.x)).toBeGreaterThan(0.6);
    expect(ahead.turn).toBeGreaterThan(0);
  });

  it("still refuses when neither half of the diagonal is open", () => {
    const corner = advancePlayer(createPlayer(START), walk("southwest"), FRAME_MS, WALLED);
    expect(livePose(corner.player, R)).toEqual(START);
    expect(corner.player.motion).toBe("idle");
    expect(corner.usedHeading).toBe(true);
  });

  it("faces the diagonal it walks", () => {
    for (const heading of ["northeast", "northwest", "southeast", "southwest"] as const) {
      expect(advancePlayer(createPlayer(START), walk(heading), FRAME_MS, OPEN).player.facing).toBe(heading);
    }
  });
});

describe("facingYaw", () => {
  it("turns the rig a quarter per cardinal, clockwise from facing the viewer", () => {
    expect(facingYaw("south")).toBeCloseTo(0, 9);
    expect(facingYaw("east")).toBeCloseTo(Math.PI / 2, 9);
    expect(facingYaw("north")).toBeCloseTo(Math.PI, 9);
    expect(facingYaw("west")).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("puts every diagonal an eighth between its two cardinals", () => {
    expect(facingYaw("southeast")).toBeCloseTo(Math.PI / 4, 9);
    expect(facingYaw("northeast")).toBeCloseTo((3 * Math.PI) / 4, 9);
    expect(facingYaw("northwest")).toBeCloseTo((-3 * Math.PI) / 4, 9);
    expect(facingYaw("southwest")).toBeCloseTo(-Math.PI / 4, 9);
  });
});

describe("aiming", () => {
  it("faces the aim instead of the heading, so he can walk one way and look another", () => {
    const tick = advancePlayer(createPlayer(START), { heading: "north", aim: "south", attack: false }, FRAME_MS, OPEN);
    expect(tick.player.facing).toBe("south");
    // The legs do not care: he still walks north.
    expect(tick.player.motion).toBe("walk");
    expect(scrollPhase(tick.player).y).toBeGreaterThan(0);
    expect(tick.usedHeading).toBe(true);
  });

  it("turns to the aim while standing still", () => {
    const tick = advancePlayer(createPlayer(START), { aim: "northwest", attack: false }, FRAME_MS, OPEN);
    expect(tick.player.facing).toBe("northwest");
    expect(tick.player.motion).toBe("idle");
    expect(tick.usedHeading).toBe(false);
  });

  it("keeps facing the aim for the whole of a held walk", () => {
    expect(hold({ heading: "south", aim: "north", attack: false }, 3).facing).toBe("north");
  });

  it("keeps the last facing when neither aim nor heading says anything", () => {
    const aimed = advancePlayer(createPlayer(START), { aim: "east", attack: false }, 0, OPEN);
    expect(advancePlayer(aimed.player, NOTHING, FRAME_MS, OPEN).player.facing).toBe("east");
  });

  it("faces the aim when walking into rock, not the rock", () => {
    const blocked = advancePlayer(createPlayer(START), { heading: "north", aim: "west", attack: false }, 0, WALLED);
    expect(blocked.player.facing).toBe("west");
    expect(blocked.usedHeading).toBe(true);
  });
});

describe("facing", () => {
  it("turns the instant the input arrives", () => {
    const walking = run(createPlayer(START), east, 3);
    expect(advancePlayer(walking, north, FRAME_MS, OPEN).player.facing).toBe("north");
  });
});

describe("groundPose and scrollPhase", () => {
  it("are still and zero while nothing is happening", () => {
    const idle = createPlayer(START);
    expect(groundPose(idle)).toEqual(START);
    expect(scrollPhase(idle)).toEqual({ x: 0, y: 0 });
  });

  it("hold the sample on whole tiles and carry the rest in the phase", () => {
    // The contract the whole renderer rests on: the world is read from the
    // anchor, and the picture is offset by how far past it he stands.
    const player = hold(north, 0.5);
    expect(groundPose(player)).toEqual(START);
    expect(scrollPhase(player).y).toBeCloseTo(0.5, 6);
    expect(scrollPhase(player).x).toBe(0);
  });

  it("hand a whole tile to the anchor as the phase passes it, so the two cancel", () => {
    let player = createPlayer(START);
    let before = player;
    while (groundPose(player) === groundPose(before)) {
      before = player;
      player = advancePlayer(player, north, FRAME_MS, OPEN).player;
    }
    expect(groundPose(player).y).toBeCloseTo(START.y + 1, 6);
    // The live pose is continuous across the hand-over: one frame's walk, no jump.
    const jump = livePose(player, R).y - livePose(before, R).y;
    expect(jump).toBeCloseTo(FRAME_MS * WALK_TILES_PER_MS, 9);
    expect(scrollPhase(player).y).toBeLessThan(FRAME_MS * WALK_TILES_PER_MS + 1e-9);
  });

  it("keep the phase under a tile on each axis, walking either way", () => {
    for (const heading of ["north", "south", "east", "west", "northwest", "southeast"] as const) {
      const phase = scrollPhase(hold(walk(heading), 2.7));
      expect(Math.abs(phase.x)).toBeLessThan(1);
      expect(Math.abs(phase.y)).toBeLessThan(1);
    }
  });

  it("put a sideways walk on the sideways axis", () => {
    const player = hold(east, 0.5);
    expect(scrollPhase(player).x).toBeCloseTo(0.5, 6);
    expect(scrollPhase(player).y).toBe(0);
  });

  it("slide both axes together through a diagonal", () => {
    const player = hold(walk("northwest"), Math.SQRT2 / 2);
    expect(scrollPhase(player).x).toBeCloseTo(-0.5, 2);
    expect(scrollPhase(player).y).toBeCloseTo(0.5, 2);
  });
});

describe("livePose", () => {
  it("is the anchor whenever he stands on it", () => {
    expect(livePose(createPlayer(START), R)).toEqual(START);
  });

  it("turns continuously through a sideways walk, unlike the ground", () => {
    // The horizon is the only thing far enough away to show the turn smoothly,
    // so this is the one view that must not be quantised.
    const player = hold(east, 0.5);
    expect(livePose(player, R).turn).toBeCloseTo(0.5 / R, 6);
    expect(groundPose(player).turn).toBe(0);
  });

  it("walks the arc, so mid-tile is on the circle rather than across it", () => {
    const half = livePose(hold(east, 0.5), R);
    const whole = livePose(hold(east, 1.0001), R);
    expect(half.y).not.toBeCloseTo((START.y + whole.y) / 2, 9);
  });
});

describe("nextAnchor and upcomingAnchor", () => {
  it("hands back the very same pose for the same whole-tile walk, so work keyed on it can be done early", () => {
    expect(nextAnchor(START, 1, 0, R)).toBe(nextAnchor(START, 1, 0, R));
    expect(nextAnchor(START, 1, 0, R)).not.toBe(nextAnchor(START, 0, 1, R));
    expect(nextAnchor(START, 1, 0, R).y).toBeCloseTo(START.y + 1, 9);
  });

  it("is nothing while he stands", () => {
    expect(upcomingAnchor(createPlayer(START), R)).toBeUndefined();
  });

  it("names the anchor a walk is heading into and how soon, and it is the one he then reaches", () => {
    let player = hold(north, 0.25);
    const upcoming = upcomingAnchor(player, R);
    expect(upcoming?.inMs).toBeCloseTo(0.75 * STEP_MS, 6);
    while (groundPose(player) === START) {
      player = advancePlayer(player, north, FRAME_MS, OPEN).player;
    }
    expect(groundPose(player)).toBe(upcoming?.pose);
  });

  it("knows backward from forward, and sideways", () => {
    expect(upcomingAnchor(hold(south, 0.25), R)?.inMs).toBeCloseTo(0.75 * STEP_MS, 6);
    expect(upcomingAnchor(hold(south, 0.25), R)?.pose).toBe(nextAnchor(START, -1, 0, R));
    expect(upcomingAnchor(hold(west, 0.5), R)?.pose).toBe(nextAnchor(START, 0, -1, R));
  });

  it("takes both axes of a diagonal that reach their edges together", () => {
    const player = hold(walk("northeast"), 0.3);
    expect(upcomingAnchor(player, R)?.pose).toBe(nextAnchor(START, 1, 1, R));
  });
});

describe("walkClipMs", () => {
  it("is one stride per tile, the next leading with the other leg", () => {
    const first = { ...createPlayer(START), motion: "walk" as const, walked: 0 };
    expect(walkClipMs(first, 400)).toBe(0);
    expect(walkClipMs({ ...first, walked: 1 }, 400)).toBe(200);
    expect(walkClipMs({ ...first, walked: 2.5 }, 400)).toBe(100);
  });

  it("counts every tile walked, in any direction", () => {
    expect(hold(south, 2).walked).toBeCloseTo(2, 1);
    expect(hold(walk("southwest"), 2).walked).toBeCloseTo(2, 1);
  });
});

describe("attacking", () => {
  it("runs the sword arm's own clock for exactly as long as the swing lasts", () => {
    const swinging = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN);
    expect(swinging.attacked).toBe(true);
    expect(attackProgress(swinging.player)).toBe(0);

    const mid = advancePlayer(swinging.player, { attack: true }, ATTACK_MS - 1, OPEN);
    expect(attackProgress(mid.player)).toBeCloseTo((ATTACK_MS - 1) / ATTACK_MS, 5);
    // One swing, one report - the queue is not spent again mid-animation.
    expect(mid.attacked).toBe(false);

    const settled = advancePlayer(mid.player, NOTHING, 1, OPEN);
    expect(settled.player.attackMs).toBeUndefined();
    expect(attackProgress(settled.player)).toBeUndefined();
  });

  it("swings again when the button is still held after the first one lands", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN).player;
    const second = advancePlayer(first, { attack: true }, ATTACK_MS, OPEN);
    expect(second.attacked).toBe(true);
    expect(second.player.attackMs).toBe(0);
  });

  it("never carries more than one swing's worth, however long the tab slept", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN).player;
    expect(advancePlayer(first, { attack: true }, 10_000, OPEN).player.attackMs).toBe(ATTACK_MS);
  });

  it("leaves him standing still when he is only attacking", () => {
    const tick = advancePlayer(createPlayer(START), { attack: true }, FRAME_MS, OPEN);
    expect(tick.player.motion).toBe("idle");
    expect(livePose(tick.player, R)).toEqual(START);
  });
});

describe("attacking while moving", () => {
  it("starts both on the same frame, and faces where he is going", () => {
    const tick = advancePlayer(createPlayer(START), { heading: "north", attack: true }, FRAME_MS, OPEN);
    expect(tick.attacked).toBe(true);
    expect(tick.player.attackMs).toBe(0);
    expect(tick.player.motion).toBe("walk");
    expect(tick.player.facing).toBe("north");
    expect(tick.usedHeading).toBe(true);
  });

  it("keeps walking at full speed through a swing", () => {
    const swinging = run(createPlayer(START), { heading: "north", attack: true }, 20);
    const walking = run(createPlayer(START), north, 20);
    expect(livePose(swinging, R).y).toBeCloseTo(livePose(walking, R).y, 9);
    expect(swinging.attackMs).toBeDefined();
  });

  it("lets the swing end without disturbing the walk under it", () => {
    const swinging = advancePlayer(createPlayer(START), { heading: "east", attack: true }, 0, OPEN).player;
    const later = advancePlayer(swinging, east, ATTACK_MS, OPEN).player;
    expect(later.attackMs).toBeUndefined();
    expect(later.motion).toBe("walk");
  });
});

describe("the swing's contact beat", () => {
  it("lands exactly once, on the frame the clock passes it", () => {
    let player = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN).player;
    let strikes = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      const tick = advancePlayer(player, NOTHING, FRAME_MS, OPEN);
      strikes += tick.struck ? 1 : 0;
      if (tick.struck) {
        expect(player.attackMs).toBeLessThan(SWING_CONTACT_MS);
        expect(tick.player.attackMs ?? ATTACK_MS).toBeGreaterThanOrEqual(SWING_CONTACT_MS);
      }
      player = tick.player;
    }
    expect(strikes).toBe(1);
  });

  it("lands once per swing when the button is held", () => {
    let player = createPlayer(START);
    let strikes = 0;
    for (let frame = 0; frame < Math.ceil((ATTACK_MS * 3) / FRAME_MS); frame += 1) {
      const tick = advancePlayer(player, { attack: true }, FRAME_MS, OPEN);
      strikes += tick.struck ? 1 : 0;
      player = tick.player;
    }
    expect(strikes).toBe(3);
  });
});

describe("casting", () => {
  it("runs its own clock beside the sword and the legs, and never waits for them", () => {
    const tick = advancePlayer(createPlayer(START), { heading: "east", attack: true, cast: true }, FRAME_MS, OPEN);
    expect(tick.cast).toBe(true);
    expect(tick.attacked).toBe(true);
    expect(tick.player.castMs).toBe(0);
    expect(tick.player.attackMs).toBe(0);
    expect(tick.player.motion).toBe("walk");
  });

  it("releases once, at the clip's release beat", () => {
    let player = advancePlayer(createPlayer(START), { attack: false, cast: true }, 0, OPEN).player;
    const releases: number[] = [];
    for (let elapsed = FRAME_MS; elapsed <= CAST_CYCLE_MS + FRAME_MS; elapsed += FRAME_MS) {
      const tick = advancePlayer(player, NOTHING, FRAME_MS, OPEN);
      if (tick.released) {
        releases.push(elapsed);
      }
      player = tick.player;
    }
    expect(releases).toHaveLength(1);
    expect(releases[0]).toBeGreaterThanOrEqual(CAST_RELEASE_MS);
    expect(releases[0]).toBeLessThan(CAST_RELEASE_MS + FRAME_MS);
    expect(player.castMs).toBeUndefined();
  });

  it("fires at a steady rhythm while held: clip plus cooldown", () => {
    let player = createPlayer(START);
    const starts: number[] = [];
    for (let elapsed = 0; elapsed < CAST_CYCLE_MS * 3; elapsed += 10) {
      const tick = advancePlayer(player, { attack: false, cast: true }, 10, OPEN);
      if (tick.cast) {
        starts.push(elapsed);
      }
      player = tick.player;
    }
    expect(starts).toHaveLength(3);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBe(CAST_CYCLE_MS);
    expect(CAST_COOLDOWN_MS).toBeGreaterThan(0);
    expect(castProgress(player)).toBeGreaterThan(0);
  });
});

describe("the heading he remembers", () => {
  it("keeps all eight, including diagonals the drawing cannot show", () => {
    expect(createPlayer(START).heading).toBe("south");
    const tick = advancePlayer(createPlayer(START), walk("northeast"), FRAME_MS, OPEN);
    expect(tick.player.heading).toBe("northeast");
    expect(advancePlayer(tick.player, NOTHING, STEP_MS * 2, OPEN).player.heading).toBe("northeast");
  });
});

describe("enchanting the blade", () => {
  it("toggles once per press and reports it", () => {
    const lit = advancePlayer(createPlayer(START), { attack: false, enchant: true }, 0, OPEN);
    expect(lit.toggled).toBe(true);
    expect(lit.player.enchanted).toBe(true);
    const still = advancePlayer(lit.player, NOTHING, FRAME_MS, OPEN);
    expect(still.toggled).toBe(false);
    expect(still.player.enchanted).toBe(true);
    const out = advancePlayer(still.player, { attack: false, enchant: true }, FRAME_MS, OPEN);
    expect(out.player.enchanted).toBe(false);
  });
});

describe("passable", () => {
  it("asks the world and nothing else - a round planet has no edge to fall off", () => {
    const rocky: PlanetPoint = { x: 5, y: 5 };
    expect(passable(OPEN, rocky)).toBe(true);
    expect(passable(WALLED, rocky)).toBe(false);
    // Every coordinate is somewhere, however far outside one lap it is written.
    expect(passable(OPEN, { x: -900, y: 9000 })).toBe(true);
  });
});
