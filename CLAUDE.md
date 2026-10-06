# Roguelike

2D, pixel art, real-time **twin-stick shooter** on an outdoor overworld.

Move with one hand and aim with the other: movement is eight-way, and where the hero
*points* is meant to be a separate input from where he *goes*. It is not a roguelike
and not turn based — earlier versions of this file said both, and neither is true any
more. **Nothing takes turns.** Time runs on the clock for everyone, and an input that
arrives while the hero is mid-action is queued and spent on the frame he is free,
never a turn that was skipped.

Three parts of that, so an agent can tell what exists from what is intended:

| Part | State |
| --- | --- |
| **Movement** | **Built, and free.** Eight-way, from any two of the four bound directions held at once (`controls.ts` reads one winner per axis and sums them). A held direction walks at `WALK_TILES_PER_MS` for exactly as long as it is held: release and he stops that frame, mid-tile if need be; press the other way and he turns round that frame. A diagonal walks each axis at 1/√2, so eight-way movement has one speed. On a round planet a diagonal is the two gaits walked together — forward *and* strafe — rather than a fifth direction, so it turns the world exactly as a sideways step does. (It used to commit a whole tile per press, 180 ms or 255 on a diagonal before a new direction or a release was heard — the lag a player felt.) |
| **Acting while moving** | **Built.** Locomotion and the swing are **two timers over one skeleton**, aged independently in `player.ts` — an attack never costs a step and a step never delays an attack. Every action added later belongs on its own track for the same reason; the moment two of them share an enum, one of them starts waiting. |
| **Aim** | **Built, for the mouse.** The cursor, measured from the hero's chest and un-foreshortened onto the ground, is a **free angle**, not one of eight (`controls.ts` `aimAt`). Facing (`Facing`, a yaw in radians) reads *it* rather than the heading — so he can walk north while facing south — and a blow or a spell leaves along that same angle. Until the pointer first moves, facing follows movement, snapped to the heading's eighth by `facingYaw`, so a keyboard-only player still faces where he walks. Any facing is the one rig **turned** about its vertical axis, not a drawing or a mirror, so the sword stays in the same hand from every side and a sixteenth costs exactly what an eighth does. The *drawn* yaw chases facing over a few frames (`hero/turn.ts`) so an about-face sweeps instead of cutting; facing itself, and everything aimed by it, is still immediate. A right stick is still to come, as a second axis pair in `keybindings.ts`. Nothing outside `player.ts` should assume aim and heading agree. |

**Responsiveness is a contract, not a polish pass.** Three rules hold the feel, and each
is one an ordinary refactor breaks by accident:

- **Turning is immediate.** Facing is re-read from the intent *every frame*, never at the
  end of an action, because the turn is what a player reads as the game hearing them.
- **No input is dropped for being early.** A press that lands mid-action is queued and
  spent on the frame the track is free (`controls.ts`), and the overshoot past an action's
  end carries into the next, so a held key gives an even rhythm rather than a stutter.
- **Two things that could happen at once, do.** The legs answer a direction on the frame
  it arrives, and nothing else waits on them. Do not bring back a committed step: the
  renderer still sees whole tiles (`groundPose`, the anchor) plus a remainder
  (`scrollPhase`), but the remainder is driven by velocity, not by a timeline that has to
  run out before input is heard.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Game | Our own WebGL2 renderer (`src/engine/`) on a 320×180 canvas — no framework |
| Language | TypeScript 7; Python 3.12 for repository tooling |
| Dev server | Vite 8 |
| Tests | Vitest and pytest |
| Checks | TypeScript compiler and ruff |

**Why no game framework.** Phaser was the renderer until the per-pixel work moved to
the GPU and every surface upload, pass and input had become the game's own code
reaching round it. What the game still needed from a framework — a depth-sorted sprite
batch, render targets, shader passes, a loop — is `src/engine/`, small enough to read in
one sitting (`src/engine/index.ts` maps it). It keeps Phaser's draw rules where they decide a
pixel (origin, crop, rounding, blend factors), so a frame drawn by it matches one Phaser
drew. Reach for a library only for something the engine cannot reasonably grow.

## Skins

