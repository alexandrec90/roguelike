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
| **Movement** | **Built.** Eight-way, from any two of the four bound directions held at once (`controls.ts` reads one winner per axis and sums them). A press still commits one whole tile of walking that runs to completion, and a diagonal is given √2 the time so it is not a 41%-faster shortcut. On a round planet a diagonal is the two gaits walked together — forward *and* strafe — rather than a fifth direction, so it turns the world exactly as a sideways step does. |
| **Acting while moving** | **Built.** Locomotion and the swing are **two timers over one skeleton**, aged independently in `player.ts` — an attack never costs a step and a step never delays an attack. Every action added later belongs on its own track for the same reason; the moment two of them share an enum, one of them starts waiting. |
| **Aim** | **The direction, not yet built.** Facing currently follows movement, out of four drawings — front, its mirror, back, its mirror — so all eight headings read. Aim becomes a second axis pair (right stick, or the mouse) bound in `keybindings.ts` exactly like the first, and the day it lands, facing reads *it* instead of the heading. Nothing outside `player.ts` should assume the two agree. |

**Responsiveness is a contract, not a polish pass.** Three rules hold the feel, and each
is one an ordinary refactor breaks by accident:

- **Turning is immediate.** Facing is re-read from the intent *every frame*, never at the
  end of an action, because the turn is what a player reads as the game hearing them.
- **No input is dropped for being early.** A press that lands mid-action is queued and
  spent on the frame the track is free (`controls.ts`), and the overshoot past an action's
  end carries into the next, so a held key gives an even rhythm rather than a stutter.
