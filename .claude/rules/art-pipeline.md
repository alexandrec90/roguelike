---
description: How to draw and animate in the 1-bit ink pipeline — write mechanisms, never hand-drawn frames
paths:
  - src/game/**/*.ts
---

# Rule: Drawing and animating

Everything renderable in this game flattens to a **pixel cloud** — an ordered list of
`{x, y, ink}`, later wins. That one representation is why a single `meltCloud` melts the
hero, a slime, and a signpost, and why a new attack is a handful of direction vectors
instead of eight drawings.

So the job here is almost never "draw the picture". It is **"find the mechanism that
produces the picture, and the family of pictures next to it."** A mechanism is written
once, tested once, and every future model gets it free. A frame is written once and
helps nothing else, ever.

## Spend the fewest tokens that can produce the picture

Rungs, cheapest first. **Stop at the first one that works.** Reaching for a higher rung
when a lower one would do is the single most expensive mistake available in this
codebase — it costs tokens now and costs them again on every asset that follows.

| # | Mechanism | Cost | Buys you |
| --- | --- | --- | --- |
| 0 | **Palette variant** — a `PaletteVariant` in `asset-registry.ts` | 1 line | Any existing art in new inks: frost, cursed, poisoned |
| 1 | **An existing transform at a new progress** | 0 lines | A half-melted statue, a part-frozen enemy, a scorched prop |
| 2 | **A new cloud transform** in `transforms.ts` | ~20 lines | A status effect on *every* model that exists or ever will |
| 3 | **A new clip** in `models.ts` | 3–5 keyframes | A whole action: kick, parry, bow-draw, stagger |
| 4 | **A new gear part** in `models.ts` | 1–8 lines | An item, worn and animated by clips that already exist |
| 5 | **A particle effect** — an emitter over 1–4px primitives | ~15 lines | Spells, impacts, weather, blood, embers |
| 6 | **A new skeleton and model** | ~40 lines | A creature with a shape the humanoid cannot pose |
| 7 | **Hand-authored frames** | expensive, and dead weight forever | **Props and tiles only. Never a character.** |

**Never draw frame N+1 of something you already drew frame N of.** If you find yourself
writing a second mask that is the first one shifted, recoloured, or sagging, you wanted
rung 2 or rung 3 and you are on rung 7.

## "I want X" → the one file to open

Open the file in the last column. In almost every row you should not need to read any
other module; the API table below covers the calls.

| The ask | The mechanism | Open |
| --- | --- | --- |
| A sword, staff, bow — gear that **moves** | a `bone` part; clips key it by name like a limb | `src/game/models.ts` |
| A hat, pauldron, eyes — gear that **rides** a joint | a `stamp` part | `src/game/models.ts` |
| Armour, a scar, a glow — gear that **recolours** | a `reink` part | `src/game/models.ts` |
| An attack, a dodge, an emote | a `Clip` | `src/game/models.ts` |
| Burning, freezing, petrifying, dissolving | a cloud transform | `src/game/transforms.ts` |
| A projectile, an impact, a spell trail | a seeded emitter | `src/game/spark-emitter.ts` |
| Rain, snow, lightning, wind | an emitter or a seeded polyline | `src/game/weather.ts` |
| A puddle, a pool, water on the ground | a seeded outline plus its surface layers | `src/game/puddles.ts` |
| A ring spreading from an impact | a pooled `Ripple`, aged by a clock | `src/game/ripples.ts` |
| Where the water *is* in the sample scene | a `PuddleSite`, one line of data | `src/game/field.ts` |
| A recolour of anything at all | a `PaletteVariant` | `src/game/asset-registry.ts` |
| A new creature | reuse `HUMANOID_SKELETON` if it is bipedal; else a new `SkeletonDef` | `src/game/models.ts` |
| A rock, a tree, a tile — it never moves | an authored mask | `src/game/sprites.ts`, `src/game/tiles.ts` |
| The same model facing **left** | nothing — pass `flipX` | — |
| The same model facing **away** | nothing — pass `facing: "back"` | — |
| A melting / frozen / burning **frame** | nothing — call the transform at a progress | — |
| A reflection in water | nothing — `reflectCloud` | — |

