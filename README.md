# Roguelike

2D, pixel-art, turn-based roguelike RPG. The current proof of concept is a small
animated dungeon scene built with Phaser: a bouncy adventurer, an idle slime, and a
flickering torch with pooled sparks.

Generated from [devkit](https://github.com/alexandrec90/devkit)'s project
template. The agent harness in `scripts/hooks/` is vendored from there — see
`CLAUDE.md`, "Vendored agent harness".

## Scene preview

```powershell
npm ci
npm run dev
```

Open the local URL Vite prints. Development files are served directly with hot module
replacement; `npm run check` runs the sprite-source tests, TypeScript compiler, and
production build.

The game renders at 320×180 and scales with nearest-neighbor filtering. Sprite source
lives as palette-indexed text in `src/game/sprites.ts`, so agents can edit meaningful
Git diffs instead of opaque PNG binaries. `src/game/pixel-art.ts` validates and
rasterizes those sources at runtime. Animation combines authored slime and flame frames
with grid-quantized motion and a fixed spark pool.

## Repository tooling

```powershell
Copy-Item .env.example .env
uv sync --all-extras
uv run pytest
```

The Python environment supports the vendored agent harness; it is not part of the game
runtime. In VS Code, the shared workspace task quick-pick lists repository actions and
the worktree they target.


## Layout

```text
src/                       Phaser scene, text sprite sources, and Vitest tests
roguelike/                 Python tooling package
tests/                     Python tooling tests
scripts/                   project scripts (Python, each with tests)
scripts/hooks/             vendored agent harness — edit upstream in devkit
.devkit.toml               per-project harness seam (not vendored)
```

## CI

`.github/workflows/pr-gate.yml` runs lint, tests, and the harness drift check on
every PR. The drift check is only meaningful when it can see devkit — if it prints
"nothing to do (skipping)", the gate is inert and the wiring needs fixing. Locally,
where `DEVKIT_DIR` is usually unset, `pre-commit run devkit-drift --all-files` is the
same check against the devkit rev pinned in `.pre-commit-config.yaml`.

`.github/dependabot.yml` opens weekly dependency PRs, and
`.github/workflows/dependabot-automerge.yml` merges them once the gate passes —
patch/minor bumps of anything, plus majors confined to dev tooling. A major that
touches a runtime dependency is labelled `needs-manual-merge` and waits for you.

That auto-merge workflow is **vendored** from devkit, so `sync-devkit.py --check`
compares it byte-for-byte and editing it here shows up as drift. Keep the gate's title
`PR Gate`: the auto-merge workflow waits on it by name, and a rename makes the merge job
inert without turning anything red.

`.github/actions/setup-python-env/` is **yours**, by contrast. devkit shipped it through
that same channel for one release and pulled it back out when two projects turned out to
install in ways `uv sync` cannot express, so it now arrives from `templates/` as a
one-shot copy: nothing compares it, and rewriting its steps to match how this project
installs is the supported move rather than drift. What owning it costs is the other
direction — later devkit fixes to that file never reach here.