- **Two things that could happen at once, do.** The only latency left is the step's own
  commitment: a direction pressed mid-step is acted on when the foot lands, up to
  `STEP_MS` later. That is the price of tile-committed walking, and it is the one worth
  revisiting if the game ever wants free positioning.

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
| Render target | Render the world at 320×180, then nearest-neighbor upscale the whole canvas by the smallest integer factor that covers the full window. Centre-crop horizontal overflow, keep the horizon pinned to the top, and clip vertical overflow from the near foreground; never expose a border or distort the aspect ratio. **The window therefore decides how much world you can see** — a short window clips the near rows — but it can no longer decide how much world *exists*: the planet is unbounded and the hero is pinned to one pixel inside the walkable band (`src/game/viewport.ts`), so a dragged window edge re-frames him rather than stranding him. |
| Setting | **Outdoors.** The game is an overworld — fields, paths, rock, sky — not a dungeon interior. |
| Color | **A closed palette of named inks on pitch black.** The background is `#000000`, never "very dark"; everything drawn is high-contrast lit pixels in a named ink from the closed set in `src/game/ink.ts`. No asset invents a hex value — new colours are new inks, added deliberately. `void` ink is deliberate black, for punching holes (eyes, hollows) into a lit silhouette. An ink may be **translucent** — `INK_ALPHA` carries its opacity and `inkHex` spells it, so `water` is sheer wherever it is drawn and no call site invents an alpha for a colour. A scene dimming a whole layer is lighting, and multiplies the ink's own alpha rather than replacing it. |
| Light and shade | The palette is closed but **not one bit deep**. Shadow, highlight and gradient are *computed, never painted*: an ordered **ink ramp**, a light direction, and a 4×4 Bayer dither locked to the logical pixel grid (`src/game/shading.ts`). Shading is a pass over a pixel cloud, so it applies to every model that exists or ever will, and a ramp arranges the palette rather than extending it. Hold identity inks — a cyan blade, a magenta hat, `void` eyes — out of the light pass, so the silhouette still reads at 1×. |
| Camera | A **pitched-back overhead** view, not a 45°-yaw diamond isometric: rows and columns stay axis-aligned and only the vertical axis is foreshortened. A 16×16 world square lands on 16×12 of screen, and height rises straight up the screen by `WALL_RISE`, which is what makes walls stand. `src/game/projection.ts` owns that math; nothing else re-derives it. The camera is **bolted to the hero and turns with him** — he never moves on screen, the planet moves under him (`src/game/camera.ts`). |
| Grid | 16×16 tiles, and **the grid belongs to the screen, not to the world**: the planet has no lattice, so a turning camera never puts a tile on a diagonal. Author ground art **already foreshortened** — 16×`TILE_DEPTH` for anything lying on the ground, 16×`WALL_RISE` for anything standing up — so every tile blits 1:1 and nothing is scaled at draw time. Snap rendered objects and the camera to logical integer pixels. Do not use antialiasing, arbitrary sprite rotation, or continuously fractional sprite transforms. |
| Flatness | Below the horizon band the ground is **affine, not perspective**: every world row is exactly `TILE_DEPTH` scanlines tall, with no convergence and no per-row scaling. A tile's screen size never depends on how far up the screen it is. |
| Horizon | The top of the screen **rolls over the horizon** — sky, then a short band where the ground curves away and `ROLL_ROWS` world rows compress into a few scanlines, then the flat field. `src/game/horizon.ts` owns it, and one knob sets the split. **The horizon is real, and the band is a place rather than a backdrop.** Anything that stands is drawn over it, so a tree on the far row keeps its crown against the sky, and what is on the horizon line is a feature of the planet: a body past the field's far edge lands on the roll a little higher and a little smaller for every row it is further away (`rollPlacement`), and walking toward it makes it grow and come down onto the flat field. Nothing that a player could walk to is painted at a bearing. |
| Identity art | **Characters are skeleton rigs**, not frame-by-frame sprites: bones posed in rig-space 3D (`src/game/rig.ts`), dressed by the authored models in `src/game/models.ts`, rasterized to pixels at draw time. Props, tiles, and effect sources stay authored palette-indexed raster sprites. All sources are text-defined and diffable; generated PNG atlases are build output. SVG is not a primary game-art format. |
| Procedural art | Use math for motion, light, particles, world simulation and effects. Character silhouettes are procedural too — posed rigs rather than drawn frames — but they stay **authored**: proportions, gear and clips are designed by hand, and a mechanism renders them. Status effects (melt, freeze, burn, reflect) are **generic transforms over pixel clouds** (`src/game/transforms.ts`), never per-model frames. Image-generated art may guide mood and composition; it never becomes production pixels. |
| Animation | Character actions are **clips**: sparse 3D keyframes over rig bones (`src/game/models.ts`), sampled per channel — a new attack is a handful of direction lines, not a redraw. Facing is front/back only (depth negated, front-only stamps dropped); left/right is a mirror flip. Combine silhouette-changing poses with discrete, grid-quantized translation and squash/stretch. Express actions as anticipation, fast contact, hit stop, overshoot, and settle; drive visual beats from gameplay events. Prefer **more terms over more keyframes**: what is on screen is `base pose + clip + secondary motion + reaction`, each a function of time, summed. Breathing, bob, recoil, stagger and wind are terms, not frames. |
| Effects | Build particles from 1–4 logical-pixel primitives or tiny raster sprites. Pool them, cap their count, and use seeded randomness when reproducibility matters. Motion comes from a field — noise, a flow field, gravity, a curve — never from a drawn path. |
| World | **A round planet, and no map edge.** Walk straight for `PLANET_TILES` and you return to where you began; walk sideways and you slide round a circle of radius `radius` whose centre sits behind you, so one lap of `2·π·radius` tiles brings you back having swung the horizon through a full 360° (`src/game/planet.ts`). Terrain is a seeded, wrapping, **continuous field** over planet coordinates (`src/game/terrain.ts`) rather than an authored map — which is what lets the local grid stay axis-aligned while the world turns through it. |
| World simulation | **The direction, not yet built.** Elemental state belongs to the world rather than to an animation: an **effect field** under the tiles, holding fire, water, ice, electricity, poison and corruption as cell state that spreads and combines — fire + grass spreads, electricity + water arcs, fire + ice steams. Build a new element as a rule over that field once it exists, so interactions fall out of the system instead of being drawn one pairing at a time. |
| Separation | Keep the movement and combat simulation deterministic and independent of the presentation layer. Rendering may exaggerate an event but must not determine its outcome. |

### The camera, and the band at the top of it

