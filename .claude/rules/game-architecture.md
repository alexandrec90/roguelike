---
description: Which module owns what in the game — the camera and the horizon band, the ink pipeline, and scenery — and the contracts between them that are easy to break
paths:
  - src/game/**/*.ts
---

# Rule: Where each part of the picture is decided

`CLAUDE.md`'s *Visual and Asset Architecture* is the product contract: what the game looks
like and why. This rule is the module map underneath it — which file owns each decision,
so a change lands in the one place that makes it rather than in a second copy of the math.
Moved out of `CLAUDE.md` so the always-loaded file keeps room under the 500-line contract;
it loads whenever a game module is open.

## The camera, and the band at the top of it

Seven modules, and no eighth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/projection.ts` | `TILE_WIDTH` 16, `TILE_DEPTH` 12, `WALL_RISE` 16, and `cellOrigin()` / `cellFoot()` / `rowAtFoot()` / `wallCapY()` / `wallFaceY()` / `depthOf()`. Draw order is `row * TILE_WIDTH + rank` — painter's algorithm down the screen — and `standingDepth(row, rank)` continues it past the field's far edge: rows on the roll squeezed into a band that stays in front of the cloud pass and the horizon band, still sorted far behind near. |
| `src/game/planet.ts` | The round world: `PLANET_TILES`, the sideways circle's radius, `stepForward` / `stepStrafe` / `applyGait` (both walks at once, which is what a diagonal is), and the only conversion between planet and local coordinates (`fromLocal` / `toLocal`). |
| `src/game/terrain.ts` | What the planet is made of, as a continuous seeded field — `terrainAt()` (grass or dirt; the ground is flat) and the point features (`treesNear`, `puddlesNear`) hashed out of planet cells. Everything tall is `landforms.ts`. |
| `src/game/camera.ts` | The local frame on screen: the pixel the hero is nailed to, the sub-tile `scrollOffset` of a stride in flight, and `localFoot` / `localOrigin` / `localRow` — the one answer to "this is *x* tiles right and *y* ahead, where do I draw it". `localPlacement` is that answer continued past the field's far edge: where on the roll a body stands, how small it is, how far it has sunk behind the horizon line and the scanline it is clipped at (`clipY`). `projectDepth` is the same answer for a continuous depth, which is what the landform march steps through. |
| `src/game/horizon.ts` | `horizonLayout(height, skyFraction)` → `skyHeight`, `rollHeight`, `horizonY`, `groundTop`, `groundHeight`. Also the sky ramp, `ridgeProfile()` for distant silhouettes — which takes a `period` when the profile has to close on itself — and the roll's projection: `ROLL_ROWS` to the horizon, `HORIZON_SCALE` at it, and `rollPlacement(rowsBeyond, rollHeight)` → lift and scale, the one curve both the ground on the lip (`roll-ground.ts`, via `rollRowAt`) and every body standing on it are drawn from. The curve's knee is derived from `rollHeight`, never tuned: it is whatever makes the lip start at the flat field's slope and end on the horizon line. Past `ROLL_ROWS` the scale keeps falling and a body sinks foot first behind the line (`horizonSink`, `HORIZON_SINK_RATE`); `rowsToSink(height)` is how far out a body of that height still shows, and so how far any layer must sweep for it. |
| `src/game/panorama.ts` | The horizon as a 360° loop: `PANORAMA_WIDTH` pixels to a full turn, `bearingOffset()` from a heading, and where a landmark at a bearing lands on screen. |
| `src/game/viewport.ts` | What the window left of the render target: `visibleHeight()` (scanlines that survived the cover crop), `walkableBand()` (that, horizon roll excluded) and `anchorFoot()` (the pixel the hero — and therefore the whole world — is centred on). The one place the *window* is allowed to influence the simulation, and it now only re-frames. |

`src/game/ground/` owns the terrain art itself: tiles generated procedurally (seamless grass, neighbour-aware path edges), baked once and composed per step, plus the baked tuft atlas the grass is drawn from.

The horizon lip is that same ground carried past the seam, in two passes over one surface: `roll-ground.ts` (tiles, tufts and the air's tint, each scanline asking `rollRowAt` which row it shows) and `roll-water.ts` (the water layer's own puddles, grown by `growPuddles`, laid into world texels). Nothing stands in the ground: what stands is a landform or a body, drawn by its own layer through the same projection, so the lip never has to know about it. A far lip pixel spans many texels, so it shows its cell's *far colour* (`distantShare`) and never composes a tile; reading the lattice under the far lip is what made a step frame stall.

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
*asymmetric* near prop (a signpost, a door), and the answer there is a rig turned by its
existing `yaw`, never an eight-way sprite set. This is why the round planet cost
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

**Point features pay the same strafe quantisation as tiles.** The renderer draws
`groundPose + scrollPhase` as one translation, which cannot follow a tight arc.
`DEFAULT_STRAFE_RADIUS` stays at 512 to keep the resulting jumps sub-pixel;
`map-drift.test.ts` pins that budget. Before changing turning, scrolling, or the
radius, read [the camera-motion reference](../camera-motion.md) and inspect
`?map=1`. A tighter radius needs per-object arc motion during a step.

## Landforms: everything tall

Mountains, mesas, spires and towers are not tiles and not sprites. Each is **a height
function over planet coordinates**, evaluated once onto a grid fixed to the planet and
drawn by one march over depth, so its shape cannot depend on the pose, the strafe or
the screen's grid — the cause of every block that changed shape, popped in or floated
over the sky when rock was grid-quantised cells.

| Module | Owns |
| --- | --- |
| `src/game/landforms.ts` | Where they are (`planetLandforms`, a seeded lattice of `LANDFORM_CELL` cells), their shapes (`landformShape`), the per-landform `LandformField` (heights, normals, materials, detail, block maxima), and the gameplay half: `landHeightAt`, `blockedByLand` (taller than `BLOCK_HEIGHT`) and `openGround`. |
| `src/game/landform-frame.ts` | What a frame is: `LandformView`, `LandformLight` (sun, haze, cloud shade, the hero's `Cutaway`), and `LandformPixels` — colour plus the affine row each pixel shows. |
| `src/game/landform-march.ts` | The march: `marchSchedule` (depths near to far, each asking `projectDepth`), and `LandformPainter`, which keeps the highest scanline painted per column — a nearer slope hides a farther peak because it was reached first. |
| `src/game/landform-colour.ts` | The look: posterised ramps per material, wrap light, a narrow dithered seam, and planet-fixed grain on standing faces (courses, ledges, strata, windows). Inks only. |
| `src/game/landform-render.ts` | The frame-level passes: `viewsInSight`, near over far (`isFarView`, `mergeLandforms`), the outline. |
| `src/game/landform-slices.ts` | Cutting the picture into one slice per row and 32-column chunk, shelf-packed into one atlas. |
| `src/game/landform-layer.ts` | The Phaser wiring: re-render only when what it shows moved, far views kept between strides, each slice shown at `standingDepth(row)` so a tree behind a mesa is hidden and the hero walks round a flank. |

Two things that are easy to break:

- **Every depth goes through `projectDepth`.** A landform drawn by its own projection
  would shear against the ground at the seam and pop at the horizon line.
- **Slices sort; the picture does not.** A landform is one render but many depths. Draw
  it as one image and it is either in front of every tree or behind them all.

## The ink pipeline

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

**Knobs, none of them a constant to inline** (all read in `scene-options.ts`; also
`?time=21` or `?time=18:30` pins the clock, `?day=120` sets a day's seconds, and
`?weather=clear|rain|storm` pins the sky). `DEFAULT_SKY_FRACTION` in
`horizon.ts` sets the 78/22 split between flat field and band and `?horizon=8%` (or `?horizon=0.08`) overrides
it per load; `DEFAULT_STRAFE_RADIUS` in `planet.ts` sets how hard the world turns
when you walk sideways and `?radius=64` overrides that. Both are meant to be retuned by
eye in the address bar rather than in a rebuild — though the radius is no longer *only* a
feel decision, and the camera section above says what it is now also holding down.
The split grew from 5% when the horizon became real: a tree standing on the horizon
line is drawn at `HORIZON_SCALE` of its height and needs that much sky to keep its crown
on screen. It grew again, to 22%, when the roll became a lip: a curve that starts at a
full 12-scanline row needs about two rows of screen to bend, or it reads as a fold.

**And one instrument: `?map=1`** (`map-overlay.ts`, `map-panels.ts`, `map-drift.ts`).
Off on every other load, drawn on its own canvas over the game so it never enters the
320×180 target or the ink contract. Three panels — the planet north-up where nothing
rotates, the local frame that does, and a readout whose last number is how far the
picture will jump when the step in flight lands. It exists because the frames disagree in
ways no screenshot shows: reach for it before reasoning about turning, scrolling, or
where a feature is, and prefer adding a panel to it over adding a `console.log`.

There is no on-screen caption printing the resulting pixel counts — **the page is the game
world and nothing else** (the one exception is the controls reminder, `help-overlay.ts`: H, ?
or F1, generated from the binding table), so judge a split against the frame itself and read the numbers
from `horizonLayout()` in the console or from `horizon.test.ts`. Read
`horizonLayout()` for `groundTop` — never hard-code a y for the horizon, and never
assume the flat field starts at 40px, because that number moves the moment the knob does.

Two rules fall out of the projection and are easy to break by accident:

- **Never scale a sprite to fake foreshortening.** A 16×16 source drawn at 0.75 resamples
  every row, which is precisely the smearing the pixel contract exists to prevent. If a
  thing lies on the ground, author it 16×12.
- **A ground tile and a standing face are different art.** A face is not foreshortened at
  all, it stacks vertically, and so it may carry nothing that reads as "the bottom" — a
  contact shadow inside it becomes a stripe every sixteen pixels. Draw the shadow once, at
  the wall's foot. Equally, a cap is a *surface*: give it no vertical lines, or an outcrop
  reads as brickwork lying flat.

## Scenery: trees and props

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
| `src/game/gpu/` | The volume shader (`volume-shader.ts`), its uniforms (`volume-uniforms.ts`), and `volume-gl.ts`, the tree lab's host for its readback and parity diff. The game no longer draws with it. |
| `src/game/lod.ts` | The detail budget. A distant body evaluates the **same field** more cheaply — never a different, simpler model — so it gains detail as you walk toward it instead of popping. |
| `src/game/scenery-bake.ts`, `scenery-cache.ts` | Bodies baked once per lean, per light, per horizon scale — posed by stepping the species under a fixed wind — into textures. |
| `src/game/scenery-bake-jobs.ts`, `scenery-baker.ts`, `scenery-bake-worker.ts` | A bake as plain data, and where it runs: Web Workers, routed so one body's leans settle in order on one bench, or inline where there are none (the tests). |
| `src/game/scenery-features.ts`, `scenery-layer.ts` | Which species stands where on the planet; the Phaser wiring that picks a baked lean from the wind. |
| `src/game/scenery-slots.ts` | Which body gets which slot, pure and tested — the pool is smaller than the planet, so a slot is *lent* to whichever tree is in reach and an incumbent keeps it. |

Two things about it that are easy to break:

- **A body is a baked image, not a per-frame shader.** Each body is two images (body,
  shadow) that depth-sort with the hero for free; per-frame shader bodies cost a third of
  the frame on an integrated GPU. The lab's GPU path still needs `ARRAY_UNIFORMS`:
  Phaser matches uniforms by *active* name (`u_lobes[0]`), and a bare name is silently ignored.
- **A tree is a point feature, not a cell.** It has planet coordinates out of
  `terrain.ts`, keeps its identity as the world scrolls, and is seeded and wind-sampled
  from the *planet* point rather than from where it happens to be on screen — otherwise a
  whole field of them re-phases every time the hero takes a step. The same identity is
  what makes the horizon real: the layer sweeps for trees out to `ROLL_ROWS` past the
  field, and one that first appears as a speck on the horizon line holds its slot, its
  seed and its sway all the way down onto the field.
