# Roguelike

2D, pixel art, turn based roguelike rpg

## Tech Stack

| Layer | Choice |
| --- | --- |
| Game | Phaser 4.2 on a 320×180 WebGL canvas |
| Language | TypeScript 7; Python 3.12 for repository tooling |
| Dev server | Vite 8 |
| Tests | Vitest and pytest |
| Checks | TypeScript compiler and ruff |

## Visual and Asset Architecture

These are product constraints, not suggestions tied to the proof of concept.

### The bet: the procedural graphics *are* the art style

This game is vibe coded, and the art direction is chosen to suit what is actually
building it. A coding agent is excellent at writing a rule that produces a picture and
every picture next to it, and mediocre at drawing twelve frames that agree with each
other. Art out of an image model is worse than mediocre here: frame 3 of a generated
run cycle does not match frame 2, and neither matches a particle system whose colours,
pixel size and dither pattern are decided in code.

The resolution is not to make generated art match the procedural graphics. **The
procedural graphics are the art style, and sprites are anchors for them.** A small
rigged figure inside a world that moves mathematically — grass bending, embers pooling,
a sword trail persisting, a corpse dissolving into its own pixels — reads better than a
beautifully drawn figure standing still, and it is the half that can be extended
without a human redrawing anything.

Four things already built are the load-bearing ones. Build *on* them, not around them:

- **Characters are skeletons, not drawings.** `rig.ts` poses bones in 3D; `models.ts`
  dresses them. Limbs animate independently, and facing left or away is a flag.
- **Gear is modular and animates for free.** A sword is a `bone` part that extends the
  arm, so it tracks every clip that already exists; a hat is a `stamp`; armour is a
  `reink`. Putting a new weapon in the hero's hand is one entry, never a redraw.
- **An attack is a handful of 3D keyframes**, not a filmstrip — `SWING` is three.
- **Status effects are transforms over pixel clouds**, so one `meltCloud` melts the
  hero, a slime and a signpost alike.

**Never generate a character spritesheet from an image model.** Generated images are
welcome as reference for mood, silhouette and composition; nothing enters the game as
pixels a model painted.

Ranked by how well each mechanism suits the thing building it. Spend effort at the top:

| Tier | Techniques |
| --- | --- |
| **Build the game out of these** | pooled particle emitters · trails and ribbons · screen shake, hit stop, impulse · palette cycling · value/simplex noise · flow fields · cellular automata · Voronoi cracks · SDF shapes for spells and telegraphs · recursive lightning and branching · squash/stretch and easing curves · procedural shadows · ordered dithering · dissolves · decals |
| **Reach for these deliberately** | dynamic lighting · metaballs · reaction–diffusion · procedural water · cloth, chains, ropes · IK on the existing rig |
| **Only where nothing else will do** | frame-by-frame animation — props and tiles only, never a character |
| **Never** | image-model spritesheets · hand-painted perspective animation |

The mechanics of picking from that list are `.claude/rules/art-pipeline.md` (drawing and
animating) and `.claude/rules/procedural-effects.md` (simulating).

