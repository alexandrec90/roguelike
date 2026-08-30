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
| Grid | Use 16×16 world tiles. Snap rendered objects and the camera to logical integer pixels. Do not use antialiasing, arbitrary sprite rotation, or continuously fractional sprite transforms. |
| Identity art | Characters, monsters, items, and tiles are authored palette-indexed raster sprites. Keep their source text-defined and diffable; generated PNG atlases are build output. SVG is not a primary game-art format. |
| Procedural art | Use math for motion, light, particles, and other effects—not for complete character silhouettes. Image-generated art may guide mood and composition but must be redrawn and validated on the game grid before becoming production art. |
| Animation | Combine a small number of authored silhouette-changing frames with discrete, grid-quantized translation and squash/stretch. Express actions as anticipation, fast contact, hit stop, overshoot, and settle; drive visual beats from gameplay events. |
| Effects | Build particles from 1–4 logical-pixel primitives or tiny raster sprites. Pool them, cap their count, and use seeded randomness when reproducibility matters. |
| Separation | Keep turn simulation deterministic and independent of the real-time presentation layer. Rendering may exaggerate an event but must not determine its outcome. |

### Visual verification

Every asset or animation change is inspected in the running browser at logical 1× and
an enlarged integer scale. Maintain an asset-lab scene that can show every frame,
animation, palette swap, and effect on light and dark backgrounds. The agent captures
and compares rendered output; a valid source file and green unit tests do not prove the
art looks correct.

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