Seven modules, and no eighth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/projection.ts` | `TILE_WIDTH` 16, `TILE_DEPTH` 12, `WALL_RISE` 16, and `cellOrigin()` / `cellFoot()` / `rowAtFoot()` / `wallCapY()` / `wallFaceY()` / `depthOf()`. Draw order is `row * TILE_WIDTH + rank` — painter's algorithm down the screen. |
| `src/game/planet.ts` | The round world: `PLANET_TILES`, the sideways circle's radius, `stepForward` / `stepStrafe` / `applyGait` (both walks at once, which is what a diagonal is), and the only conversion between planet and local coordinates (`fromLocal` / `toLocal`). |
| `src/game/terrain.ts` | What the planet is made of, as a continuous seeded field — `terrainAt()`, `elevationAt()`, and the point features (`treesNear`, `puddlesNear`) hashed out of planet cells. |
| `src/game/camera.ts` | The local frame on screen: the pixel the hero is nailed to, the sub-tile `scrollOffset` of a stride in flight, and `localFoot` / `localOrigin` / `localRow` — the one answer to "this is *x* tiles right and *y* ahead, where do I draw it". `localPlacement` is that answer continued past the field's far edge: where on the roll a body stands, how small it is, and whether it has gone over the horizon. |
| `src/game/horizon.ts` | `horizonLayout(height, skyFraction)` → `skyHeight`, `rollHeight`, `horizonY`, `groundTop`, `groundHeight`. Also the sky ramp, `ridgeProfile()` for distant silhouettes — which takes a `period` when the profile has to close on itself — and the roll's projection: `ROLL_ROWS` to the horizon, `HORIZON_SCALE` at it, and `rollPlacement(rowsBeyond)` → lift and scale, the one curve both the ground's roll bands and every body standing on them are drawn from. |
| `src/game/panorama.ts` | The horizon as a 360° loop: `PANORAMA_WIDTH` pixels to a full turn, `bearingOffset()` from a heading, and where a landmark at a bearing lands on screen. |
| `src/game/viewport.ts` | What the window left of the render target: `visibleHeight()` (scanlines that survived the cover crop), `walkableBand()` (that, horizon roll excluded) and `anchorFoot()` (the pixel the hero — and therefore the whole world — is centred on). The one place the *window* is allowed to influence the simulation, and it now only re-frames. |

`src/game/tiles.ts` still owns the terrain art itself, in one shared palette.

**The grid belongs to the screen, and the planet has no grid.** That is the load-bearing
sentence, because it is what reconciles a camera that turns with a pixel contract that
forbids rotating a sprite. A tile is a *sample the screen takes*, not a thing the world
has: every grid cell reads `terrainAt(fromLocal(pose, ...))`, so turning changes what
lands in a cell and never how a cell is drawn. Motion splits the same way — the
**integer** part of a stride lives in which planet point each cell samples, the
**fractional** part lives in one whole-pixel `scrollOffset`, and at a step boundary the
two cancel exactly.

**Nothing is drawn from more than one direction, and nothing needs to be.** The player
cannot perceive absolute rotation — the camera is bolted to the heading, so the view is
identical at every bearing — so an object's *art* never varies with which way the world
has turned. Only its position does. The ridge and the stars are the airtight case: they
sit at a bearing, effectively infinitely far, so the viewing angle on them cannot change
at all. Near props are a small and safe lie — walk past a tree and you see the same
sprite from behind, which on a broadleaf nobody can tell. The lie only shows on an
*asymmetric* near prop (a signpost, a door), and the answer there is the rig's existing
`facing: front | back`, never an eight-way sprite set. This is why the round planet cost
the art pipeline nothing.

**A body past the field is the same field sampled at a smaller scale, never a shrunk
sprite.** The horizon roll is the one place the projection makes a thing smaller for
being far away, and it does it by handing the volume shader a `u_scale` (and the CPU
rasteriser the same number), so every screen pixel evaluates the description at its own
point and the dither stays locked to the screen grid. That is what lets the speck on the
horizon and the tree the hero walks past be one object. A raster sprite cannot be drawn
out there — it would have to be resampled — which is a reason to make scenery volumetric,
not a reason to scale a sprite.

The one thing that would break it is a light anchored to the **planet** instead of the
screen. `shadeCloud` takes a screen-space direction, so the sun turns with the camera and
is free; give it a world bearing and every model needs re-lighting per heading, and the
saving above is gone. Keep light in screen space.

The trade that buys it: the ground can only turn in whole tiles, once a step. The
**horizon carries the turn continuously instead** (`sky-layer.ts` over `panorama.ts`),
which is where the eye reads a turn anyway, and distance reconciles the two. `?radius=`
is the knob: turn it up until the ground's quantisation disappears, down until every
step swings the sky.

**That quantisation is not confined to the tiles, and this is the part that cost a
session.** Read as written above, the trade sounds like it is paid by the grid alone —
but a strafe rotates the local frame, and the renderer carries a step in flight as a
*single uniform translation* (`scrollPhase`), so **everything drawn from the local frame
pays it**: trees, props, puddles, the slime, the torch. Those are point features, not
cells; they have exact planet coordinates and could follow the true arc continuously. As
built they cannot, because they are drawn from `groundPose + scrollPhase` so the whole
picture moves rigidly, and a translation cannot approximate a rotation. The two agree at
the start of a step and part company by its end, where every object on screen snaps by a
*different* amount — sideways by `d · y / radius`, and in **depth** by `d · x / radius`,
so things left and right of the hero jump in opposite directions. At radius 19 that was
7.5px of up-and-down and 10px of sideways per step, and it read as objects moving
unpredictably rather than as a world turning. Walking forward is exempt, because that
step genuinely is a translation.

`DEFAULT_STRAFE_RADIUS` is 512 for exactly this reason, not for feel: depth motion goes
sub-pixel at 277 and both axes do at 474, so at 512 nothing on screen can move a whole
pixel because of a strafe, and the arc is shallow enough that the straight-line slide the
renderer draws is within half a pixel of the arc the simulation walks. `map-drift.ts`
holds that arithmetic and `map-drift.test.ts` pins it, so lowering the radius fails a
test rather than quietly returning the jumping. **If you want a tight radius back — a
world that visibly turns under a strafe — raising the number is not enough; the sub-step
motion has to be drawn as the arc it is, per object, rather than as one offset for the
whole scene.** `?map=1` draws that disagreement as a field of lines and is the fastest
way to see whether a change helped.

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
| `src/game/puddles.ts` | Standing water: a seeded, foreshortened outline generated from a centre and a radius, plus everything on its surface — rim, glints, reflection, and the rings the rain punches into it. Placement is a point feature of `terrain.ts`; the scene only draws. |
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

**Two knobs, neither of them a constant to inline.** `DEFAULT_SKY_FRACTION` in
`horizon.ts` sets the 88/12 sky split and `?horizon=8%` (or `?horizon=0.08`) overrides
it per load; `DEFAULT_STRAFE_RADIUS` in `planet.ts` sets how hard the world turns
when you walk sideways and `?radius=64` overrides that. Both are meant to be retuned by
eye in the address bar rather than in a rebuild — though the radius is no longer *only* a
feel decision, and the paragraph above says what it is now also holding down.
The split grew from 5% when the horizon became real: a tree standing on the horizon
line is drawn at `HORIZON_SCALE` of its height and needs that much sky to keep its crown
on screen.

**And one instrument: `?map=1`** (`map-overlay.ts`, `map-panels.ts`, `map-drift.ts`).
Off on every other load, drawn on its own canvas over the game so it never enters the
320×180 target or the ink contract. Three panels — the planet north-up where nothing
rotates, the local frame that does, and a readout whose last number is how far the
picture will jump when the step in flight lands. It exists because the frames disagree in
ways no screenshot shows: reach for it before reasoning about turning, scrolling, or
where a feature is, and prefer adding a panel to it over adding a `console.log`.

There is no on-screen caption printing the resulting pixel counts — **the page is the game
world and nothing else**, so judge a split against the frame itself and read the numbers
from `horizonLayout()` in the console or from `horizon.test.ts`. Read
`horizonLayout()` for `groundTop` — never hard-code a y for the horizon, and never
assume the flat field starts at 22px, because that number moves the moment the knob does.

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

### Scenery: trees and props

A tree is not a sprite and not a tile. It is **a seeded generator plus a per-frame pose**
(`src/game/scenery.ts`), and everything downstream is written once against that contract —
so a shadow, a reflection, a burn, a palette variant and a detail budget apply to a
species nobody has written yet.

| Module | Owns |
| --- | --- |
| `src/game/scenery.ts` | The contract: `ScenerySpecies` (a seed makes a shape), `SceneryInstance` (a clock poses it, `cloud` returns lit pixels), and `VolumePart` — a body as a *description* the GPU can also draw. |
| `src/game/procgen/` | The primitives, none of which are about trees: `volume.ts` (lobes smooth-unioned into a field), `sdf.ts`, `noise.ts`, `verlet.ts` (rope and chain), `growth.ts` (space colonization), `heat.ts` (the fire automaton), `motes.ts`. |
| `src/game/trees/` | The species — eight of them, each existing to demonstrate one mechanism — plus `foliage.ts` for what they share. |
| `src/game/props/` | A boulder, a bush and a mushroom, built from the same three calls as a crown. |
| `src/game/gpu/` | The volume shader (`volume-shader.ts`), its uniforms (`volume-uniforms.ts`), and the two hosts that consume it: `volume-phaser.ts` for the game, `volume-gl.ts` for the lab's readback and parity diff. |
| `src/game/lod.ts` | The detail budget. A distant body evaluates the **same field** more cheaply — never a different, simpler model — so it gains detail as you walk toward it instead of popping. |
| `src/game/scenery-layer.ts` | The Phaser wiring: one `GameObjects.Shader` per volume part, positioned at the body's foot and depth-sorted like anything else. |
| `src/game/scenery-slots.ts` | Which body gets which slot, pure and tested — the pool is smaller than the planet, so a slot is *lent* to whichever tree is in reach and an incumbent keeps it. |

Three things about it that are easy to break:

- **A body is a game object, not a texture.** An earlier version rendered into a second
  WebGL2 context and handed Phaser one texture, which meant one depth for all the scenery
  and a hand-rolled behind/in-front split around the hero. Phaser accepts a context you
  give it (`main.ts` hands it a WebGL2 one), and on that it compiles the `#version 300 es`
  shader through `GameObjects.Shader` unchanged — so a body takes a `setDepth` and
  interleaves with the hero for free.
