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

| Area | Contract |
| --- | --- |
| Render target | Render the world at 320×180, then nearest-neighbor upscale the whole canvas by an integer factor and letterbox the remainder. |
| Setting | **Outdoors.** The game is an overworld — fields, paths, rock, sky — not a dungeon interior. |
| Camera | A **pitched-back overhead** view, not a 45°-yaw diamond isometric: rows and columns stay axis-aligned and only the vertical axis is foreshortened. A 16×16 world square lands on 16×12 of screen, and height rises straight up the screen by `WALL_RISE`, which is what makes walls stand. `src/game/projection.ts` owns that math; nothing else re-derives it. |
| Grid | 16×16 world tiles. Author ground art **already foreshortened** — 16×`TILE_DEPTH` for anything lying on the ground, 16×`WALL_RISE` for anything standing up — so every tile blits 1:1 and nothing is scaled at draw time. Snap rendered objects and the camera to logical integer pixels. Do not use antialiasing, arbitrary sprite rotation, or continuously fractional sprite transforms. |
| Flatness | Below the horizon band the ground is **affine, not perspective**: every world row is exactly `TILE_DEPTH` scanlines tall, with no convergence and no per-row scaling. A tile's screen size never depends on how far up the screen it is. |
| Horizon | The top of the screen **rolls over the horizon** — sky, then a short band where the ground curves away and a dozen world rows compress into a few scanlines, then the flat field. `src/game/horizon.ts` owns it, and one knob sets the split. |
| Identity art | Characters, monsters, items, and tiles are authored palette-indexed raster sprites. Keep their source text-defined and diffable; generated PNG atlases are build output. SVG is not a primary game-art format. |
| Procedural art | Use math for motion, light, particles, and other effects—not for complete character silhouettes. Image-generated art may guide mood and composition but must be redrawn and validated on the game grid before becoming production art. |
| Animation | Combine a small number of authored silhouette-changing frames with discrete, grid-quantized translation and squash/stretch. Express actions as anticipation, fast contact, hit stop, overshoot, and settle; drive visual beats from gameplay events. |
| Effects | Build particles from 1–4 logical-pixel primitives or tiny raster sprites. Pool them, cap their count, and use seeded randomness when reproducibility matters. |
| Separation | Keep turn simulation deterministic and independent of the real-time presentation layer. Rendering may exaggerate an event but must not determine its outcome. |

### The camera, and the band at the top of it

Four modules, and no fifth place where any of this is decided:

| Module | Owns |
| --- | --- |
| `src/game/projection.ts` | `TILE_WIDTH` 16, `TILE_DEPTH` 12, `WALL_RISE` 16, and `project()` / `cellOrigin()` / `wallCapY()` / `wallFaceY()` / `depthOf()`. Draw order is `row * TILE_WIDTH + rank` — painter's algorithm down the screen. |
| `src/game/horizon.ts` | `horizonLayout(height, skyFraction)` → `skyHeight`, `rollHeight`, `horizonY`, `groundTop`, `groundHeight`. Also the sky ramp, the roll's easing, and `ridgeProfile()` for distant silhouettes. |
| `src/game/tiles.ts` | The terrain art, in one shared palette with per-material tokens, so a whole field can be spliced into a single texture by `composeTiles`. |
| `src/game/field.ts` | The sample scene's map, as text. `demo-scene.ts` reads all four and only draws. |

**The 95/5 split is a knob, not a constant to inline.** `DEFAULT_SKY_FRACTION` in
`horizon.ts` is the default; `?horizon=8%` (or `?horizon=0.08`) overrides it per load;
the on-screen caption prints the resulting pixel counts so it can be judged by eye. Read
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
art looks correct.

#### The asset lab

`lab.html` (`npm run dev`, then `/lab.html`) is that scene. It renders on its own
320×180 canvas under the same integer-scale contract as the game, and shows the selected
art on two grounds at once — dark beside light — because a sprite that reads on charcoal
and disappears on bone is a fault you only see with both on screen at the same moment.

Everything it shows is in the URL, so a capture can be reopened exactly:

| Key | Meaning |
| --- | --- |
| `asset` | registry id — `hero`, `slime`, `torch`, `grass`, `dirt-path`, `wall-top`, `wall-face`, `far-pine`, `far-tower`, `sparks` |
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

## Guardrails

Baseline guardrails — including the instruction-file feedback loop (**never silently
work around a bad instruction**) — are in `.claude/rules/engineering.md`. Rules for
writing skills and rules themselves are in `.claude/rules/authoring.md`. Cross-reference
this project's own scoped rules here, one line each.
