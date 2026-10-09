---
description: The low-poly 3D skin - its two backends (WebGPU, WebGL2), projection, water and wave simulation, what it must keep identical to the pixel skin, and its measured budget
paths:
  - src/skins/lowpoly/**/*.ts
---

# Rule: The low-poly skin

A skin is how the game looks and nothing else (`src/skins/skin.ts`). This one draws the
same planet, hero and fight as flat-shaded 3D geometry at the window's own resolution -
or, with `?res=low`, at ~180 scanlines blown up by a whole factor (`look-options.ts`).
The pixel contract in `CLAUDE.md` (320×180, closed inks, Bayer dither, no rotation) does
**not** bind it. Two things do, because they are the game's identity rather than its art:

- **The local view.** An oblique projection, not a perspective camera: a tile across is
  `TILE_WIDTH` logical pixels, a row ahead `TILE_DEPTH`, a tile of height `WALL_RISE`.
  Nothing converges on the field.
- **The treadmill lip.** Past the field's far edge every point follows `horizon.ts`'s
  one curve - up the roll, smaller, then sunk foot first behind the horizon line.

## Two backends, one frame

`lowpoly-game.ts` describes a frame (`FrameUniforms`, `FrameScene`) and a backend
(`backend.ts`) draws it. **WebGPU** (`webgpu/`) is preferred; **WebGL2** (`renderer.ts`)
is the fallback when there is no adapter, no device, or a pipeline fails validation -
`index.ts` tries each on a fresh canvas. `?gpu=webgl|webgpu` forces one, `?msaa=1` turns
multisampling off (and `?res=low` turns it off unless `?msaa=4` asks for it). The geometry, projection and shading are the same in both; only the
water's motion differs, because only WebGPU has compute.

## Every shader is written twice or three times

| Description | CPU reference | GLSL (WebGL2) | WGSL (WebGPU) |
| --- | --- | --- | --- |
| the projection | `placement.ts` | `shaders.ts` `PLACE_GLSL` | `webgpu/wgsl-world.ts` `PLACE_WGSL` |
| the wave step | `webgpu/waves.ts` | - | `webgpu/wave-sim.ts` |
| the sway | `sway.ts` `swayOffset` | `sway.ts` `SWAY_GLSL` | `sway.ts` `SWAY_WGSL` |
| the impostor balls | - | `impostor-glsl.ts` | `webgpu/wgsl-impostor.ts` |

**Change one, change all.** `placement.test.ts` pins `placeVertex` to the pixel skin's
`localPlacement` and `waves.test.ts` the wave step's behaviour; a drift between a
reference and its shader only shows on screen. WGSL clip depth runs 0..1 where GLSL's
runs -1..1, and a WebGPU fragment's position and a texture's rows both count from the top.

Depth is **rows ahead**, not distance from an eye: along any screen ray of this
projection the point further ahead is further away, so it is an exact z-buffer key on
the field and the painter's rule the pixel skin sorts by.

## A vertex knows its body's foot

Each vertex carries an `anchor` (`mesh.ts`). A body - a tree, a slime, the hero - is
placed and shrunk about its foot on the lip, as a sprite is in the pixel skin. The
ground, water and landforms are anchored at themselves, so they bend over the lip point
by point. A new body that forgets its anchor shears apart on the lip.

A body's foot also stands **on the drawn land**, not at height 0: walkable ground runs
up a landform's lower slope (to `BLOCK_HEIGHT`), so a foot at 0 there is buried in the
facets, and the painted look's ground has hills. Lift it by `standingHeight(point, look)`,
which reads the facets `landformMesh` and `groundMesh` actually draw.

## Two looks, one skin

`?look=painted` (`look.ts`) is a second way to paint the same geometry; the default is
`flat`. A look is data, handed to every builder and to the shaders - never a branch on
a global.

| | `flat` | `painted` |
| --- | --- | --- |
| Light (`shading.w`) | smooth Lambert plus sky | `painted()` in both shaders: flat steps, each face picking its own colour of light from three a step - `PAINT.warm`, `PAINT.cool`, `PAINT.deep`, baked in by `paintConstants`; lines and mixes in `PAINT_STEPS` |
| Faces (`faceTint`) | ±4.5% brightness | ±10%, hue drifting to `PAINT.drift`; crowns take a rare `PAINT.accent` |
| Blobs (`blob`) | dented ball | stretched, leaned, drawn up to a point; some faces split |
| Foliage (`frond`) | a broadleaf's tiered plates | the same outline, tinted as crowns; some faces split |
| Split faces (`facet`) | never | three small faces round a middle pushed out (a bump) or in (a dent) |
| Ground height (`ground-relief.ts`) | level, a hair of wobble | hills to `hills` tiles; colour by warped patch, not by face |
| Ground faces (`ground-facets.ts`) | two triangles a tile | merged 2×2 and 4×4 planes, split tiles round a bump or a dent |

