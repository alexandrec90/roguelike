---
name: art-check
description: Verify an art or animation change by capturing it in the asset lab at 1x and enlarged, on dark and light ground, and judging the picture rather than the tests. Use after adding or changing any sprite, rig clip, gear part, shading pass, transform or effect.
---

> Depends on a local dev server and a browser-driving runner. Without one, still add the
> registry entry and say in the report that the capture is outstanding — never claim art
> was verified because its tests passed.

# Art check

Green tests prove the source is valid. They do not prove the picture is right, and in a
pipeline where every frame is derived, a wrong ramp or an off-by-one anchor produces a
perfectly valid sprite that reads as mush. **The lab is where art is accepted.**

## 1. Put it in the registry

The lab has no scene to edit. Add an `AssetEntry` to `src/game/asset-registry.ts` with at
least one palette variant beyond `authored`; `validateRegistry` fails the build if the
variant targets a token the frames do not use. A rig clip becomes frames via
`sampleClipFrames`, and a transform or shading pass rides in on its `mapCloud` option —
so an animation, a light pass and a hand-drawn prop all reach the lab the same way.

## 2. Serve it

From **this worktree**, never by switching branches under a running server:

```
npm run dev
```

Each worktree carries its own port lease, so several branches can be up at once and
compared by switching tabs. Note the port the server prints; the lab is at
`/lab.html` on it.

## 3. Drive it

Everything the lab shows is in the URL, so a capture can be reopened exactly:

```
/lab.html?asset=<id>&variant=authored&frame=0&t=0&play=0&zoom=6&bg=duo
```

| Key | Set it to |
| --- | --- |
| `asset` | the registry id — `window.assetLab.assets()` lists them |
| `variant` | `authored` first, then every swap the entry declares |
| `play` | **`0` for every capture** — a playing animation cannot be compared |
| `frame` / `t` | the frame index, and elapsed ms for an effect |
| `zoom` | `1` for the honest read, then `6`–`8` to inspect pixels |
| `bg` | `duo` (dark and light at once), `contrast`, or `checker` for alpha |
| `grid` / `bounds` / `tile` | frame grid, drawn bounds, 3×3 seam preview |

In the page, `window.assetLab` is the handle: `state()`, `apply(patch)`, `seek(ms)`,
`assets()`, and `snapshot()` returning a PNG data URL. `apply` and `seek` return the
state they *settled on*, so a zoom that did not fit or a `tile` flag on a non-tile is
visible rather than silently assumed — read the return value, do not assume the patch.
With `play=0`, `seek(ms)` is byte-identical on every run.

`snapshot()` draws the frame before it reads the canvas (`src/lab/lab-capture.ts`), so
`apply({frame: i})` followed by `snapshot()` captures frame `i` even in a hidden tab.
It is synchronous, so there is nothing to await, and it needs no wait for
`requestAnimationFrame`: a call that waits for one in a hidden tab never returns.

### Keep each browser call short

A claude-in-chrome `javascript_exec` that runs for several seconds on a hidden tab has
had the page **reloaded under it**: `performance.getEntriesByType('navigation')[0].type`
read `"reload"`, with no Vite reload logged. When work takes more than about a second,
such as many captures or hundreds of game steps, split it up. One call starts the work
in the page and returns at once. Separate short calls then read the result:

```js
// Call 1: start the work in the page, and return immediately.
window.__job = { done: false, out: [] };
const port = new MessageChannel();
let i = 0;
port.port1.onmessage = () => {
  window.assetLab.apply({ frame: i });
  window.__job.out.push(window.assetLab.snapshot());
  if (++i < 16) port.port2.postMessage(0); else window.__job.done = true;
};
port.port2.postMessage(0);
// Calls 2..n: `window.__job.done`, then read `window.__job.out`.
```

`MessageChannel` rather than `setTimeout` or rAF: a hidden tab throttles timers to
about one a second and does not run rAF at all.

### Checking the game itself, where none of the above applies

The lab draws on demand, which is why it works from an extension-driven tab. The
game runs on a loop, and that tab is usually hidden (`document.visibilityState` reads
`hidden`): Chrome freezes `requestAnimationFrame`, and the game's loop with it, so the
scene stops between tool calls. A held synthetic keydown then moves the hero about one
cell per screenshot, and a `Runtime.evaluate` that awaits rAF times out outright — the
capture shows a game that is not running, which reads as a movement bug.

**Step the loop by hand rather than waiting for it.** Hiding the tab pauses only the
animation-frame loop: `game.step(time, delta)` still updates the scene and renders. In
the dev build `window.__game` is the engine's `Game` (`src/main.ts`, `src/engine/game.ts`),
and `snapshot()` draws the current frame and returns it as a PNG data URL in the same
call:

```js
const g = window.__game, dt = 1000 / 60;
let t = performance.now();
for (let i = 0; i < 30; i++) g.step((t += dt), dt);
const png = g.snapshot(); // a PNG data URL of frame 30
```

Thirty steps fit in one short call. Hundreds do not: run those in a `MessageChannel`
loop, as shown above, a few dozen steps per message. For an input check, dispatch the
keydown first, then step: the controls take the key when it is dispatched and the hero
reads them inside the step. A fixed `dt` makes the same steps give the same frames, so
two runs can be compared the way `seek(t)` is compared in the lab. What a frame *looks
like* is still the lab's question; this is for what the game *does* with it.

## 4. Judge it

Capture at `zoom=1` and at `zoom=6`, both on `bg=duo`, and answer these. Anything
answered "no" is a change to make, not a caveat to report:

- **Does the silhouette read at 1×?** This is the only question that matters at a
  distance. If it needs the 6× capture to make sense, it is over-detailed.
- **Does it survive the light ground?** A shape that vanishes on bone is not finished.
  This is why `bg=duo` and not a single background.
- **Do the identity marks survive?** After a shading pass especially: the blade, the
  eyes, the hat are what say *which* character this is. If a light pass ate them, they
  belong in `only`'s hold-out list.
- **Is the shading banding or swimming?** Bayer dither is nailed to the pixel grid; if
  the texture crawls between frames, something is shading in screen space instead of
  cloud space.
- **Do the frames belong to one motion?** Step the filmstrip. Anticipation, contact,
  overshoot, settle — a frame that does not sit on that arc is usually a keyframe with
  the wrong `t`, not a drawing problem.
- **Tiles: does it seam?** `tile=1` and look at the joins, and at whether the noise
  reads as ground rather than as wallpaper.
- **Effects: does it reproduce?** `seek(t)` twice at the same `t` and compare the two
  snapshots. Different pixels mean an unseeded random draw got in.

## 5. Report it

Put the exact lab URL in the PR body, and attach the 1× and enlarged captures. A
reviewer must be able to reopen the same pixels, not a description of them.

---

**Not evaluated headlessly, deliberately.** This skill's whole subject is a live
browser's rendered pixels, so there is no ablation a text harness could score. The
verifiable half of the art rules is covered by `src/game/art-pipeline-rule.test.ts`
instead.
