---
description: How to simulate rather than draw — emitters, fields, noise, automata, SDFs, decals and impulse, and the seeding rules that keep them reproducible
paths:
  - src/game/**/*.ts
---

# Rule: Simulating, not drawing

`art-pipeline.md` covers the things that have a silhouette: characters, gear, tiles,
props. **This rule covers everything else on screen** — fire, smoke, blood, spells,
weather, impacts, spreading corruption — and the answer there is never a sprite sheet.
An effect is a *simulation whose output happens to be pixels*.

That is not a compromise. It is the reason the game can look coherent while being built
this way: a drawn explosion is one explosion, while an emitter with a seed, a field and
a ramp is every explosion, and it already agrees with the lighting, the palette and the
pixel grid because those are inputs to it rather than decisions made in a paint program.

## The vocabulary

Nine primitives cover almost every effect this game will ever need. Before writing an
effect, name which of these it is; if it is two of them, it is two of them composed, not
a tenth thing.

| Primitive | It is | Reach for it when |
| --- | --- | --- |
| **Emitter** | a pooled, capped, seeded set of short-lived particles | sparks, blood, embers, debris, rain, dust, gore |
| **Field** | a function `(x, y, t) → vector` that particles sample | wind, magical currents, swirling souls, updraft over fire |
| **Noise** | a function `(x, y, t) → scalar`, smooth and seeded | smoke, fog, cloud, flame wander, distortion, terrain |
| **Automaton** | cell state on a grid, stepped by a local rule | spreading fire, creeping ice, corrosion, growth |
| **SDF shape** | a signed-distance test rasterised to lit pixels | rings, cones, arcs, beams, runes, telegraphs, shockwaves |
| **Branch** | a recursively subdivided polyline, seeded | lightning, cracks, roots, veins, fractures |
| **Ramp** | ordered inks walked by level or by time | glow, heat falloff, energy that circulates, lava |
| **Decal** | a cloud stamped into the ground layer, fading over time | scorch marks, blood pools, footprints, frost |
| **Impulse** | a scalar over time applied to the camera or the clock | screen shake, hit stop, punch-in, chromatic kick |

Two of these exist today: `src/game/spark-emitter.ts` is the emitter, and
`src/game/weather.ts` is a branch (`lightningBolt`) plus a schedule. The ramp is
`src/game/shading.ts`. **The rest are unbuilt, and building one is the right answer to
the first effect that needs it** — write the primitive, not the one-off.

## What an effect is made of

A new effect is assembled, not authored:

1. **Which primitive(s)** — from the table above.
2. **A seed**, taken as an argument. Never `Math.random()`.
3. **A ramp**, so its colour is the palette's decision rather than the effect's.
4. **A cap** — a maximum particle count, a maximum radius, a maximum lifetime.
5. **A gameplay beat that starts it**, and a beat that ends it.

A worked example, and the shape a prompt for one should reduce to:

> A frost nova: an SDF ring expanding for 180 ms, an emitter of ice fragments pushed
> outward along the ring normal, a Voronoi crack decal held for 3 s, all inked from
> `INK_RAMPS.tide` and seeded from the caster's turn number.

Every noun in that is a primitive that already exists or is worth building once.

## Determinism is the contract, not a nicety

The asset lab must reproduce a capture byte for byte, and the turn simulation must not
be able to disagree with the picture. So:

- **Every random draw is seeded.** `pixelHash(x, y, seed, salt)` in
  `src/game/transforms.ts` is the hash; emitters take a seed in their config. A single
  `Math.random()` anywhere in an effect makes the whole effect untestable.
- **Effects are functions of elapsed time**, not of accumulated frames. `lightningAt`
  in `src/game/weather.ts` is the model: given `(elapsedMs, seed)`, it returns the whole
  storm's state with no history.
- **Step with a clamped delta.** `MAX_STEP_MS` exists because a tab that was backgrounded
  for four seconds must not advance an emitter four seconds in one step.
- **Pool and cap.** Allocation per particle per frame is the one performance mistake that
  is hard to undo later; `createEmitter` allocates its pool once, and new emitters do the
  same.
- **Presentation never decides an outcome.** An effect reads the simulation and may
  exaggerate it wildly; it may not write back to it. A miss that looks like a hit is a
  bug in this direction only.

## The pixel grid binds effects too

Everything in `CLAUDE.md`'s pixel contract applies to a particle just as it does to a
sprite, and it is easier to break here because particle code is written in floats:

- **Round to logical pixels at draw time**, never before — accumulate position in floats,
  snap on the way out, so slow motion still moves.
- **No sub-pixel smear, no rotation, no fractional scale.** A 1px ember is 1px.
- **Alpha is dithered, not blended.** A half-faded particle is a `BAYER_4X4` test against
  its remaining life, or a step down its ramp — not 50% opacity, which produces colours
  that are not in the palette.
- **Inks, not hexes.** An effect that needs a colour picks a ramp.

## The effect field — the direction worth building toward

**This does not exist yet.** It is written down because it is where the elemental part
of the game should go, and because an agent asked for "fire that spreads" should build
a piece of it rather than an animation of it.

Under the tiles, one grid of cell state — fire, water, ice, electricity, poison,
corruption — stepped as an automaton beside `src/game/field.ts`, with combination rules
rather than bespoke pairings:

| Combination | Result |
| --- | --- |
| fire + grass | flames spread along the grass, leaving scorch decals |
| fire + water | steam: an emitter with an updraft field, both cells consumed |
| electricity + water | branching arcs across every connected wet cell |
| ice + water | a frozen surface: a solid cell with a new tile ink |
| fire + ice | fog, and a cold cell that survives one more step |

The payoff is that the interesting behaviour is emergent and cheap to extend: a new
element is a column in that matrix, not a new set of animations for every surface it can
touch. Build it incrementally — one element and one interaction at a time — and keep the
step function pure so it tests without a scene.

## Never

- **Never draw an effect frame by frame.** A drawn explosion is dead weight; it cannot be
  scaled, tinted, seeded, or made to agree with the model it is on top of.
- **Never generate an effect sprite sheet from an image model.** It will not share the
  palette, the pixel size or the dither pattern, and the mismatch is most visible exactly
  where effects overlap the characters.
- **Never let an effect own a colour.** It owns a ramp id.
- **Never ship an effect that is not in the lab.** Add it to `ASSET_REGISTRY` with an
  `effect` id and capture it at a fixed `t`; see `/art-check`.
