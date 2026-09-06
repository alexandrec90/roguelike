import { resolve } from "node:path";

import { defineConfig, loadEnv } from "vite";

/** Conventional bases. A checkout's actual ports come from its own `.env`. */
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

  return {
    server: {
      port: portFrom(env, "VITE_PORT", DEV_PORT),
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
      port: portFrom(env, "VITE_PREVIEW_PORT", PREVIEW_PORT),
      strictPort: true,
    },
    build: {
      rollupOptions: {
        // Two pages: the scene, and the asset lab that inspects what the scene draws.
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          lab: resolve(import.meta.dirname, "lab.html"),
        },
      },
    },
  };
});
