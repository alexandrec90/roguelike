---
description: How a frame is drawn — the full-colour palette, baked and per-frame surfaces, the lighting pass, the atmosphere, and the performance budget
paths:
  - src/game/**/*.ts
---

# Rule: Drawing a frame

`art-pipeline.md` says what to draw and `procedural-effects.md` how to simulate it. This
rule says **how pixels reach the screen**, and what that is allowed to cost. It exists
because the first full-colour build ran at 32 fps on an integrated GPU, and every clause
below is a measured fix for a part of that frame.

## The palette is full colour, and still closed

The one-bit neon field is gone. `src/game/palette.ts` defines **material families** —
`grass`, `meadow`, `leaf`, `pine`, `autumn`, `bark`, `earth`, `stone`, `moss`, `water`,
`fire`, `smoke`, `skin`, `hair`, `tunic`, `leather`, `crimson`, `metal`, `gold`,
`slime`, `arcane`, `frost`, `petal` — each an ordered ramp, darkest first, hue-shifted
(shadows cool, highlights warm). The ink `grass-3` is step 3 of the grass ramp;
`INK_RAMPS.<family>` is the whole ramp. Two single inks, `shadow` and `shadow-soft`, are
sheer: a cast shadow darkens what it falls on rather than replacing it.

What survives from the old rule is the part that did the work: **art names inks, never
hexes.** A new colour is a new step in a family, added in `palette.ts`. The legacy inks
(`bone`, `cyan`, `void`, …) still resolve so old art keeps working; new art uses families.
The sky is the one continuous gradient, and the only place colour is computed - which
includes the air it lays over the far edge of the world: the horizon lip's haze is a
tint in eight dithered steps, and the clouds are three computed tones.

## Three ways to get pixels on screen — pick by how often they change

| Changes | Mechanism | Module |
| --- | --- | --- |
| Never, or per parameter (a tile variant, a tuft at a bend, a tree at a lean) | **Bake** once into a texture with `installStrip` / `installBuffer`, then only choose frames | `pixel-surface.ts` |
| Every frame, and more than ~200 pixels (the hero, a slime, a flame) | A **`PixelSurface`**: `clear()`, `paint(cloud, x, y)`, `commit()` — one upload, one quad | `pixel-surface.ts` |
| Every frame, a few dozen pixels (fireflies, a bolt) | `drawCloud` into a `Graphics` | `draw-cloud.ts` |

**Never** fill hundreds of pixels a frame through `Graphics.fillRect`, and **never** draw
through a per-frame `GameObjects.Shader`: the volume shader re-uploaded forty uniforms per
object per frame and cost 7.5 ms. It still exists — the tree lab renders with it and
diffs it against the CPU — but the game draws scenery from bakes.

## Scenery is baked, not rendered

`scenery-bake.ts` poses a species at each of `WIND_LEVELS` by stepping it under a wind
held fixed (`WindOptions.fixed`) until its own springs settle, then flattens body, outline
and cast shadow to buffers. `scenery-cache.ts` turns those into textures: one bake per
body per lean per light, a newly seen body baking only the lean it needs *now* and
queueing the rest (one bake per frame within `BAKE_BUDGET_MS`), bodies on the horizon
roll re-sampled at a quantised scale and warming their full-size leans as they approach,
and a re-bake when the sun crosses a step that keeps the old picture until the new one is
whole. `scenery-layer.ts` only chooses: the lean nearest the travelling wind at the body's
planet point, eased.

Which body stands where is `scenery-features.ts`: seeded lattices of trees (a weighted
species mix), bushes, boulders and mushroom rings over the planet.

## Light is one pass over the whole frame

`atmosphere.ts` is the time of day as a pure function: the screen-space light direction
(sun by day, moon by night, rising left and setting right), its height, shadow strength,
the ambient multiply colour, the sky's colours and the stars. `world-clock.ts` runs it
(`?time=` pins it, `?day=` sets its length) and owns hit stop and shake (`impulse.ts`).

