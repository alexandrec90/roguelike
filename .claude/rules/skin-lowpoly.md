---
description: The low-poly 3D skin - how its geometry, projection and shading work, what it must keep identical to the pixel skin, and its budget
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

## The projection is written twice

`placement.ts` is the CPU reference; the vertex shader in `shaders.ts` is the same code
in GLSL. **Change one, change both.** `placement.test.ts` pins `placeVertex` to the pixel
skin's `localPlacement`, so a drift from the pixel skin fails a test; a drift between the
TypeScript and the GLSL only shows on screen.

Depth is **rows ahead**, not distance from an eye: along any screen ray of this
projection the point further ahead is further away, so it is an exact z-buffer key on
the field and the painter's rule the pixel skin sorts by. Things lying on the ground take
a small bias behind what stands on the same row.

## A vertex knows its body's foot

Each vertex carries an `anchor` (`mesh.ts`). A body - a tree, a slime, the hero - is
placed and shrunk about its foot on the lip, as a sprite is in the pixel skin. The
ground, water and landforms are anchored at themselves, so they bend over the lip point
by point. A new body that forgets its anchor shears apart on the lip.

## Water: a mirror, not a ray

Standing water is shaded per pixel (`water-glsl.ts`), from three things:

- **Where it stands** is the shared puddle field (`src/game/water/puddle-field.ts`):
  basins baked once into bytes, a level that falls as `stepWetness` soaks the ground.
  The shader reads those bytes as a texture exactly as `sampleField` does, so the
  simulation's "is this foot wet" (`WetWorld.isWet`) and the drawn shore agree. Never
  decide in the shader where water is.
- **What it shows** is the world drawn mirrored, height negated (`u_mirror`), into a
  half-size target (`reflection.ts`). In a parallel projection that is the exact planar
  reflection. The mirror pass draws no ground, so it must also skip whatever the ground
  would have hidden: past the horizon line nothing is drawn into it.
- **How it moves** is rings as surface slope: rain cells pinned to the planet, plus
  `MAX_RIPPLES` footstep and landing rings from `WetWorld` (`stepWake`).

Rain itself is one full-screen pass of hashed streaks (`rain-pass.ts`), nothing on the CPU.

## Where things come from

| Want | Read it from | Never |
| --- | --- | --- |
| where anything is | the shared simulation: `terrain.ts`, `lakes.ts`, `landforms.ts`, `scenery-features.ts`, `encounter-sim.ts` | a placement decided in this skin |
| the hero's pose | `HERO_EQUIPPED`, `layeredPose`, `tracksOf` - the same rig and clips | a model of his own |
| a colour | `palette.ts`, the skin's own small set | a hex inline in a mesh |
| the light | `atmosphere.ts`'s screen-space direction, via `lightDirection` | a light fixed to the planet |

## The budget

All 64 chunks of the planet are built once, nearest first, before the first frame, and
drawn every frame as static buffers - twice, once mirrored at a quarter of the pixels:
~280 draw calls. The actors are rebuilt per frame, a few hundred triangles. Measured in
the running page at 1280×720 in rain: ~1.3 ms a frame with the GPU drained, simulation
~0.1 of it. Water's per-pixel cost is paid only where there is water. A change that adds
per-frame work names its cost.

## The API, in one table

Export-checked by `src/skins/lowpoly/skin-rule.test.ts`.

| Module | Symbols |
| --- | --- |
| `placement.ts` | `lowpolyView` · `placeVertex` · `LOGICAL_HEIGHT` |
| `mesh.ts` | `MeshBuilder` · `Kind` · `VERTEX_BYTES` · `rgb` · `mixRgb` |
| `primitives.ts` | `frustum` · `cone` · `blob` · `disc` |
| `palette.ts` | `LOWPOLY` · `faceTint` · `hash01` · `seedOf` |
| `scenery-mesh.ts` | `sceneryMesh` · `shadowUnder` · `MESHED_SPECIES` |
| `terrain-mesh.ts` | `groundMesh` · `lakeMesh` · `landformMesh` |
| `wet-world.ts` | `WetWorld` · `shaderSeconds` |
| `water-glsl.ts` | `WATER_GLSL` · `MAX_RIPPLES` · `RIPPLE_LIFE_S` |
| `ripples.ts` | `RippleRing` |
| `reflection.ts` | `ReflectionTarget` · `REFLECTION_SCALE` |
| `rain-pass.ts` | `RainPass` |
| `world-chunks.ts` | `buildChunk` · `chunkOffset` · `CHUNK_TILES` |
| `hero-mesh.ts` | `heroMesh` · `heroHeightPx` |
| `actor-mesh.ts` | `slimeMesh` · `fireballMesh` · `burstMesh` |
| `actor-frame.ts` | `ActorMeshes` · `ACTOR_MESH_KEYS` |
| `renderer.ts` | `LowpolyRenderer` · `lightDirection` |

A new species is one entry in `scenery-mesh.ts`'s table; `world.test.ts` fails if the
planet places a species this skin has no body for.
