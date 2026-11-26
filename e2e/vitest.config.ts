import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * The local end-to-end tier, which `scripts/e2e.py` runs and nothing else does.
 *
 * It is outside the default run by construction: `*.e2e.ts` matches neither the
 * default `include` nor anything CI names, so `npm run test` cannot pick these up
 * and has no marker to forget. They need a real Chrome, which a runner lacks.
 */
const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  root,
  test: {
    include: ["e2e/**/*.e2e.ts"],
    globalSetup: ["e2e/support/server.ts"],
    // One browser, one GPU, and frame-time-sensitive pages: nothing here is parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: ["default", ["junit", { outputFile: "logs/e2e-junit.xml" }]],
  },
});