**How the game looks is a skin, chosen by `?skin=` and cycled with F2** (`SKIN_KEYS`;
the page reloads under the next skin with every other knob kept). `src/skins/skin.ts`
lists them; `src/main.ts` lazily imports only the one shown.

| Skin | Module | Look |
| --- | --- | --- |
| `lowpoly` (default) | `src/skins/lowpoly/` (`.claude/rules/skin-lowpoly.md`) | flat-shaded 3D geometry at window resolution; WebGPU with a compute wave simulation, WebGL2 as the fallback (`?gpu=`) |
| `pixel` | `src/skins/pixel.ts` → `src/game/` layers on `src/engine/` | the 320×180 pixel art below; load it with `?skin=pixel` |

**A skin decides how things look, never what happens.** The planet, terrain, landforms,
lakes, scenery placement, the hero (`hero/hero-driver.ts`) and, for skins other than
pixel, the fight (`encounter-sim.ts`) are renderer-free simulation that every skin reads.
Two things are identity rather than art and **bind every skin**: the pitched-back local
view (rows and columns axis-aligned, depth foreshortened by `DEPTH_RATIO`, the hero
pinned while the planet turns) and the treadmill-lip horizon from `horizon.ts`'s one
curve. The planned **caves** — walking in and having the horizon band show the cave's
depths instead of sky — belong to that identity too: build them as simulation plus a
change to what the lip shows, so every skin gets them. Nothing below this section about
pixels, inks, dither or the 320×180 target binds a skin other than `pixel`.

**Standing water is shared world state:** `src/game/water/puddle-field.ts` bakes seeded
basins over the planet, and water stands where a basin is deeper than a level the rain
lowers (`stepWetness`) - ~8% of open ground on a dry day, ~27% soaked. The low-poly skin
draws it with mirror reflections and rain and footstep rings; the pixel skin still draws
only its own small puddles (`puddlesNear`) and has not adopted the field yet.

Not yet in the low-poly skin: lightning, the campfire, wildfire and decals (their
simulation still lives inside pixel layers), and the `?bench=1` route.

## Visual and Asset Architecture

