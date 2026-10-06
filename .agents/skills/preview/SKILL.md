---
name: preview
description: Start this worktree's Vite dev server and give the user its URL as clickable links - the game in each skin, the asset lab and the tree lab. Use when the user asks to see, try, play or preview a change, or after a visible change they will want to look at themselves.
disable-model-invocation: false
---

> Depends on `node_modules` in this checkout and a free local port. The URL is
> `127.0.0.1`: it opens on the machine running the session, not on a phone or a
> browser following the session remotely - say so when that is how the user is watching.

# Preview

The user looks at the game in their own browser, so the job is a URL that is **this
worktree's** server and nobody else's. Port 4100 is the main checkout's; a worktree's is
4100 plus an offset derived from its directory name (`src/worktreePort.ts`). Never
predict the port, and never hand over a URL you did not see the server print: a habitual
port answers with *another branch's game*, and nothing on the page says so.

## 1. Reuse a server you already started

If this session already started `npm run dev` in the background and that task is still
running, its log holds the URL. Skip to step 3. Do not start a second one.

## 2. Start it

From the worktree root, as a **background** Bash task (it never exits on its own),
with its output going to a file in the scratchpad:

```bash
npm run dev > "<scratchpad>/dev.log" 2>&1
```

Then read the log until it has the `Local:` line, `http://127.0.0.1:<port>/`. If
`node_modules` is missing, run `npm ci` first. That is fixing the environment, so it is
in scope.

If the log says the port is in use instead, `strictPort` has refused to start. That
server could be this checkout's from another session, or another checkout's. You cannot
tell them apart from the page, so do not reuse it. Start again on a pinned port:

```bash
VITE_PORT=<printed port + 50> npm run dev > "<scratchpad>/dev.log" 2>&1
```

## 3. Give the user the links

Build every link from the printed origin. Write them as Markdown links in the reply,
because a bare URL in prose is easy to miss. Give only the rows that suit the change:

| Page | Path |
| --- | --- |
| The game, low-poly skin (default) | `/` |
| The game, pixel skin | `/?skin=pixel` |
| The asset lab | `/lab.html` |
| The tree lab | `/trees.html` |

When the change has a place to look, link straight to it: a lab asset by
`/lab.html?asset=<id>&play=0&zoom=6&bg=duo`, or a skin with its knobs. **F2** cycles the
skin in a running game.

Then say, in one line each:

- the server runs in the background until the session ends or you stop it, and Vite
  hot-reloads edits made in this worktree;
- it serves this worktree's code, so another branch needs its own worktree and its own
  server, never a branch switch under this one (CLAUDE.md, *Branch previews*).

## 4. Stop it when asked

Stop the background task by its ID. Do not kill `node` processes by name: other
worktrees' servers are `node` too.
