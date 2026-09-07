import { resolve } from "node:path";

import { defineConfig, loadEnv } from "vite";

import { portOffset } from "./src/worktreePort.ts";

/**
 * Conventional bases, for the checkout at slot 0.
 *
 * A worktree adds `portOffset` to both, derived from its own directory name -- so two
 * agent sessions serve on different ports with nothing configured, which is the only
 * thing that works across all three ways a worktree is cut here. `worktreePort.ts`
 * carries why that is derived rather than allocated. An explicit `VITE_PORT` still
 * wins over both.
 */
const DEV_PORT = 4100;
const PREVIEW_PORT = 5100;

/**
 * A port from the environment, or the conventional base.
 *
 * Anything unreadable falls back rather than throwing: a typo in a gitignored
 * `.env` should start the server on the default port, not refuse to build.
 */
export function portFrom(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

export default defineConfig(({ mode }) => {
  // `.env` first, then the real environment on top - Vite's own precedence, so
  // `VITE_PORT=4102 npm run dev` beats the file for a one-off.
  const env = { ...loadEnv(mode, import.meta.dirname, ""), ...process.env };
  // One offset, applied to both bases, so a worktree's pair moves together and
  // `5103` is always the preview for `4103`.
  const offset = portOffset(import.meta.dirname);

  return {
    server: {
      port: portFrom(env, "VITE_PORT", DEV_PORT + offset),
      // `strictPort` is the whole point of this file being a function.
      //
      // It used to be `false`, and the failure that buys is silent and
      // expensive: a second worktree serving the same project takes 4101, says
      // so in one line of startup output nobody reads, and then answers on a
      // port the agent never asked for. Opening 4100 out of habit shows you
      // *another branch's game*, which looks close enough to yours to be
      // believed, and every conclusion drawn from it is about code you did not
      // write. A refusal to start is a worse minute and a better day.
      strictPort: true,
    },
    preview: {
      port: portFrom(env, "VITE_PREVIEW_PORT", PREVIEW_PORT + offset),
      strictPort: true,
    },
    build: {
      rollupOptions: {
        // Three pages: the scene, the asset lab that inspects what the scene
        // draws, and the tree lab where competing procedural mechanisms are
        // compared side by side under one wind.
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          lab: resolve(import.meta.dirname, "lab.html"),
          trees: resolve(import.meta.dirname, "trees.html"),
        },
      },
    },
  };
});
