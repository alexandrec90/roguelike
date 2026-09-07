import { basename, sep } from "node:path";

/**
 * Which port offset this checkout serves on, derived from where it sits on disk.
 *
 * ## The problem
 *
 * Two agent sessions on this project run at once by design, each in its own git
 * worktree, and each runs `npm run dev`. Both land on the conventional port. With
 * `strictPort: true` (see `vite.config.ts`) the second one now fails loudly rather
 * than sliding onto 4101 and serving the other branch's game — but failing loudly is
 * still failing, and somebody has to hand-write a `.env` before either works.
 *
 * ## Why this is derived rather than allocated
 *
 * A worktree gets cut three ways on this machine, and devkit's code runs in exactly
 * one of them:
 *
 * | how | who cuts it | devkit code runs |
 * | --- | --- | --- |
 * | `claude --worktree <topic>` | Claude Code | no |
 * | devkit's `agent-worktree.py new` (the VS Code task; Codex's only route) | devkit | yes |
 * | Claude Remote Control with `"spawn": "worktree"` | Claude Code | no |
 *
 * So nothing devkit does when a worktree is cut — seeding a `.env`, taking a port
 * lease — can reach two of the three. The only mechanism that covers all three is an
 * agent hook, and this workspace deliberately runs none.
 *
 * What all three *do* share is where they land: `<repo>/.claude/worktrees/<name>`.
 * That is already a deliberate single convention rather than a coincidence — devkit
 * cuts there precisely so Codex does not get a second one. And the program that needs
 * to know the port is this one, which runs identically in all three.
 *
 * So the port is computed here, from the directory Vite is already running in. No
 * lease file, no lock, no release step, and nothing to reap — which matters because
 * this worktree tier deliberately has no reaper.
 *
 * ## What it gives up
 *
 * A hash, not an allocator, so two worktrees can collide (about a 1-in-15 chance per
 * added worktree). That is what `strictPort: true` is for: a collision is an
 * immediate, legible startup error, and `VITE_PORT=4107 npm run dev` steps around it.
 * The alternative — a real allocator — needs a registry, a lock and a reaper, which is
 * the machinery this tier exists to avoid.
 *
 * The static checkout always returns 0, so `localhost:4100` keeps meaning what it has
 * always meant, and the same worktree keeps its port across restarts — a bookmarked
 * `localhost:4103` stays valid for as long as that worktree does.
 */

/** Directories a worktree is cut into, relative to the checkout above them. */
const WORKTREE_DIRS = [[".claude", "worktrees"], [".worktrees"]];

/**
 * How many distinct offsets exist, including 0. Matches `registry.max_slots` in
 * devkit's `ports.toml` so that a checkout's dev port and its stack's published ports
 * stay inside the same reserved span, rather than one wandering into the other's.
 */
export const SLOT_SPAN = 16;

/**
 * The worktree name in `dir`, or "" when `dir` is an ordinary checkout.
 *
 * Matched on the path segments above the leaf rather than on a substring, so a
 * checkout that merely *contains* the words — `~/code/worktrees-talk/demo` — is not
 * mistaken for one, and a repository legitimately named `.worktrees` is not either.
 */
export function worktreeName(dir: string): string {
  const parts = dir.split(sep).filter(Boolean);
  return WORKTREE_DIRS.some(
    (marker) =>
      parts.length > marker.length &&
      marker.every((segment, i) => parts[parts.length - 1 - marker.length + i] === segment),
  )
    ? basename(dir)
    : "";
}

/**
 * A stable non-zero number for `name`, in `1..span-1`.
 *
 * FNV-1a, written out rather than imported: this file has to stay dependency-free to
 * be worth vendoring, and the hash only needs to spread short directory names evenly.
 * `>>> 0` after each step keeps it in unsigned 32-bit space, which is what makes the
 * result identical on every platform — the property a bookmarked port depends on.
 */
export function slotFor(name: string, span: number = SLOT_SPAN): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash ^ name.charCodeAt(i)) >>> 0) * 0x01000193;
    hash >>>= 0;
  }
  return 1 + (hash % (span - 1));
}

/**
 * The offset to add to every conventional base for the checkout at `dir`.
 *
 * 0 for a static checkout, so the familiar port keeps working; a stable
 * `1..span-1` for a worktree. Applied to the dev and preview bases together, so one
 * worktree's pair moves as a pair and stays easy to reason about.
 */
export function portOffset(dir: string, span: number = SLOT_SPAN): number {
  const name = worktreeName(dir);
  return name === "" ? 0 : slotFor(name, span);
}