| Area | Contract |
| --- | --- |
| Render target | Render the world at 320×180, then nearest-neighbor upscale the whole canvas by an integer factor and letterbox the remainder. |
| Setting | **Outdoors.** The game is an overworld — fields, paths, rock, sky — not a dungeon interior. |
| Color | **A closed palette of named inks on pitch black.** The background is `#000000`, never "very dark"; everything drawn is high-contrast lit pixels in a named ink from the closed set in `src/game/ink.ts`. No asset invents a hex value — new colours are new inks, added deliberately. `void` ink is deliberate black, for punching holes (eyes, hollows) into a lit silhouette. An ink may be **translucent** — `INK_ALPHA` carries its opacity and `inkHex` spells it, so `water` is sheer wherever it is drawn and no call site invents an alpha for a colour. A scene dimming a whole layer is lighting, and multiplies the ink's own alpha rather than replacing it. |
| Light and shade | The palette is closed but **not one bit deep**. Shadow, highlight and gradient are *computed, never painted*: an ordered **ink ramp**, a light direction, and a 4×4 Bayer dither locked to the logical pixel grid (`src/game/shading.ts`). Shading is a pass over a pixel cloud, so it applies to every model that exists or ever will, and a ramp arranges the palette rather than extending it. Hold identity inks — a cyan blade, a magenta hat, `void` eyes — out of the light pass, so the silhouette still reads at 1×. |
| Camera | A **pitched-back overhead** view, not a 45°-yaw diamond isometric: rows and columns stay axis-aligned and only the vertical axis is foreshortened. A 16×16 world square lands on 16×12 of screen, and height rises straight up the screen by `WALL_RISE`, which is what makes walls stand. `src/game/projection.ts` owns that math; nothing else re-derives it. |
| Grid | 16×16 world tiles. Author ground art **already foreshortened** — 16×`TILE_DEPTH` for anything lying on the ground, 16×`WALL_RISE` for anything standing up — so every tile blits 1:1 and nothing is scaled at draw time. Snap rendered objects and the camera to logical integer pixels. Do not use antialiasing, arbitrary sprite rotation, or continuously fractional sprite transforms. |
| Flatness | Below the horizon band the ground is **affine, not perspective**: every world row is exactly `TILE_DEPTH` scanlines tall, with no convergence and no per-row scaling. A tile's screen size never depends on how far up the screen it is. |
| Horizon | The top of the screen **rolls over the horizon** — sky, then a short band where the ground curves away and a dozen world rows compress into a few scanlines, then the flat field. `src/game/horizon.ts` owns it, and one knob sets the split. |
| Identity art | **Characters are skeleton rigs**, not frame-by-frame sprites: bones posed in rig-space 3D (`src/game/rig.ts`), dressed by the authored models in `src/game/models.ts`, rasterized to pixels at draw time. Props, tiles, and effect sources stay authored palette-indexed raster sprites. All sources are text-defined and diffable; generated PNG atlases are build output. SVG is not a primary game-art format. |
| Procedural art | Use math for motion, light, particles, world simulation and effects. Character silhouettes are procedural too — posed rigs rather than drawn frames — but they stay **authored**: proportions, gear and clips are designed by hand, and a mechanism renders them. Status effects (melt, freeze, burn, reflect) are **generic transforms over pixel clouds** (`src/game/transforms.ts`), never per-model frames. Image-generated art may guide mood and composition; it never becomes production pixels. |
| Animation | Character actions are **clips**: sparse 3D keyframes over rig bones (`src/game/models.ts`), sampled per channel — a new attack is a handful of direction lines, not a redraw. Facing is front/back only (depth negated, front-only stamps dropped); left/right is a mirror flip. Combine silhouette-changing poses with discrete, grid-quantized translation and squash/stretch. Express actions as anticipation, fast contact, hit stop, overshoot, and settle; drive visual beats from gameplay events. Prefer **more terms over more keyframes**: what is on screen is `base pose + clip + secondary motion + reaction`, each a function of time, summed. Breathing, bob, recoil, stagger and wind are terms, not frames. |
| Effects | Build particles from 1–4 logical-pixel primitives or tiny raster sprites. Pool them, cap their count, and use seeded randomness when reproducibility matters. Motion comes from a field — noise, a flow field, gravity, a curve — never from a drawn path. |
| World simulation | **The direction, not yet built.** Elemental state belongs to the world rather than to an animation: an **effect field** under the tiles, holding fire, water, ice, electricity, poison and corruption as cell state that spreads and combines — fire + grass spreads, electricity + water arcs, fire + ice steams. Build a new element as a rule over that field once it exists, so interactions fall out of the system instead of being drawn one pairing at a time. |
| Separation | Keep turn simulation deterministic and independent of the real-time presentation layer. Rendering may exaggerate an event but must not determine its outcome. |

### The camera, and the band at the top of it