The last four rows are there because they are the four things an agent reflexively draws
and must not.

## The API, in one table

Enough to write any of the above without opening the module. Every symbol here is
export-checked by `src/game/art-pipeline-rule.test.ts`, so this table cannot rot.

| Module | Symbols | Use |
| --- | --- | --- |
| `ink.ts` | `INK_COLORS` · `INK_TOKENS` · `INK_ALPHA` · `inkHex` · `BACKGROUND` · `maskFromRows` · `mirrorMask` · `stampMask` · `strokeLine` · `mirrorCloud` · `translateCloud` · `cloudBounds` · `cloudToSprite` | Inks, text masks, and the cloud primitives |
| `rig.ts` | `vec3` · `ZERO` · `solvePose` · `samplePose` · `renderModel` · `equip` · `projectRigPoint` · `effectiveSkeleton` · `partBoneNames` · `validateSkeleton` · `validateClip` · `validateModel` | Posing, sampling, rendering, dressing |
| `models.ts` | `HUMANOID_SKELETON` · `HUMANOID_BASE` · `HERO_MODEL` · `HERO_EQUIPPED` · `HERO_CLIPS` · `SWORD` · `HAT` · `ARMOR` · `IDLE` · `WALK` · `SWING` · `CAST` | The authored humanoid, its gear, its clips |
| `transforms.ts` | `meltCloud` · `freezeCloud` · `burnCloud` · `burnFront` · `reflectCloud` · `pixelHash` | Status effects and water, as pure functions |
| `spark-emitter.ts` | `createEmitter` · `stepEmitter` · `resetEmitter` · `particleAlpha` · `DEFAULT_EMITTER` · `MAX_STEP_MS` | The pooled, seeded particle system |
| `weather.ts` | `createRain` · `lightningBolt` · `lightningAt` · `RAIN_FALL_SPEED` · `RAIN_SLANT` | Rain, its wind, and the storm schedule |
| `puddles.ts` | `createPuddle` · `puddleHolds` · `clipToPuddle` · `puddleSurface` · `puddleGlints` · `puddleReflection` · `rainImpact` · `samplePuddleFrames` | Standing water: its shape, what it shows, and where a drop goes in |
| `ripples.ts` | `createRippleField` · `spawnRipple` · `stepRipples` · `resetRipples` · `rippleAlpha` · `rippleCloud` · `sampleRippleFrames` | The rings a drop leaves — a pool, a clock, an outline |
| `rig-frames.ts` | `RIG_FRAME` · `sampleClipFrames` · `sampleMeltFrames` | Baking clips and transforms into lab filmstrips |

The three shapes worth having in front of you, field names only:

```ts
Keyframe { t: 0..1; bones?: { [name]: Vec3 }; root?: Vec3 }   // sparse — key only what moves
RigPart  { kind: "stamp"; bone; at; mask; anchor; ink; facing? }
         | { kind: "bone"; bone: BoneDef; ink; thickness?; direction? }
         | { kind: "reink"; bones: string[]; ink }
```

## Recipes

**A new item.** One `RigPart` in `models.ts`, then `equip(HERO_MODEL, THING)`. A `bone`
part with no `direction` extends its parent, which is why a sword tracks the arm through
every existing clip for free — you get `SWING`, `WALK` and `IDLE` without touching them.
Add it to `ASSET_REGISTRY` only if you want it in the lab.

**A new attack.** One `Clip` in `models.ts`, added to `HERO_CLIPS`. Key only the bones
that move, at the beats that matter — anticipation, contact, settle is usually three
keys:

```ts
{ id: "kick", durationMs: 480, loop: false, keys: [
  { t: 0.3, bones: { "leg-r": vec3(0.3, -0.8, -0.6) } },   // windup: away from camera
  { t: 0.5, bones: { "leg-r": vec3(0.3, 1, -0.3) } },      // contact: toward camera
  { t: 1,   bones: { "leg-r": vec3(0.3, 0, -1) } },        // settle back to base
]}
```

Unkeyed bones hold the base pose, so a three-key clip is a complete animation. Validate
with `validateClip(clip, HUMANOID_SKELETON, partBoneNames(model))` in the test.

