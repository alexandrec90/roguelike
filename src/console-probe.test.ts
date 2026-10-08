/**
 * A passing test that logs, for `vitest-console.test.ts` to run in a child Vitest.
 *
 * It logs only when that child asks (`CONSOLE_PROBE`), so the suite's own run
 * prints nothing from it.
 */

import { expect, it } from "vitest";

// `vitest-console.test.ts` looks for this exact text.
const PROBE_LINE = "console-probe: this line is the point of a probe test";

it("logs the probe line when asked", () => {
  if (process.env.CONSOLE_PROBE === "1") {
    console.log(PROBE_LINE);
  }
  expect(PROBE_LINE).toContain("probe");
});