Four modules, and no fifth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/projection.ts` | `TILE_WIDTH` 16, `TILE_DEPTH` 12, `WALL_RISE` 16, and `project()` / `cellOrigin()` / `wallCapY()` / `wallFaceY()` / `depthOf()`. Draw order is `row * TILE_WIDTH + rank` — painter's algorithm down the screen. |
| `src/game/horizon.ts` | `horizonLayout(height, skyFraction)` → `skyHeight`, `rollHeight`, `horizonY`, `groundTop`, `groundHeight`. Also the sky ramp, the roll's easing, and `ridgeProfile()` for distant silhouettes. |
| `src/game/tiles.ts` | The terrain art, in one shared palette with per-material tokens, so a whole field can be spliced into a single texture by `composeTiles`. |
| `src/game/field.ts` | The sample scene's map, as text. `demo-scene.ts` reads all four and only draws. |

### The ink pipeline

Everything renderable flattens to a **pixel cloud** — an ordered list of lit pixels,
later wins — which is what lets one melt, or one light pass, apply to any model. Eight
modules, and no ninth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/ink.ts` | The closed `InkId` palette (`INK_COLORS`, `INK_TOKENS`), `PixelCloud`, text masks, `strokeLine`, and `cloudToSprite` — the bridge back to the text-sprite pipeline. |
| `src/game/shading.ts` | `INK_RAMPS` (ordered inks, darkest first), `rampInk`, `cycleRamp` for palette cycling, the `BAYER_4X4` ordered dither, and `shadeCloud` — the light pass. The one place a gradient is allowed to come from. |
| `src/game/rig.ts` | Skeletons, poses, clip sampling, `renderModel`. Rig space is x right, y toward the viewer, z up; a rig point projects `(x, y·DEPTH_RATIO − z)` — exactly the world's projection, re-used, never re-derived. |
| `src/game/models.ts` | The authored humanoid: skeleton, base pose, gear (`SWORD` is a real bone clips can key; `HAT` a stamp; `ARMOR` a reink) and the clips (`IDLE`, `WALK`, `SWING`, `CAST`). The file an agent edits for a new move or item. |
| `src/game/transforms.ts` | `meltCloud` / `freezeCloud` / `burnCloud` / `reflectCloud` — pure, seeded functions of (cloud, progress); identity at 0, deterministic always. |
| `src/game/weather.ts` | Rain (the pooled spark emitter pointed downward, with a steady wind on it — `RAIN_SLANT` is the one number the sky and the drawn streak both read) and lightning (seeded bolt polyline plus a pure-function-of-time storm schedule). |
| `src/game/puddles.ts` | Standing water: a seeded, foreshortened outline generated from a centre and a radius, plus everything on its surface — rim, glints, reflection, and the rings the rain punches into it. Placement is data in `field.ts`; the scene only draws. |
| `src/game/rig-frames.ts` | Sampling clips and transforms into fixed frame lists so the asset registry and the lab cannot tell rig art from hand-drawn art. |

**How to actually draw and animate with it is `.claude/rules/art-pipeline.md`** — the
cost ladder from palette swap to hand-drawn frames, the "I want X → open this one file"
table, the API crib, and the recipes. The rule exists because the cheap mechanism and
the expensive one produce the same picture, and only one of them also produces the next
hundred: a status effect is a cloud transform, a light is a ramp and a direction, a
spell is a seeded emitter, an attack is three keyframes. **Hand-authored frames are the
last rung, for props and tiles only, never for a character.**

**How to simulate rather than draw is `.claude/rules/procedural-effects.md`** — the
effect vocabulary (emitters, fields, noise, automata, SDFs, decals, impulse), what each
one is for, and the determinism rules that keep a capture reproducible.

**The 95/5 split is a knob, not a constant to inline.** `DEFAULT_SKY_FRACTION` in
`horizon.ts` is the default; `?horizon=8%` (or `?horizon=0.08`) overrides it per load.
There is no on-screen caption printing the resulting pixel counts — **the page is the game
world and nothing else**, so judge a split against the frame itself and read the numbers
from `horizonLayout()` in the console or from `horizon.test.ts`. Read
`horizonLayout()` for `groundTop` — never hard-code a y for the horizon, and never
assume the flat field starts at 9px, because that number moves the moment the knob does.

Two rules fall out of the projection and are easy to break by accident:

- **Never scale a sprite to fake foreshortening.** A 16×16 source drawn at 0.75 resamples
  every row, which is precisely the smearing the pixel contract exists to prevent. If a
  thing lies on the ground, author it 16×12.
