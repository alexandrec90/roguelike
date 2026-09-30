# Full-colour procedural overhaul — visual verification

Captured from this worktree's dev server (port 4115) at 1280×720, a 4× integer scale
of the 320×180 target, on the Intel HD 530 dev machine.

| Capture | URL | What to look at |
| --- | --- | --- |
| [Noon](1-noon.png) | `/?time=13&weather=clear` | meadow tiles and tufts, baked trees/bushes/boulders/mushrooms with outlines, puddles mirroring the sky, the campfire, slimes |
| [Golden hour](2-golden-hour.png) | `/?time=18.2&weather=clear` | the warm multiply, long shadows, the sky and haze at sunset |
| [Night, burning blade](3-night-flaming-blade.png) | `/?time=22&weather=clear`, press F | moonlit ambient, the campfire's light pool and halo, the fire slime's glow, the enchanted blade |
| [Storm](4-storm.png) | `/?time=16&weather=storm` | three rain sheets, overcast light, horizon mist |
| [Wildfire](5-wildfire-fireball.png) | `/?time=20`, F, Space, Q | grass fire spreading from the blade and a fireball blast, scars, firelight |

## Controls

Press **H** (or **?** / **F1**) in the game for the reminder — [capture](6-controls-reminder.png).
It is generated from `DEFAULT_KEYBINDINGS` in `src/game/keybindings.ts`, the one file to
edit to rebind anything.

WASD / arrows move · Space or left mouse swings · **F** lights the blade · **Q** or right
mouse throws a fireball · **E** calls a frost nova (it also puts grass fires out).

## Knobs

`?time=21` or `?time=18:30` pins the clock; `?day=300` sets a day's length in seconds
(default 20 minutes, starting 15:30); `?weather=clear|rain|storm` pins the sky (default:
a fair opening, then a schedule of cloud, drizzle, rain and storms).

## Frame cost (JS per frame, median / p95)

| | Before | After, idle | After, storm + wildfire + slimes |
| --- | --- | --- | --- |
| Scene update + render | ~13.5 / 16.6 ms | ~4 / 7 ms | ~5.5 / 11 ms |
| Frame interval | 31 ms (half rate) | 18.1 ms — the machine's refresh | 18.1 ms |

The machine's own `requestAnimationFrame` interval on a blank page is 18.1 ms, so the
game now runs at the full refresh rate. The remaining spikes are on the frame a step
lands (ground re-composition, puddle re-bake, new scenery bakes).
