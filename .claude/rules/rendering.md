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

Every texture here is a **byte texture uploaded straight from its buffer**
(`textures.addBytes`, `Texture.uploadRows`), never a canvas: a canvas cost a `putImageData` and a second
copy per commit, ~0.7 ms a frame across a scene's surfaces. A surface whose
drawing keeps to a band clears and uploads only that band
(`clearRows`, `commit(rows)`) - the water surface covers the screen and changes
only where the puddles are. A set of pictures goes in as one texture with a
frame each (`installFrames`), not a texture per picture.

**Never** fill hundreds of pixels a frame through `Graphics.fillRect`, and **never** draw
*one shader per object*: the volume shader re-uploaded forty uniforms per
object per frame and cost 7.5 ms. It still exists — the tree lab renders with it and
diffs it against the CPU — but the game draws scenery from bakes. A handful of
full-frame shader passes (`scene.add.pass`), off the display list, is a different thing and the
right tool for per-pixel work (below).

## The renderer is ours

`src/engine/` replaced Phaser, and is the whole of what stands between a layer and the
GPU (`src/engine/index.ts` maps its modules). What a layer can rely on:

- **One depth-sorted list, one batch.** Every `Image`, `Blitter`, `Graphics`,
  `Rectangle` and `RenderTarget` sorts by `depth`, ties broken by the order added; the
  batch draws them in as few calls as textures (up to 16 a call) and blend modes
  allow — ~20 draw calls and ~0.4 ms of CPU for a whole frame on the HD 530, where
  Phaser took ~1 ms.
- **Phaser's pixel rules, kept.** Origin as a share of the frame (default 0.5), a crop
  shown where it sat in the frame, unscaled corners rounded to whole pixels,
  premultiplied blending with Phaser's factors (`src/engine/blend.ts`). A port that moved a
  pixel would show in a capture; the deterministic diff against Phaser found only
  one-pixel dither shifts where a half-texel stamp is the GPU's tie to break.
- **A shader pass runs when asked.** `pass.render()` clears its target and draws there
  and then, so a chain of passes reads each other within one update. Uniforms are set by
  the type the program reports; an array goes by its first element, `u_ramp[0]`.
- **A pass's target is GL-way-up.** Row 0 of a framebuffer is the *bottom* of the
  picture, which is what the passes' `gl_FragCoord` arithmetic assumes; the batch flips
  such a texture when it is drawn as an image (`Texture.flipY`). A byte texture is
  top-row-first.
- **It allocates nothing per frame.** Measured: with the scene's update switched off,
  the heap does not grow. Every byte of garbage is the layers'.
- **WebGL lives in five files.** `src/engine/batcher.ts`, `src/engine/pass.ts`,
  `src/engine/texture.ts`, `src/engine/render-target.ts` and `src/engine/game.ts` (plus
  `gpu/float-texture.ts`) are the only code that
  touches the context; layers see `Scene`. A WebGPU backend would replace those and port
  the passes' GLSL to WGSL, checked against the CPU references that already exist - worth
  it when something needs compute shaders, not before.

## Scenery is baked, not rendered

`scenery-bake.ts` poses a species at each of `WIND_LEVELS` by stepping it under a wind
held fixed (`WindOptions.fixed`) until its own springs settle, then flattens body, outline
and cast shadow to buffers. **Bakes never run on the frame:** `scenery-baker.ts` runs
them on Web Workers (`scenery-bake-worker.ts`, over the pure `scenery-bake-jobs.ts`), and
`scenery-cache.ts` only submits jobs and uploads what comes back within a per-frame
budget. Variety is bounded on purpose — every body is one of `SCENERY_VARIANTS` shapes
per species (`scenery-features.ts`) — so the whole wood is a few dozen bodies, all asked
for at `create`, and the scene holds its first frame behind a fade until each has a
picture. A body is never hidden for want of a bake it once had: a horizon body shows
its last light's ladder until this light's is back, and a re-bake for a new sun keeps the
old picture until the new one is whole. `scenery-layer.ts` only chooses: the lean nearest
the travelling wind at the body's planet point, eased.

A body's horizon pictures are **one ladder**: every scale step from a speck to full size,
baked in one job from one posing and installed as one texture with a frame per rung.
Asked for a rung at a time, the wood was ~2,000 jobs and ~1,400 textures per light, each
re-posing the body - four workers ran flat out for the first minute of every walk and
took the frame's CPU with them. Workers are capped at two (`workerCount`) for the same
reason: a worker on the frame's hyperthread slows the frame as much as one on its core.

Unbounded variety is what this replaced: one seed per tree put ~900 distinct bodies in
reach against a 320-entry cache, bakes never caught up, and the horizon filled in one
body a frame while the hero stood still.

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

## Per-pixel work belongs on the GPU

A pass that decides every pixel of the frame in JavaScript costs milliseconds of
the one thread everything else shares. The landform march is the worked example
(`landform-gpu-layer.ts`), and its shape is the one to copy:

- **The CPU decides what, the GPU decides each pixel.** The CPU still runs the
  march *schedule* (a few hundred depths) and hands it over as a float texture
  (`gpu/float-texture.ts`); the shader is a line-for-line port of the CPU code,
  which stays as the tested reference and the `?render=cpu` fallback.
- **Port the algorithm's shape, not just its arithmetic.** The CPU march is a
  column scan; re-running that scan per pixel cost 25 ms on the HD 530. Three
  passes - a probe per (column, step), block minima, then a per-pixel search -
  do the same thing exactly in ~3 ms (`gpu/landform-shader.ts` says why).
- **Never read back.** Anything the CPU needs to place the result - a slice's
  rectangle - is bounded from the inputs (`landform-gpu-rows.ts`), not measured
  off the picture.
- **Sort by depth with plain images.** A pass that must interleave with sprites
  packs its pixels into an atlas a band per depth group, and the display list
  draws each band as an ordinary image; rows only split where something
  standing sorts between them (`groupRows`). A shader per slice broke
  the sprite batch a hundred times a frame.
- **Prove parity.** Diff the GPU output against the CPU's on the same frame in
  the running page; the landform march agrees on coverage exactly and on colour
  but for ~0.6% of pixels one ramp step apart on dither seams.
- **Round where the CPU stores.** The horizon lip (`roll-ground-gpu.ts`,
  `gpu/lip-shader.ts`) rounds half-to-even at every step the CPU writes into a
  `Uint8ClampedArray`, and is handed exact alphas by index rather than as
  bytes; it matches `rollGroundPixels` on every pixel but the odd blade where
  two tufts overlap in the dithered far rows, whose CPU order depends on which
  pixels happened to be sampled first.
- **The CPU says which cells, the GPU reads them.** The lip's per-frame CPU work
  is a walk over the cells it reads (`visitLipCells`) making sure each has a
  page in the atlas and its tufts at this frame's bend - most of it no change.

Two GPU passes now: the landform march and the horizon lip. `?render=cpu`
draws both on the CPU, which is also what runs without WebGL2.

## Light never redraws anything on the CPU

The sun moving, a cloud drifting, night falling: none of these may make a layer
re-run CPU work. A standing sprite takes its cloud shadow as a tint at its foot
(`CloudShade.tint`), the ground takes it from the cloud pass, the lighting pass
multiplies the whole frame, and anything shaded per pixel samples the cloud tile
in its own shader (`CloudShade.params`). The CPU landform march re-rendered on
every pixel of cloud drift; the GPU march only re-runs a pass.

## The next anchor is prepared ahead

Every layer that reads the world through the anchor did its work on the frame
the anchor moved - all of them on the same frame, one walking frame in eleven,
at nearly twice the cost of the rest. Movement is free, so the next anchor is
known well before it arrives (`upcomingAnchor`, which hands back the same pose
object `settle` will), and a layer with per-anchor work exposes a `prefetch` (or
`prefetchTasks`) that does it into a slot keyed on that pose. `prefetcher.ts`
runs the tasks a few a frame, never on the frame that crossed; a guess that does
not come true is simply never used. A new layer with per-anchor work joins it.

**A task is never split once begun**, and the first of a frame always runs, so a
task's size is the spike: cut work by cost, not by convenience (`warmChunks` -
the lip's first point-sampled scanline composed a hundred tiles in one task, a
7 ms frame). Caches behind it are keyed by what is *drawn*, not by object
identity: puddle bodies were keyed by the sky object, which is remade every
twentieth of an hour, and every crossing after one repainted them all.

## The budget

Measured on an Intel HD 530 (this is the machine the numbers below are from). A
frame is 16.7 ms; the JS half of it should stay near 8.

| Where | Budget | How it stays there |
| --- | --- | --- |
| Scenery | ~1 ms walking | textures chosen per frame; bakes on two workers, a ladder per body per light; only uploads (≤ 2 ms) on the frame |
| Ground | ~0.5 ms; ~0.5 ms on a crossing | composed once per anchor into one surface; planned ahead (`prefetch`) |
| Grass | ~0.6 ms; ~0.9 ms on a crossing | a baked tuft atlas; frames chosen from the wind; tufts placed ahead |
| Horizon lip (GPU) | ~0.4 ms CPU | one shader pass over tables (`lip-gpu-data.ts`); the CPU walks the cells read, pages tiles and puddles into an atlas, bends the swaying tufts; the next anchor's cells filled ahead in tasks cut by cost; far looks counted once at load (tens of ms) into one small texture |
| Horizon lip (CPU, `?render=cpu`) | ~2.2 ms | one surface; the lattice read on demand, and never under a far pixel (far looks, counted once at load - tens of ms - and one hash a far pixel); tufts kept in an overlay an anchor, only the swaying rows re-stamped |
| Landforms (GPU) | ~1–2 ms CPU walking beside a mountain; nothing idle | the march in five shader passes (below); the CPU only schedules and places slices, measuring only what sorts between them |
| Landforms (CPU, `?render=cpu`) | ~0.1 ms in open land; ~5 ms median beside a mountain | a planet-fixed grid per landform, built once; the march visits only the columns each covers; far views kept between strides; one atlas upload of only the rows in use |
| Water | ~0.5 ms | the surface cleared, painted and uploaded only over the rows the puddles span |
| Next anchor, ahead | ≤ 2.5 ms a frame after the first task; tasks of ≤ ~1 ms | `Prefetcher` tasks, never on the frame that crossed |
| Each actor | ≤ 0.5 ms | small surfaces, caches keyed by quantised pose |
| Lighting | ~0.1 ms | one render target, a stamp per light |
| Drawing the frame | ~0.4 ms; ~20 draw calls | the engine's depth-sorted batch, up to 16 textures a call (`src/engine/`) |