- **A ground tile and a standing face are different art.** A face is not foreshortened at
  all, it stacks vertically, and so it may carry nothing that reads as "the bottom" — a
  contact shadow inside it becomes a stripe every sixteen pixels. Draw the shadow once, at
  the wall's foot. Equally, a cap is a *surface*: give it no vertical lines, or an outcrop
  reads as brickwork lying flat.

### Visual verification

Every asset or animation change is inspected in the running browser at logical 1× and
an enlarged integer scale. Maintain an asset-lab scene that can show every frame,
animation, palette swap, and effect on light and dark backgrounds. The agent captures
and compares rendered output; a valid source file and green unit tests do not prove the
art looks correct. **The ritual is the `/art-check` skill** — registry entry, dev server,
pinned capture at 1× and enlarged, and the checklist of what to actually look at.

#### The asset lab

`lab.html` (`npm run dev`, then `/lab.html`) is that scene. It renders on its own
320×180 canvas under the same integer-scale contract as the game, and shows the selected
art on two grounds at once — dark beside light — because a sprite that reads on charcoal
and disappears on bone is a fault you only see with both on screen at the same moment.

Everything it shows is in the URL, so a capture can be reopened exactly:

| Key | Meaning |
| --- | --- |
| `asset` | registry id — read `ASSET_REGISTRY`, or call `window.assetLab.assets()`; the sidebar lists them all |
| `variant` | palette swap id; `authored` is the art as drawn |
| `frame` / `t` | frame index, and elapsed ms for effects |
| `play` | `1` animates, `0` pins the view — captures use `0` |
| `zoom` | requested whole factor, capped by what fits the pane |
| `bg` | `duo` (dark/light), `checker` (alpha), `contrast` (pure black/white) |
| `grid` / `bounds` / `tile` | frame grid, drawn-pixel bounds, 3×3 tiled seam preview |

`window.assetLab` is the capture handle for a browser-driving agent:
`state()`, `apply(patch)`, `seek(ms)`, `assets()`, `snapshot()` — the last returning a
PNG data URL. `apply` and `seek` return the state they settled on rather than the one
requested, so a normalized value (a zoom that did not fit, a tile flag on a non-tile)
is visible instead of silently assumed. With `play=0` the same `seek(ms)` produces
byte-identical pixels on every run: effects step from a seed in fixed 16 ms slices.

**To add an asset, add an entry to `ASSET_REGISTRY` (`src/game/asset-registry.ts`).**
The lab, its texture installation, and its filmstrip are all driven from that array —
there is no scene to edit. `validateRegistry` is asserted in
`asset-registry.test.ts`, so a palette-swap token that no longer exists in the sprite
fails a test rather than silently rendering the authored colour.

### Branch previews

Do not switch branches inside a checkout whose Vite server is running. Give each agent
branch its own Git worktree and dev-server port, and compare branches by switching
browser tabs. Vite hot replacement is for edits within one worktree, not for mixing two
branches in one running module graph.

## Environment Variables

See `.env.example` for every variable. `.env` is gitignored and holds this
checkout's ports and credentials.

## Tooling

> Everything in this section needs the local Docker Desktop daemon. If it isn't
> running, make the code change and defer container/stack verification until it is
> (or to CI). Run `docker ps` first — an `npipe`/daemon error means Desktop is stopped.

### Scripts and the vendored harness

