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