**A new status effect.** One function in `transforms.ts`:
`(cloud, progress, seed) => PixelCloud`. Identity at progress 0, deterministic always,
seeded through `pixelHash` and never `Math.random`. Write it against the cloud, not
against the hero — if it reads `pixel.ink` or `pixel.y` only, it already works on every
model in the game.

**A spell or an impact.** `createEmitter` with a seed, stepped by the scene, drawn as
1–4px primitives. A fireball is an emitter positioned from the `CAST` clip's release
beat — not a drawn projectile sprite. Where the fire *is* on a burning model,
`burnFront` already tells you, so the flame and the sprite agree for free.

**A puddle.** A line in `PUDDLE_SITES` (`field.ts`) — a cell, a radius, a seed. Nothing is
drawn: `createPuddle` grows a foreshortened outline with seeded lobes in it, and the four
layers over it are `puddleSurface` (stamp once), `puddleGlints`, `puddleReflection` and
`rippleCloud`. Two of them are pure functions of time, so a capture at *t* is repeatable.
What makes water read on pitch black is the lit rim, the glints and what it gives back —
never a darker fill, which on this background is a hole.

**Rain that lands.** The wind is one number, `RAIN_SLANT`: the emitter's `windX` derives
from it and `RAIN_STREAK` is drawn leaning by exactly it, so the trail always points where
the drop is going. To make weather leave a mark, hand the drop's segment — its position
now, and `vx`/`vy` times the clamped delta back — to `rainImpact`, rather than testing its
current pixel; a drop moving several pixels a frame otherwise steps straight over a puddle.

**A mark lands *in* the thing it marks, not on the near side of it.** The first pixel a
falling segment shares with a puddle is always on the puddle's **far rim**, because the
segment comes down the screen — so a ring opened there has most of itself outside the
water and is clipped away to an arc. This is not a puddle problem; it is what happens
whenever a marker is placed at the first intersection of a downward path with a
foreshortened ground shape. The projection has thrown away the depth that would say
where the drop really landed, so `rainImpact` gives it one: it walks the chord the drop
would cut and lands at a seeded fraction along it. The tests were green and the rings were
spawning at the right rate the whole time this was wrong; only the screen showed it.

## Non-negotiable

- **The ink set is closed.** No asset writes a hex value. A new colour is a new entry in
  `INK_COLORS` and `INK_TOKENS`, added deliberately, with a token nothing else uses.
  `void` is deliberate black for punching holes into a lit silhouette.
- **Transparency is a property of the ink, not of the call site.** An ink's opacity is
  `INK_ALPHA` and `inkHex` spells it, so `water` is sheer everywhere it is used and
  nowhere does a draw call invent an alpha for a colour. A scene may still dim a whole
  *layer* — that is lighting, and it multiplies the ink's own alpha rather than replacing
  it.
- **Rig space is 3D**: x right, **y toward the viewer** (positive = nearer, down-screen),
  z up. Animate by moving bone directions through that space. Rotating on the screen
  plane is the thing this pipeline exists to avoid.
- **Clouds are foot-anchored.** `(0, 0)` is the foot on the ground; y is negative going
  up. "The ground" is `y = 0` in every transform.
- **Front and back only.** Back negates depth and drops `facing: "front"` stamps. Left
  and right are `flipX`. There is no third drawing.
- **Seeded or it does not ship.** Every random draw goes through `pixelHash` or an
  emitter seed, because the lab must reproduce a capture byte for byte.
- The projection and pixel-grid contracts in `CLAUDE.md` still bind — in particular,
  never scale a sprite to fake foreshortening.

## Verify it in the lab, always

Green tests do not prove art looks right. Add the asset to `ASSET_REGISTRY` and open it:

`/lab.html?asset=<id>&variant=authored&zoom=6&bg=duo&play=0&frame=<n>`

`bg=duo` shows it on dark and light at once; `play=0` pins the frame so captures are
byte-identical. `window.assetLab.snapshot()` returns a PNG data URL. Every registry
entry needs at least one palette swap beyond `authored` — `validateRegistry` enforces it.