Both are covered by **`.claude/rules/engineering.md`** — script conventions (pure
importable functions, stdlib-only hooks, tests in the same change), the failure-artifact
rule, and how the `.devkit.toml` seam works. That file is vendored from
[devkit](https://github.com/alexandrec90/devkit) and drift-gated, so it is the
authority; this file does not repeat it.

### VS Code tasks

- Use `"type": "process"` so VS Code monitors the process directly — that is what
  makes the spinner stop and the exit-code icon appear reliably.
- Set `"close": false` in `presentation` so the terminal stays open for review.
- **Wrap with `notify-wrap.py`** for the completion toast; never call `notify.py`
  from inside a script. Notifications are a task-layer concern only.
- Label convention: `"Domain: Title Case Action"`, and **every task carries a
  `detail`** — that is the second line in the quick-pick, and the only place a
  one-click action can state its cost or blast radius.

### Failure artifacts (fix from a file, not from the terminal)

Any task or script whose failures an agent is expected to act on must persist the
failure to a **parseable artifact file** under `logs/`. Never rely on streamed
terminal output — it scrolls away and buries the signal. Keep the terminal to a
status line plus the artifact path; put everything needed to diagnose in the file.
Write the artifact on failure too, not just success, and overwrite per run.

### Docker subprocess calls

- **`docker compose exec` must use `-T`** — without it a pseudo-TTY is allocated and
  the subprocess handle can outlive the command, leaving the caller hung.

## Testing

**`.claude/rules/engineering.md`** is the authority: tests ship in the same commit,
every testable unit of logic is covered, regression test first, targeted runs locally
and full runs in CI.

Add this project's specifics *below* — fixtures, isolation rules, markers, what to mock
and where — but do not restate the policy above. It is vendored and drift-gated; a copy
here is a fork that will disagree with it the first time either is edited.

**The gate here is `npm run check`** — `vitest run` then `tsc --noEmit && vite build`.
There is **no `lint` script**, so the vendored rule's "targeted tests plus the linter"
has no second half in this project: `npm run lint` fails with *"Missing script"*, which
reads as a broken toolchain rather than as an instruction that does not apply. The
scripts are `dev`, `build`, `typecheck`, `test`, `check`, and `check` is the one to run
before shipping. Formatting is not gated at all; type errors are, through `build`.

**`npm run check` is not the whole CI gate.** The Tests job also runs
`scripts/hooks/structure_check.py` through pytest, which caps file length, class length
and method count — a limit no npm script enforces, so a branch can be green locally and
fail the gate on nothing but size. Run it before pushing:

```bash
python scripts/hooks/structure_check.py     # stdlib only; no venv needed
```

Its verdict is *"fix the code, do not add to the baseline"*, and that is meant literally:
a file over the limit is two jobs in one file, and the split is the fix. `demo-scene.ts`
was 622 lines because it had quietly become the overworld *and* the pond in it; the seams
it named are now `water-layer.ts`, `draw-cloud.ts` and `ripples.ts`.

**Green tests are not the gate for anything you can see.** This is the lesson the water
cost: `rainImpact`'s rings were spawning at the right rate, every unit test passed, and
the scene had no visible ripples in it for a whole session, because the rings were
opening on the far rim and being clipped away. Any change to art, motion, or effects is
inspected in the running browser as well — `npm run dev`, then the scene at an integer
zoom and `/lab.html` for the frames. A test can only assert the property you thought to
name; the screen asserts the rest.

The same gap has a second, sharper form: **`Phaser` is an ambient type namespace, so a
module can annotate `Phaser.GameObjects.Graphics` all day without importing it — and then
die on the first frame at `Phaser.BlendModes.ADD`, which is a *value*.** `tsc --noEmit`
and all 306 tests passed on exactly that; the browser said `Phaser is not defined` and the
canvas was black. Any new module that touches Phaser at runtime needs
`import Phaser from "phaser"`, and the only thing that catches a missing one is loading
the page.

## Guardrails

Baseline guardrails — including the instruction-file feedback loop (**never silently
work around a bad instruction**) — are in `.claude/rules/engineering.md`. Rules for
writing skills and rules themselves are in `.claude/rules/authoring.md`. Cross-reference
this project's own scoped rules here, one line each.

- **`.claude/rules/art-pipeline.md`** (`src/game/**/*.ts`) — how to draw and animate:
  pick the cheapest mechanism that makes the picture, and never hand-draw a frame you
  could derive.
- **`.claude/rules/procedural-effects.md`** (`src/game/**/*.ts`) — how to simulate
  rather than draw: emitters, fields, noise, automata, SDF spell geometry, decals and
  impulse, and the seeding rules that keep every one of them reproducible.
- **`/art-check`** (`.claude/skills/art-check/`) — the browser capture ritual that turns
  "the tests are green" into "the picture is right". Every art change ends there.