A change that adds a per-frame cost names it in the budget, and is measured in the running
page — not guessed. `?bench=1&sync=1` is the measurement: a fixed route (stand, the three
gaits, a fight), each layer timed by the scene's own laps, frame work as p50/p95/max,
hitches and garbage per segment (`bench.ts`, `bench-runner.ts`; `window.__bench` holds the
result). Run it foregrounded and alone - a background tab is throttled. `window.__game`
and `window.__scene` are the handles in a dev build.

What the swap from Phaser bought, stormy night on the HD 530, frame work p50 measured back
to back (the machine's own load moves every number by 1–2 ms between sessions, so only a
pair taken together means anything):

| Segment | Phaser | Engine | Phaser, later | Engine, later |
| --- | --- | --- | --- | --- |
| stand | 4.6 | 4.2 | 5.8 | 5.0–5.6 |
| walking (north / strafe / diagonal) | 7.3 / 6.4 / 7.3 | 6.1–6.6 / 6.2–6.6 / 6.2–6.3 | 9.8 / 8.2 / 8.7 | 8.1–8.5 / 8.1–8.2 / 7.7–8.0 |
| fight | 7.9 | 4.4–4.6 | 6.9 | 5.6–5.9 |

Drawing is now ~0.4 ms; walking is the layers' own CPU (prefetch, water, the lip), which
the renderer cannot touch. Garbage is ~25 MB/s standing and ~60 MB/s walking, all of it
from layers building pixel clouds as objects, and it is cheap: a fight's trace shows a
minor collection every ~300 ms freeing ~27 MB in 1.3–3.6 ms - about 1% of the main thread,
and ~2 ms on one frame in twenty. Turning `PixelCloud` into typed arrays was weighed
against that and left alone: it is the art pipeline's core type, for a percent.

**The stutters left are spikes, not garbage.** Walking north, single frames reach 16–21 ms
in `prefetch`, the lip and scenery uploads (`?bench=1` names them per segment): a task
that should have been cut by cost, or an upload that landed with others. That is where
the next frame-time work is.

## The API, in one table

Export-checked by `src/game/rendering-rule.test.ts`, so it cannot rot.

| Module | Symbols |
| --- | --- |
| `palette.ts` | `INK_FAMILIES` · `familyRamp` · `rampSlice` · `familyHex` |
| `pixel-buffer.ts` | `createBuffer` · `paintInto` · `bakeCloud` · `blitBuffer` · `compositeOver` |
| `pixel-surface.ts` | `PixelSurface` · `installStrip` · `installBuffer` · `installFrames` · `packFrames` |
| `scenery-bake.ts` | `WIND_LEVELS` · `settleAt` · `bakePose` · `bakeScaled` · `bakeLadder` · `outlineCloud` · `quantizeLight` |
| `scenery-cache.ts` | `SceneryCache` |
| `scenery-baker.ts` | `createBaker` · `WorkerBaker` · `InlineBaker` |
| `scenery-features.ts` | `sceneryNear` · `PLACED_SPECIES` · `SCENERY_VARIANTS` · `sceneryArchetypes` |
| `gpu/float-texture.ts` | `FloatTexture` · `hasWebGL2` |
| `landform-gpu-data.ts` | `packField` · `viewUniforms` · `scheduleTexels` · `columnBounds` |
| `landform-gpu-rows.ts` | `rowRects` · `groupRows` · `stackBands` · `radialProfile` |
| `landform-gpu-layer.ts` | `LandformGpuLayer` |
| `lip-gpu-data.ts` | `lipLines` · `visitLipCells` · `warmChunks` · `PageAtlas` · `CellTable` · `TuftTable` · `tuftAtlas` · `farLookTexels` |
| `roll-ground-gpu.ts` | `LipGpu` |
| `prefetcher.ts` | `Prefetcher` |
| `player.ts` | `upcomingAnchor` · `nextAnchor` |
| `atmosphere.ts` | `atmosphereAt` · `clockHours` · `parseTime` |
| `lights.ts` | `flicker` · `lightFalloff` · `lightPool` |
| `lighting-layer.ts` | `LightingLayer` · `LIGHTING_DEPTH` |
| `frame-context.ts` | `beginFrame` |
| `impulse.ts` | `kickShake` · `kickHitStop` · `stepImpulse` · `shakeOffset` |
| `fx/particles.ts` | `createPool` · `emit` · `stepParticles` · `particleCloud` |
| `combat.ts` | `strikeHits` · `strikePush` |
