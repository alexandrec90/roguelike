---
description: The low-poly 3D skin - its two backends (WebGPU, WebGL2), projection, water and wave simulation, what it must keep identical to the pixel skin, and its measured budget
paths:
  - src/skins/lowpoly/**/*.ts
---

# Rule: The low-poly skin

A skin is how the game looks and nothing else (`src/skins/skin.ts`). This one draws the
same planet, hero and fight as flat-shaded 3D geometry at the window's own resolution.
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
multisampling off. The geometry, projection and shading are the same in both; only the
water's motion differs, because only WebGPU has compute.

## Every shader is written twice or three times

| Description | CPU reference | GLSL (WebGL2) | WGSL (WebGPU) |
| --- | --- | --- | --- |
| the projection | `placement.ts` | `shaders.ts` | `webgpu/wgsl-world.ts` |
| the wave step | `webgpu/waves.ts` | - | `webgpu/wave-sim.ts` |
| the sway | `sway.ts` `swayOffset` | `sway.ts` `SWAY_GLSL` | `sway.ts` `SWAY_WGSL` |

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
facets. Lift it by `standingHeight`, which reads the facets `landformMesh` draws.

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
- **How it moves**, WebGL2: procedural rings as slope (`water-glsl.ts`) - rain cells
  pinned to the planet, and `MAX_RIPPLES` footstep and landing rings from `WetWorld`.
- **How it moves**, WebGPU: the wave equation on a 512² planet-fixed toroidal grid round
  the hero (`webgpu/waves.ts`), stepped at a fixed 120 Hz in compute; raindrops are
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
| where anything is | the shared simulation: `terrain.ts`, `lakes.ts`, `landforms.ts`, `scenery-features.ts`, `encounter-sim.ts` | a placement decided in this skin |
| the hero's pose | `HERO_EQUIPPED`, `layeredPose`, `tracksOf` - the same rig and clips | a model of his own |
| the hero's look | `hero-dress.ts`: an undead skeleton and a stick, pieces on the rig's own bones (the stick on `sword`); `hero-sway.ts` sums a loose-spine term onto the shared pose | a bone or a clip of the skin's own |
| a colour | `palette.ts`, the skin's own small set | a hex inline in a mesh |
| the light | `atmosphere.ts`'s screen-space direction, via `lightDirection` | a light fixed to the planet |

## The API, in one table

Export-checked by `src/skins/lowpoly/skin-rule.test.ts`.

| Module | Symbols |
| --- | --- |
| `backend.ts` | `backendOrder` · `parseGpu` · `parseMsaa` |
| `placement.ts` | `lowpolyView` · `placeVertex` · `backingSize` · `fieldRows` · `LOGICAL_HEIGHT` |
| `mesh.ts` | `MeshBuilder` · `Kind` · `VERTEX_BYTES` · `rgb` · `mixRgb` |
| `primitives.ts` | `frustum` · `cone` · `blob` · `frond` · `frondFaces` · `disc` |
| `palette.ts` | `LOWPOLY` · `faceTint` · `hash01` · `seedOf` |
| `scenery-mesh.ts` | `sceneryMesh` · `shadowUnder` · `MESHED_SPECIES` |
| `broadleaf-mesh.ts` | `broadleafMesh` · `Canopy` |
| `terrain-mesh.ts` | `groundMesh` · `landformMesh` · `standingHeight` |
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
| `hero-mesh.ts` | `heroMesh` · `heroHeightPx` |
| `hero-dress.ts` | `SKELETON_DRESS` · `STICK_DRESS` · `SKULL` · `SKULL_HOLES` · `DressPiece` |
| `hero-sway.ts` | `looseSkeleton` · `freeOf` · `SwayTracks` |
| `actor-mesh.ts` | `slimeMesh` · `fireballMesh` · `burstMesh` |
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