`lighting-layer.ts` multiplies the world by the ambient and adds every `LightSource` the
layers pushed this frame (`lights.ts`: baked, banded, dithered pools), and a faint additive halo
round each light at night. Drifting cloud shadows (`cloud-shadow.ts`) are a pass of
their own under every standing thing, on the ground only, and `FrameContext.shade` hands
the same pattern to each standing layer to tint itself at its foot, so a tower above the
horizon line is shaded with the ground it stands on rather than cut by the sky rows. So:

- **A layer never darkens itself for the night.** It draws its daylight colours; the pass
  does the rest. A flame stays bright because it sits at the centre of its own pool.
- **Anything that emits light pushes a `LightSource`** into `ctx.lights`, in screen
  pixels, with a `flicker` if it burns.
- **The sky is painted pre-divided by the ambient**, so after the multiply it lands on
  the atmosphere's own colours. Anything else drawn in the band must do the same or be
  a body that is meant to be lit.

## Every layer reads one `FrameContext`

`frame-context.ts`: camera frame, ground pose, elapsed and delta (hit-stop aware),
atmosphere, wind, rain, and two outboxes — `lights` and `impulse`. The scene builds it once
per frame with `beginFrame`; no layer derives time, light or weather for itself.
Ground-riding things that are not planet features (cloud shadows, fireflies, pollen) move
with `odometer.ts`.

## The budget

Measured on an Intel HD 530. A frame is 16.7 ms; the JS half of it should stay near 8.

| Where | Budget | How it stays there |
| --- | --- | --- |
| Scenery | ~1 ms + ≤ 3 ms of queued bakes | textures chosen per frame; bakes sliced |
| Ground | ~0.5 ms | composed once per step into one surface |
| Grass | ~1 ms | a baked tuft atlas; frames chosen from the wind |
| Horizon lip | ~1.6 ms; ~7 ms on the frame a step lands. Water added ~1 ms a frame and ~2–3 ms a step, measured on a faster machine | one surface; the lattice read on demand, and never under a far pixel (far looks, counted once at load - tens of ms - and one hash a far pixel); tufts packed once and kept in an overlay a step, only the three swaying rows re-stamped; puddle outlines and bodies cached by shape |
| Landforms | ~0.1 ms in open land; ~5 ms median beside a mountain, measured on a faster machine | a planet-fixed grid per landform, built once; the march visits only the columns each covers; far views kept between strides; one atlas upload of only the rows in use |
| Each actor | ≤ 0.5 ms | small surfaces, caches keyed by quantised pose |
| Lighting | ~0.5 ms | one render texture, a stamp per light |

A change that adds a per-frame cost names it in the budget, and is measured in the running
page (`window.__game` in a dev build) — not guessed.

## The API, in one table

Export-checked by `src/game/rendering-rule.test.ts`, so it cannot rot.

| Module | Symbols |
| --- | --- |
| `palette.ts` | `INK_FAMILIES` · `familyRamp` · `rampSlice` · `familyHex` |
| `pixel-buffer.ts` | `createBuffer` · `paintInto` · `bakeCloud` · `blitBuffer` · `compositeOver` |
| `pixel-surface.ts` | `PixelSurface` · `installStrip` · `installBuffer` |
| `scenery-bake.ts` | `WIND_LEVELS` · `settleAt` · `bakePose` · `bakeScaled` · `outlineCloud` · `quantizeLight` |
| `scenery-cache.ts` | `SceneryCache` |
| `scenery-features.ts` | `sceneryNear` · `PLACED_SPECIES` |
| `atmosphere.ts` | `atmosphereAt` · `clockHours` · `parseTime` |
| `lights.ts` | `flicker` · `lightFalloff` · `lightPool` |
| `lighting-layer.ts` | `LightingLayer` · `LIGHTING_DEPTH` |
| `frame-context.ts` | `beginFrame` |
| `impulse.ts` | `kickShake` · `kickHitStop` · `stepImpulse` · `shakeOffset` |
| `fx/particles.ts` | `createPool` · `emit` · `stepParticles` · `particleCloud` |
| `combat.ts` | `strikeHits` · `strikePush` |