- **Phaser matches uniforms against WebGL's *active* names**, where an array is
  `u_lobes[0]`. The bare name is silently ignored, the lobes stay at radius zero, and the
  body draws nothing, with no error anywhere. `ARRAY_UNIFORMS` holds that in one place.
- **A tree is a point feature, not a cell.** It has planet coordinates out of
  `terrain.ts`, keeps its identity as the world scrolls, and is seeded and wind-sampled
  from the *planet* point rather than from where it happens to be on screen — otherwise a
  whole field of them re-phases every time the hero takes a step. The same identity is
  what makes the horizon real: the layer sweeps for trees out to `ROLL_ROWS` past the
  field, and one that first appears as a speck on the horizon line holds its slot, its
  seed and its sway all the way down onto the field.

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
rest of the game reads — `DEFAULT_KEYBINDINGS` maps each `GameAction` (four directions
plus `attack`) to the physical `KeyboardEvent.code`s and mouse buttons that trigger it,
and `validateKeybindings` rejects a map that leaves an action unbound or claims one input
twice. Codes rather than `key` values, so the map survives a non-QWERTY layout. No other
module may name a key.

**A `Direction` is an input; a `Heading` is what all of them add up to.** Four keys make
eight headings, because this is a twin-stick game and two keys at once mean the diagonal
between them — so `DIRECTION_AXES` groups the four into the two axes they push, one
winner is taken per axis (newest press wins *its own* axis, so opposites reverse rather
than cancel), and the two are summed by `headingOf`. Nothing downstream of `controls.ts`
should ever see a bare `Direction` again: `player.ts` steps and faces by `Heading`, and a
diagonal that clips a rock slides along the open axis instead of stopping dead.

