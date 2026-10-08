/**
 * Under a coding agent, `--silent=false` must print a passing test's console output.
 *
 * Vitest 4.1 runs an agent's tests through its `agent` reporter, which pinned
 * `silent: "passed-only"` on itself: a session's probe test logged into the void,
 * `--silent=false` changed nothing, and it took three turns to route the output
 * through a scratch file instead. `vite.config.ts` unpins it. This runs a child
 * Vitest as an agent would, against `console-probe.test.ts`, and reads its output.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `console-probe.test.ts` logs this. Not imported from there: importing a test file
// registers its tests in this one too.
const PROBE_LINE = "console-probe: this line is the point of a probe test";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const VITEST = resolve(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

/** The child's combined output, run as Claude Code runs it, with `args` added. */
function agentRun(...args: string[]): string {
  // The parent run's own `VITEST*` markers would make the child think it is a worker.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );
  const child = spawnSync(
    process.execPath,
    [VITEST, "run", "src/console-probe.test.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...env, CLAUDECODE: "1", CONSOLE_PROBE: "1", NO_COLOR: "1" },
      timeout: 60_000,
    },
  );
  expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
  return `${child.stdout}\n${child.stderr}`;
}

describe("a passing test's console output under an agent", () => {
  it("prints with --silent=false", { timeout: 120_000 }, () => {
    expect(agentRun("--silent=false")).toContain(PROBE_LINE);
  });

  it("stays quiet by default, as the agent reporter means it to", { timeout: 120_000 }, () => {
    expect(agentRun()).not.toContain(PROBE_LINE);
  });
});
