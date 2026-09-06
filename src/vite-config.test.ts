import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { portFrom } from "../vite.config";

/**
 * The dev server's port is a correctness concern, not a preference.
 *
 * Two worktrees of this project run at once by design (`CLAUDE.md`, Branch
 * previews). With `strictPort: false` the second one silently slid to the next
 * free port and served *the other branch's game* to anyone who opened the
 * conventional one - a failure that costs an hour and leaves no trace, because
 * the page renders perfectly, it is just the wrong page. These assertions are
 * the regression test for that.
 */
const config = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

describe("portFrom", () => {
  it("reads a port out of the environment", () => {
    expect(portFrom({ VITE_PORT: "4103" }, "VITE_PORT", 4100)).toBe(4103);
    expect(portFrom({ VITE_PORT: " 4103 " }, "VITE_PORT", 4100)).toBe(4103);
  });

  it("falls back when the key is absent or blank", () => {
    expect(portFrom({}, "VITE_PORT", 4100)).toBe(4100);
    expect(portFrom({ VITE_PORT: "" }, "VITE_PORT", 4100)).toBe(4100);
    expect(portFrom({ VITE_PORT: "   " }, "VITE_PORT", 4100)).toBe(4100);
  });

  it("falls back rather than throwing on anything unusable", () => {
    // A typo in a gitignored file should start the server, not break the build.
    for (const raw of ["banana", "-1", "0", "99999", "4100.5abc", "NaN"]) {
      expect(portFrom({ VITE_PORT: raw }, "VITE_PORT", 4100)).toBe(4100);
    }
  });

  it("keeps the two servers on separate keys", () => {
    const env = { VITE_PORT: "4103", VITE_PREVIEW_PORT: "5103" };
    expect(portFrom(env, "VITE_PORT", 4100)).toBe(4103);
    expect(portFrom(env, "VITE_PREVIEW_PORT", 5100)).toBe(5103);
  });
});

describe("the dev server config", () => {
  it("refuses to slide onto another port", () => {
    // The one assertion that matters. If this ever reads `false` again, a
    // parallel worktree starts answering on a port nobody asked for.
    expect(config).not.toContain("strictPort: false");
    expect(config.match(/strictPort: true/g)).toHaveLength(2);
  });

  it("takes both ports from the environment, so a worktree can have its own", () => {
    expect(config).toContain('portFrom(env, "VITE_PORT"');
    expect(config).toContain('portFrom(env, "VITE_PREVIEW_PORT"');
  });

  it("documents both keys in the committed env template", () => {
    // `.env` is gitignored, so the template is the only place a new checkout
    // can learn that these keys exist at all.
    const template = readFileSync(resolve(import.meta.dirname, "../.env.example"), "utf8");
    expect(template).toContain("VITE_PORT=");
    expect(template).toContain("VITE_PREVIEW_PORT=");
  });
});