The ground steps on how much more or less than **level ground** a face is lit, so the
open field is always the middle step and only a hill's flanks cross a line; a body
steps on how squarely it faces the sun. Keep the ground's per-face nudge and wobble
small: a wobble steeper than the hills tips every tile across a step on its own.

**The hills are level wherever something lies flat**: a puddle's basin (water is
mirrored about height 0), a lake and its shore, and round a landform's foot (its mesh
starts at 0). A merged plane or a ground bump stands only where `freeToTilt` says no
water can stand and nothing has settled. `ground-relief.test.ts` holds the height
field to that.

**A merged plane opens no crack**: a lattice point on its edge is slid onto the edge
line (`groundVertex`), so the tiles beside it meet the plane exactly. Squares are
aligned to their own size, which divides `CHUNK_TILES`. `ground-facets.test.ts` holds
a chunk watertight (its faces' area from above is exactly the area inside its rim) and
`groundSurface` to the very face drawn.

**A see-through body is half of one.** The sheer pass is neither mirrored nor depth
written, and nothing culls back faces. So a slime's `Kind.liquid` skin puts only the
faces turned to the eye in it (`smoothBlob`'s `facing`, from `viewInPlanet`) - else its
back blends through its front in triangle order - and keeps an opaque part, its heart
and eyes, in the solid pass for the mirror and the depth test.

## Wind and pushes

Plants lean in the **vertex shader** (`sway.ts`): a shear about the vertex's anchor,
growing with its height, so a root never moves. Each swaying kind is a row of `SWAYERS` -
trees and bushes `foliage`, blades `grass`, mushrooms `sprig` - and the shaders' copy of
the table is generated from it, so a new plant is a kind and a row. The lean is the
shared wind (`gustAt` once a frame, its travelling sines in the shader, phases wrapped on
the CPU) plus up to `MAX_PUSHES` rings - the hero, his swing, bursts, fireballs, the
nearest slimes - read straight off the shared simulation by `pushesOf`
(`sway-pushes.ts`). No buffer is rebuilt and no pass added: the chunks stay static.

**Tried and rejected:** a per-vertex tremble and per-face normal flicker on crowns, to
make leaves ripple. It read as jelly, not leaves; do not bring it back as is.

**Grass blades are off for now.** Two looks were tried and both removed: evenly spread
three-blade tufts, then meadow patches of five-blade sheaves. `Kind.grass` and its
`SWAYERS` row stay, tested, so blades can come back as a mesh alone.

## Soft things are impostors

A ball is one camera-facing quad, the sphere worked out per pixel (`impostor.ts`): two
triangles, round at any size, lit from a true normal, its outline pushed in and out by
noise so it billows. Volcano smoke (`plume-balls.ts`, from the shared `volcanoes.ts`),
the clouds (`sky-puffs.ts`, from the shared `sky-clouds.ts` decks) and - with
`?leaves=impostor` - the crowns and bushes are drawn this way. Its vertex carries its
body's foot like a mesh vertex's anchor, and is placed by the world's own projection
(`PLACE_GLSL` / `PLACE_WGSL`), so a crown sways and rides the lip with its trunk. A cloud
puff is the exception: it is already in screen pixels and only sits behind everything
(`CLOUD_DEPTH`).

- **Balls write their own depth** - the front of the sphere at that pixel - after the
  sheer pass: a crown swallows its own trunk and two puffs cut into each other. An old
  puff of smoke wastes away (shrinks along its noise); nothing blends, so nothing sorts.
- **`?volume=1` marches smoke and clouds as volumes**: a noise density inside the ball,
  each sample lit by a short march toward the sun, premultiplied, far to near, depth
  tested but not written. Crowns never are. It is the expensive end of the menu - cheap
  at `?res=low`, not measured at window resolution yet.
- **A plume is low on purpose.** A mountain already stands taller than the 180-line
  frame from most of the field, so the smoke bends into a banner downwind rather than
  climbing out of the top; it shows past ~70 rows, where the vent comes on screen.

## Water

- **Where it stands** is the shared puddle field (`src/game/water/puddle-field.ts`):
  basins baked once into bytes, a level that falls as `stepWetness` soaks the ground.
  Both shaders read those bytes as a texture exactly as `sampleField` does, so
  `WetWorld.isWet` and the drawn shore agree. Never decide in a shader where water is.
- **A lake is a puddle, not a mesh.** `water-texels.ts` writes each lake's lobed shore
  into the texture's second channel as a signed distance, and the ground shader draws
  it with the puddles (`waterAt`). A flat sheet of its own cannot follow the lip: its
  long edges stay straight while the ground under them bends over the horizon.
- **What it shows** is the world drawn mirrored, height negated, into a half-size target.
  In a parallel projection that is the exact planar reflection. The mirror draws no
  ground, so it must also skip what the ground would hide: nothing past the horizon line.
- **How it is shaded** is `WATER_LOOK` (`water-glsl.ts`), one set of numbers for both
  backends: the water's own body (the bed, going to `LOWPOLY.waterDeep` as it deepens)
  with at most half the sky over it, and a wave shown by its *tilt*, never by its
  height. A near-total mirror, or a crest brightened for how high it stands, reads as
  molten metal (`water-look.test.ts`).
- **How it moves**, WebGL2: procedural rings as slope (`water-glsl.ts`) - rain cells
  pinned to the planet, and `MAX_RIPPLES` footstep and landing rings from `WetWorld`.
- **How it moves**, WebGPU: the wave equation on a 512² planet-fixed toroidal grid round
  the hero (`webgpu/waves.ts`) - 16 cells a tile, so ±16 tiles: the whole flat field.
  Do not trade cells per tile for reach: a ring is a few cells wide at least, and at 8
  a tile a footstep's wake was fat bulges that read as molten metal. Stepped at a fixed 120 Hz in compute; raindrops are
  seeded dimples, footsteps and landings impulses, dry ground holds the surface at zero
  so rings bounce off the shore. A surface pass (`webgpu/wave-surface.ts`) writes height
  and slope to a filterable texture the water samples once.

## What a frame costs, and where it goes

Measured on an Intel Gen 9 (the HD 530 class), 1280×720, rain, 4× MSAA. WebGL2 by
`EXT_disjoint_timer_query_webgl2`; WebGPU as 40 frames back to back over one queue drain
(CPU and GPU together). **`gl.finish()` does not wait in Chrome**: timing a frame with it
reports ~1 ms however heavy the frame is. Use the timer query.

| | WebGL2 | WebGPU |
| --- | --- | --- |
| a frame | ~11.5–13 ms GPU | ~7.8 ms |
| of which the water's motion | procedural rings, the costliest single part | simulation < 1 ms |

The frame's cost is **fill**: each screen-covering layer (sky, ground, the rain overlay)
is 1–2 ms here whatever it shades; the water's shading is ~0.4 ms. So the rules that
hold it down are about layers and pixels, not arithmetic:

- **No `discard` in the solids' shader.** A shader that can discard turns off the early
  depth test for every draw it makes. On-screen solids use `WORLD_FRAGMENT_SOLID` /
  `worldWgsl(false)`; only the ground, the mirror and the sheer pass may discard - and
  the landforms (`Kind.land`, their own draw list), on a frame where `cutaway.ts` opens
  the pixel skin's window round the hero because nearer land stands over him.
- **The ground draws first, alone, and only where it can show** (`groundInView`); the
  mirror draws only what is within `MIRROR_ROWS` of the field.
- **A pixel budget** (`backingSize`, `MAX_DRAWN_PIXELS`): a high-DPI window would
  otherwise multiply every layer - 4K at 2× is nine times the frame above.

Measured and *not* worth it, so do not re-try them for speed: limiting the sky to the
band above the field, a cheaper procedural ring lattice, and the wave surface texture
(kept for its simpler wiring). A change that claims a saving shows the before and after.

## Where things come from

| Want | Read it from | Never |
| --- | --- | --- |
| where anything is | the shared simulation: `terrain.ts`, `lakes.ts`, `landforms.ts`, `scenery-features.ts`, `encounter-sim.ts`, `volcanoes.ts`, `sky-clouds.ts` | a placement decided in this skin |
| the hero's pose | `HERO_EQUIPPED`, `layeredPose`, `tracksOf` - the same rig and clips | a model of his own |
| the hero's look | `hero-dress.ts`: an undead skeleton and a stick, pieces on the rig's own bones (the stick on `sword`); `hero-sway.ts` sums a loose-spine term onto the shared pose | a bone or a clip of the skin's own |
| a colour | `palette.ts`, the skin's own small set | a hex inline in a mesh |
| the light | `atmosphere.ts`'s screen-space direction, via `lightDirection` | a light fixed to the planet |

## The API, in one table

Export-checked by `src/skins/lowpoly/skin-rule.test.ts`.

| Module | Symbols |
| --- | --- |
| `backend.ts` | `backendOrder` · `parseGpu` · `parseMsaa` · `ImpostorScene` · `VertexLayout` |
| `look-options.ts` | `readLookOptions` · `parseResolution` · `parseLeaves` · `parseVolume` · `lowResCanvas` |
| `impostor.ts` | `ImpostorBuilder` · `IMPOSTOR_BYTES` · `BALL_VERTICES` · `QUAD_REACH` · `SCREEN_RISE` · `SCREEN_UP` |
| `impostor-glsl.ts` | `IMPOSTOR_VERTEX` · `IMPOSTOR_FRAGMENT` · `CLOUD_DEPTH` |
| `impostor-pass.ts` | `ImpostorProgram` |
| `sky-puffs.ts` | `skyPuffs` · `cloudShadeOf` |
| `plume-balls.ts` | `plumeBalls` |
| `webgpu/wgsl-impostor.ts` | `IMPOSTOR_WGSL` |
| `placement.ts` | `lowpolyView` · `placeVertex` · `backingSize` · `fieldRows` · `LOGICAL_HEIGHT` · `TOWARD_VIEWER` |
| `shaders.ts` | `PLACE_GLSL` · `WORLD_VERTEX` · `WORLD_FRAGMENT` · `WORLD_FRAGMENT_SOLID` · `paintConstants` |
| `mesh.ts` | `MeshBuilder` · `Kind` · `VERTEX_BYTES` · `rgb` · `mixRgb` |
| `primitives.ts` | `frustum` · `cone` · `blob` · `smoothBlob` · `frond` · `frondFaces` · `facet` · `disc` · `BlobShape` |
| `palette.ts` | `LOWPOLY` · `PAINT` · `PAINT_STEPS` · `faceTint` · `hash01` · `seedOf` |
| `look.ts` | `Look` · `FLAT_LOOK` · `PAINTED_LOOK` · `parseLook` |
| `scenery-mesh.ts` | `sceneryMesh` · `shadowUnder` · `MESHED_SPECIES` · `SceneryLay` · `GroundUnder` |
| `broadleaf-mesh.ts` | `broadleafMesh` · `Canopy` |
| `terrain-mesh.ts` | `groundMesh` · `landformMesh` · `standingHeight` |
| `ground-relief.ts` | `latticeVertex` · `calmAt` · `freeToTilt` · `SHORE` |
| `ground-facets.ts` | `groundVertex` · `groundCell` · `groundSurface` · `GroundCell` |
| `sway.ts` | `swayOffset` · `SWAYERS` · `windUniform` · `SWAY_GLSL` · `SWAY_WGSL` · `MAX_PUSHES` |
| `sway-pushes.ts` | `pushesOf` |
| `world-chunks.ts` | `buildChunk` · `chunkOffset` · `groundInView` · `MIRROR_ROWS` · `CHUNK_TILES` |
| `cutaway.ts` | `heroCutaway` · `heroHidden` |
| `wet-world.ts` | `WetWorld` · `shaderSeconds` |
| `water-glsl.ts` | `WATER_GLSL` · `MAX_RIPPLES` · `RIPPLE_LIFE_S` |
| `ripples.ts` | `RippleRing` |
| `sky-light.ts` | `lightDirection` · `stillSky` |
| `renderer.ts` | `WebGlBackend` |
| `reflection.ts` | `ReflectionTarget` · `REFLECTION_SCALE` |
| `rain-pass.ts` | `RainPass` |
| `hero-mesh.ts` | `heroMesh` · `heroHeightPx` · `swingTrailMesh` |
| `hero-dress.ts` | `SKELETON_DRESS` · `STICK_DRESS` · `SKULL` · `SKULL_HOLES` · `DressPiece` |
| `hero-sway.ts` | `looseSkeleton` · `freeOf` · `SwayTracks` |
| `actor-mesh.ts` | `fireballMesh` · `burstMesh` |
| `slime-mesh.ts` | `slimeMesh` · `slimeBody` · `skinPoint` · `slimeGaze` · `viewInPlanet` |
| `actor-frame.ts` | `ActorMeshes` · `ACTOR_MESH_KEYS` |
| `webgpu/webgpu-renderer.ts` | `WebGpuBackend` |
| `webgpu/waves.ts` | `stepWaveGrid` · `windowCell` · `cellRecycled` · `WAVE_N` · `WAVE_RES` |
| `webgpu/wave-sim.ts` | `WaveSim` · `stepsFor` · `freshImpulses` |
| `webgpu/wave-surface.ts` | `WaveSurface` |
| `webgpu/uniform-pack.ts` | `packFrame` · `packDraws` · `drawCount` |
| `webgpu/pipelines.ts` | `createPipelines` · `DEFAULT_SAMPLES` |

A new species is one entry in `scenery-mesh.ts`'s table; `world.test.ts` fails if the
planet places a species this skin has no body for. A broadleaf is a `Canopy` - trunk,
limbs, twigs and tiered `frond` clumps as proportions of its height - handed to
`broadleafMesh`, not a new function. Every chunk is drawn every frame, so a tree is held
to a triangle budget (`broadleaf-mesh.test.ts`); the wood is about half the planet's
solid triangles.