These are product constraints **of the pixel skin**, not suggestions tied to the proof
of concept.

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
  dresses them. Limbs animate independently, and facing any of eight ways is a turn of
  the skeleton (`yaw`), never another drawing.
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
| Render target | Render the world at 320×180, then nearest-neighbor upscale the whole canvas by the smallest integer factor that covers the full window. Centre-crop horizontal overflow, keep the horizon pinned to the top, and clip vertical overflow from the near foreground; never expose a border or distort the aspect ratio. **The window therefore decides how much world you can see** — a short window clips the near rows — but it can no longer decide how much world *exists*: the planet is unbounded and the hero is pinned to one pixel inside the walkable band (`src/game/viewport.ts`), so a dragged window edge re-frames him rather than stranding him. **One trial exception, behind `?sky=hd`:** the air above the horizon (gradient, stars, sun, clouds) is drawn at the screen's own resolution *behind* the 320×180 world (`sky-hd-layer.ts`, an engine `Backdrop`), because a sun or a cloud upscaled sixfold is blocks, not art. Everything that stands in the band stays world pixels. |
| Setting | **Outdoors.** The game is an overworld — fields, paths, mountains, mesas and towers, sky — not a dungeon interior. |
| Color | **Full colour, still a closed set of named inks.** The one-bit neon-on-black rule is retired. `src/game/palette.ts` defines material families (`grass`, `leaf`, `bark`, `stone`, `fire`, `skin`, `metal`, …), each a hue-shifted ramp darkest first, named `family-index` (`grass-3`). No asset invents a hex value — a new colour is a new step in a family. The legacy inks (`bone`, `cyan`, `void`) still resolve. Opacity belongs to the ink (`INK_ALPHA`): `shadow`, `smoke` and `slime` are sheer everywhere they are drawn. The sky is the one computed gradient. |
| Light and shade | Shadow, highlight and gradient are *computed, never painted*: a ramp, a light direction, and a 4×4 Bayer dither locked to the pixel grid (`src/game/shading.ts`); volumes are lit per pixel from their SDF normal. The light direction, the time of day and the night are one pure function (`atmosphere.ts`), and one multiply pass over the frame (`lighting-layer.ts`) applies the ambient and every `LightSource` — so a layer draws daylight colours and never darkens itself. Cloud shadows fall on the ground in a pass of their own, and every standing thing reads the same pattern at its foot (`FrameContext.shade`) and is tinted by it, so a tower that rises above the horizon line is not cut by a band where the sky rows were exempt. **How a frame reaches the screen, and its budget, is `.claude/rules/rendering.md`.** |
| Camera | A **pitched-back overhead** view, not a 45°-yaw diamond isometric: rows and columns stay axis-aligned and only the vertical axis is foreshortened. A 16×16 world square lands on 16×12 of screen, and height rises straight up the screen by `WALL_RISE`, which is what makes walls stand. `src/game/projection.ts` owns that math; nothing else re-derives it. The camera is **bolted to the hero and turns with him** — he never moves on screen, the planet moves under him (`src/game/camera.ts`). |
| Grid | 16×16 tiles, and **the grid belongs to the screen, not to the world**: the planet has no lattice, so a turning camera never puts a tile on a diagonal. Author ground art **already foreshortened** — 16×`TILE_DEPTH` for anything lying on the ground, 16×`WALL_RISE` for anything standing up — so every tile blits 1:1 and nothing is scaled at draw time. Snap rendered objects and the camera to logical integer pixels. Do not use antialiasing, arbitrary sprite rotation, or continuously fractional sprite transforms. |
| Flatness | Below the horizon band the ground is **affine, not perspective**: every world row is exactly `TILE_DEPTH` scanlines tall, with no convergence and no per-row scaling. A tile's screen size never depends on how far up the screen it is. |
| Horizon | The top of the screen **rolls over the horizon** — sky, then a band where the ground bends over the horizon like **the lip of a treadmill**, then the flat field. The lip meets the field without a crease: its first row is as tall as a flat one (`TILE_DEPTH` scanlines), and from there each row is squashed further than the last until `ROLL_ROWS` rows have folded under the horizon line (`rollLift`). The ground on it is the field carried on, not a painted stripe: `roll-ground.ts` samples the field's own ground tiles, grass tufts and puddles (`roll-water.ts`) at each lip pixel (the reference; the game draws the same picture in a shader, `roll-ground-gpu.ts`), exactly 1:1 at the seam, compressing and converging further up, and takes on the hour's haze as it goes - a tint, never a replacement, so the far field is still green at the horizon line (pre-divided by the ambient, like the sky, so it meets the sky in the sky's colour). `src/game/horizon.ts` owns the curve, and one knob sets the split. **The horizon is real, and the band is a place rather than a backdrop.** Anything that stands is drawn over it, so a tree on the far row keeps its crown against the sky, and what is on the horizon line is a feature of the planet: a body past the field's far edge lands on the roll a little higher and a little smaller for every row it is further away (`rollPlacement`), and walking toward it makes it grow and come down onto the flat field. Past the horizon line nothing vanishes either: a body further than `ROLL_ROWS` keeps shrinking and **sinks foot first behind the line** (`horizonSink`), clipped there, so a mountain's peak is the first thing seen and the last thing lost, and nothing is swept in or out of existence while any of it shows (`rowsToSink`). Nothing that a player could walk to is painted at a bearing. |
| Identity art | **Characters are skeleton rigs**, not frame-by-frame sprites: bones posed in rig-space 3D (`src/game/rig.ts`), dressed by the authored models in `src/game/models.ts`, rasterized to pixels at draw time. Props, tiles, and effect sources stay authored palette-indexed raster sprites. All sources are text-defined and diffable; generated PNG atlases are build output. SVG is not a primary game-art format. |
| Procedural art | Use math for motion, light, particles, world simulation and effects. Character silhouettes are procedural too — posed rigs rather than drawn frames — but they stay **authored**: proportions, gear and clips are designed by hand, and a mechanism renders them. Status effects (melt, freeze, burn, reflect) are **generic transforms over pixel clouds** (`src/game/transforms.ts`), never per-model frames. Image-generated art may guide mood and composition; it never becomes production pixels. |
| Animation | Character actions are **clips**: sparse 3D keyframes over rig bones (`src/game/models.ts`), sampled per channel — a new attack is a handful of direction lines, not a redraw. Facing is a rotation of the rig about its vertical axis (`RenderOptions.yaw`): eight headings are eight turns of one skeleton, a `front` stamp shows only while its `offset` faces the viewer, and a turn never swaps hands the way a mirror would. `flipX` remains, as a mirror for art that wants one. Combine silhouette-changing poses with discrete, grid-quantized translation and squash/stretch. Express actions as anticipation, fast contact, hit stop, overshoot, and settle; drive visual beats from gameplay events. Prefer **more terms over more keyframes**: what is on screen is `base pose + clip + secondary motion + reaction`, each a function of time, summed. Breathing, bob, recoil, stagger and wind are terms, not frames. |
| Effects | Build particles from 1–4 logical-pixel primitives or tiny raster sprites. Pool them, cap their count, and use seeded randomness when reproducibility matters. Motion comes from a field — noise, a flow field, gravity, a curve — never from a drawn path. |
| World | **A round planet, and no map edge.** Walk straight for `PLANET_TILES` and you return to where you began; walk sideways and you slide round a circle of radius `radius` whose centre sits behind you, so one lap of `2·π·radius` tiles brings you back having swung the horizon through a full 360° (`src/game/planet.ts`). Terrain is a seeded, wrapping, **continuous field** over planet coordinates (`src/game/terrain.ts`) rather than an authored map — which is what lets the local grid stay axis-aligned while the world turns through it. The ground itself is flat — grass, dirt, water — and **everything tall is a landform** (`src/game/landforms.ts`): a mountain, a mesa, a spire or a tower, each a height function over planet coordinates rather than a stack of grid blocks, so it has the same shape from every side and every strafe. They are drawn as flat illustration by one march over depth (`landform-render.ts`), sorted row by row with the trees and the hero, and they block walking where they stand taller than `BLOCK_HEIGHT`. **Lakes and ponds** are the one other thing that stops a walker (`src/game/lakes.ts`): a seeded lattice of planet discs drawn as a puddle at lake size, whose deep core blocks and whose shallows are waded - a ring and spray each footfall, the hero sunk to the shins. The core is a disc on the ground because the outline belongs to the turning screen and only a disc is the same from every heading. |
| World simulation | **The direction, not yet built.** Elemental state belongs to the world rather than to an animation: an **effect field** under the tiles, holding fire, water, ice, electricity, poison and corruption as cell state that spreads and combines — fire + grass spreads, electricity + water arcs, fire + ice steams. Build a new element as a rule over that field once it exists, so interactions fall out of the system instead of being drawn one pairing at a time. |
| Separation | Keep the movement and combat simulation deterministic and independent of the presentation layer. Rendering may exaggerate an event but must not determine its outcome. |

### Which module owns what

The module maps — the camera and the horizon band (seven modules), the ink pipeline
(eight), scenery (trees and props), the `?map=1` instrument and the knobs — are
**`.claude/rules/game-architecture.md`**, scoped to `src/game/**/*.ts`. Add a new owner
there, not here: this file is held under 500 lines, and the maps are what grew it.

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

**Rendering on demand is also why it is the fallback for an input change.** A
live-loop check needs the tab **foregrounded** — backgrounded, Chrome freezes rAF and
the game's loop stops, so the capture shows a game that is not running. `/art-check`
step 3 has the tell and the remedy.

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
there is no scene to edit. The types that array is built from are `src/game/asset-types.ts`
and the structural rules over it are `src/game/registry-validation.ts`, which imports the
types rather than the catalogue and so needs none of the art imports. `validateRegistry`
is asserted in `asset-registry.test.ts`, so a palette-swap token that no longer exists in
the sprite fails a test rather than silently rendering the authored colour.

#### The tree lab

`trees.html` is the second lab, and it exists because the asset lab answers "is this
frame right" while scenery needs "is this *mechanism* right". It shows every species side
by side under one wind and one light, so the question it is built for — does a recursive
oak sit convincingly next to an SDF chestnut — is asked with both on screen at the same
moment, and a change to the shared wind moves all of them at once.

It also runs the GPU parity check. Every volumetric species is renderable two ways, and
the lab renders both and diffs them: `src/game/gpu/volume-gl.ts` reads the shader back
into pixels, the CPU path in `src/game/procgen/volume.ts` evaluates the same field, and
the two must agree exactly. That is the only thing stopping the shader and the CPU
drifting apart, because they are two implementations of one description.

### Branch previews

Do not switch branches inside a checkout whose Vite server is running. Give each agent
branch its own Git worktree and dev-server port, and compare branches by switching
browser tabs. Vite hot replacement is for edits within one worktree, not for mixing two
branches in one running module graph.

**A worktree needs no `.env` to get its own port.** `src/worktreePort.ts` derives an
offset from the checkout's directory name — static checkout 4100/5100, a worktree
4100+n/5100+n — because two of the three ways a worktree is cut here run no project code
at the time. That module carries the reasoning; an explicit `VITE_PORT` still wins.

`strictPort: true` then makes a collision a startup error rather than a silent slide. It
used to slide, and opening `localhost:4100` out of habit showed you *the other branch's
game* — close enough to be believed, with every conclusion drawn from code you did not
write. The offset is a hash, so collisions remain possible: pin one side with
`VITE_PORT=4107 npm run dev`.

## Controls

**A rebinding touches exactly one file: `src/game/keybindings.ts`.** It is the config the
rest of the game reads — `DEFAULT_KEYBINDINGS` maps each `GameAction` (four directions,
`attack`, `cast` fireball, `frost` nova, `enchant` the blade) to the `KeyboardEvent.code`s and mouse buttons that trigger it,
and `validateKeybindings` rejects a map that leaves an action unbound or claims one input
twice. Codes rather than `key` values, so the map survives a non-QWERTY layout. No other
module may name a key.

**A `Direction` is an input; a `Heading` is what all of them add up to.** Four keys make
eight headings, because this is a twin-stick game and two keys at once mean the diagonal
between them — so `DIRECTION_AXES` groups the four into the two axes they push, one
winner is taken per axis (newest press wins *its own* axis, so opposites reverse rather
than cancel), and the two are summed by `headingOf`. Nothing downstream of `controls.ts`
should ever see a bare `Direction` again: `player.ts` steps and faces by `Heading`, and a
diagonal that clips a landform slides along the open axis instead of stopping dead.

Four files, and no fifth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/keybindings.ts` | What an input *means*: the binding table, the lookups over it, and `headingToward` — a free direction (a mouse, one day a stick) snapped to the nearest of the eight headings. |
| `src/game/controls.ts` | What is *held*, in actions rather than keys — per-action source sets so redundant bindings do not cancel each other, one winner per axis summed into a `Heading` (newest-press-wins within an axis), and the one-shot queue that keeps a tap shorter than a frame, two same-frame taps joining into the diagonal they mean. Also the **aim**: `aimAt` takes the cursor's screen offset from the hero's chest, un-foreshortens it by `DEPTH_RATIO` so the angle is the one on the ground, and holds the last angle pointed at — unsnapped. |
| `src/game/player.ts` | What the hero *does* about it: a pure, renderer-free simulation over (state, intent, elapsed, world). **North and south walk the heading; east and west strafe, and strafing turns the world** — a press is two gaits over a `PlanetPose` (`Gait`), not a direction on a map, and a diagonal is both walks at once rather than a fifth direction the planet does not have. Two tracks — the legs (`anchor` and `offset`, walked by velocity) and `attackMs` for the sword arm — aged independently, so he can swing mid-stride. Movement is free: a frame walks its share of the heading at one speed in all eight directions, and stops the frame the heading does. `facing` is a `Facing` (a yaw) read from `Intent.aim` when there is one and from the heading otherwise, and `facingYaw` is the one place a heading becomes a turn of the rig. It hands the renderer three views of the pose: `groundPose` (the anchor: whole tiles, what the world is sampled from), `scrollPhase` (the remainder, under a tile on each axis, that it is drawn at) and `livePose` (the continuous truth, which only the horizon shows). The anchor moves a tile when the remainder passes one, and the two cancel. `nextAnchor` hands back the same pose object for the same whole-tile walk, and `upcomingAnchor` names the one he is walking into, so the layers' work for it is done in the frames before he arrives (`prefetcher.ts`). |
| `src/game/hero-layer.ts` | The wiring only — DOM events in (the pointer mapped back to a logical pixel through the canvas's own box by `logicalPoint`, since the canvas is CSS-scaled at a whole factor), and a frame of `hero/hero-look.ts` into two `PixelSurface`s. The tracks are put back together in `layeredPose` (`hero/hero-figure.ts`), which **layers** the clips — unkeyed channels fall through, and `SWING` keys nothing below the waist. A blow or a spell leaves along `facing`, the aim, not the heading. The pixel skin's one file that listens to input (through `scene.input`, `src/engine/input.ts`); the low-poly skin's is `src/skins/lowpoly/index.ts`. Both feed the same `hero/hero-driver.ts`, which holds the control state and steps `player.ts`. |

That split is the `Separation` contract above, applied to input: the simulation is
deterministic and testable without a canvas, and the presentation layer can exaggerate a
step without being able to change where it lands. **Adding an action is a row in
`keybindings.ts` and a track in `player.ts`**, never a key check in a scene — and *track*
is the word on purpose: a new action gets its own timer and its own clip layer unless it
genuinely cannot coexist with the others, because a shared enum is how an action starts
silently waiting for an unrelated one to finish.

Facing and heading are allowed to disagree, and do. The *camera* is bolted to the
heading, so it swings when the hero strafes; the *sprite* turns to face the cursor (or,
with no cursor yet, the way the key pointed), and that is a screen-space turn of the rig,
not a turn of the world. A hero who turned his shoulders to walk right would be fighting
a camera that had already turned.

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

The same gap has a second, sharper form: **the GPU half of a frame is invisible to
`tsc` and to Vitest.** A shader that fails to compile, a pass whose sampler points at the
wrong texture, a render target drawn the wrong way up — each type-checks, passes every
test (Node has no WebGL), and shows as a black or garbled canvas on the first frame. An
earlier form of this was Phaser's ambient type namespace: 306 tests passed on a module
that died at `Phaser.BlendModes.ADD`. The only thing that catches either is loading the
page.

**Performance is a number, not an impression.** `?skin=pixel&bench=1&sync=1` (with `&time=21&weather=storm`
for the heaviest sky) walks a fixed route — standing, each gait, then a fight — by pressing
the keys a player would, and reports each segment's frame work (p50/p95/max), hitches and
garbage, plus the cost of every layer (`src/game/bench.ts`, `bench-runner.ts`). Run it in a
foregrounded tab with nothing else open; a background tab is throttled and its numbers are
meaningless. A change that claims a saving shows the before and after.

## Guardrails

Baseline guardrails — including the instruction-file feedback loop (**never silently
work around a bad instruction**) — are in `.claude/rules/engineering.md`. Rules for
writing skills and rules themselves are in `.claude/rules/authoring.md`. Where a session
stops — no commit, push or PR, finish with `/ship` — is `.claude/rules/session-scope.md`.
Cross-reference this project's own scoped rules here, one line each.

- **`.claude/rules/art-pipeline.md`** (`src/game/**/*.ts`) — how to draw and animate:
  pick the cheapest mechanism that makes the picture, and never hand-draw a frame you
  could derive.
- **`.claude/rules/procedural-effects.md`** (`src/game/**/*.ts`) — how to simulate
  rather than draw: emitters, fields, noise, automata, SDF spell geometry, decals and
  impulse, and the seeding rules that keep every one of them reproducible.
- **`.claude/rules/rendering.md`** (`src/game/**/*.ts`) — how pixels reach the screen:
  bakes vs surfaces, the lighting pass, `FrameContext`, and the per-frame budget.
- **`.claude/rules/game-architecture.md`** (`src/game/**/*.ts`) — which module owns each
  decision: camera and horizon, the ink pipeline, scenery.
- **`.claude/rules/skin-lowpoly.md`** (`src/skins/lowpoly/**/*.ts`) — the low-poly skin:
  its projection twin of the pixel skin's, body anchors on the lip, and its budget.
- **`/art-check`** (`.claude/skills/art-check/`) — the browser capture ritual that turns
  "the tests are green" into "the picture is right". Every art change ends there.
- **`/preview`** (`.claude/skills/preview/`) — start this worktree's dev server and hand
  the user the URL it printed, as links to the game, each skin and the labs.