Four files, and no fifth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/keybindings.ts` | What an input *means*: the binding table, and the lookups over it. |
| `src/game/controls.ts` | What is *held*, in actions rather than keys — per-action source sets so redundant bindings do not cancel each other, one winner per axis summed into a `Heading` (newest-press-wins within an axis), and the one-shot queue that keeps a tap shorter than a frame, two same-frame taps joining into the diagonal they mean. |
| `src/game/player.ts` | What the hero *does* about it: a pure, Phaser-free simulation over (state, intent, elapsed, world). **North and south walk the heading; east and west strafe, and strafing turns the world** — a press is two gaits over a `PlanetPose` (`Gait`), not a direction on a map, and a diagonal is both walks at once rather than a fifth direction the planet does not have. Two tracks — `motion`/`motionMs` for the legs, `attackMs` for the sword arm — aged independently, so he can swing mid-stride. A press commits one whole tile of walking that runs to completion (√2 as long on a diagonal, so eight-way movement has one speed), and the `ORIENTATION` table is the one place a heading becomes a facing. It hands the renderer three views of the pose: `groundPose` (frozen for the stride, what the world is sampled from), `scrollPhase` (the sub-tile offset it is drawn at) and `livePose` (the continuous truth, which only the horizon shows). |
| `src/game/hero-layer.ts` | The wiring only — DOM events in, a posed rig into a `Graphics`. Also the one place the two tracks are put back together: `samplePose(SWING, samplePose(WALK, …), …)` **layers** the clips, because unkeyed channels fall through to the base pose and `SWING` keys nothing below the waist. The single file here that imports Phaser. |

That split is the `Separation` contract above, applied to input: the simulation is
deterministic and testable without a canvas, and the presentation layer can exaggerate a
step without being able to change where it lands. **Adding an action is a row in
`keybindings.ts` and a track in `player.ts`**, never a key check in a scene — and *track*
is the word on purpose: a new action gets its own timer and its own clip layer unless it
genuinely cannot coexist with the others, because a shared enum is how an action starts
silently waiting for an unrelated one to finish.

Facing and heading are allowed to disagree, and do. The *camera* is bolted to the
heading, so it swings when the hero strafes; the *sprite* still turns to face the
way the key pointed, because the rig has a front, a back and a mirror and nothing
else. A hero who turned his shoulders to walk right would be fighting a camera that
had already turned.

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
