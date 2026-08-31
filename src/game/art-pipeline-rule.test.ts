/**
 * The drawing rule is an instruction file, and instruction files ship with a
 * test like code does.
 *
 * What is testable about it is the part that goes stale silently: the API table
 * an agent is told it can write from without opening the module. A renamed
 * export leaves that table quietly wrong, and the next agent writes a call that
 * does not exist — the exact failure the table was added to prevent. So this
 * asserts the table against the real export surface, and asserts the files the
 * decision table points at are really there.
 *
 * The prose is not tested here; that needs an eval harness this project does
 * not have.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const RULE_PATH = resolve(REPO_ROOT, ".claude", "rules", "art-pipeline.md");
const RULE = readFileSync(RULE_PATH, "utf8");

/** Lazy loaders for the sibling modules, so nothing unrelated gets imported. */
const MODULES = import.meta.glob<Record<string, unknown>>("./*.ts");

/** Cells of every Markdown table row whose first cell is a backticked module. */
function apiRows(): { module: string; symbols: string[] }[] {
  const rows: { module: string; symbols: string[] }[] = [];
  for (const line of RULE.split("\n")) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const module = /^`([\w-]+\.ts)`$/.exec(cells[0] ?? "")?.[1];
    if (!module) {
      continue;
    }
    const symbols = [...(cells[1] ?? "").matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(
      (match) => match[1] as string,
    );
    rows.push({ module, symbols });
  }
  return rows;
}

describe("the art-pipeline rule's API table", () => {
  it("names modules that exist, with symbols to check", () => {
    const rows = apiRows();

    // A parser that silently matched nothing would make every assertion below
    // vacuous, which is the one way this test could pass while lying.
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const row of rows) {
      expect(MODULES[`./${row.module}`], `${row.module} is not a sibling module`).toBeDefined();
      expect(row.symbols.length, `${row.module} lists no symbols`).toBeGreaterThan(0);
    }
  });

  it("only names symbols the module actually exports", async () => {
    for (const { module, symbols } of apiRows()) {
      const loader = MODULES[`./${module}`];
      if (!loader) {
        continue; // reported by the test above
      }
      const exported = Object.keys(await loader());
      for (const symbol of symbols) {
        expect(exported, `${module} no longer exports '${symbol}' — fix the rule's table`).toContain(
          symbol,
        );
      }
    }
  });
});

describe("the art-pipeline rule's decision table", () => {
  it("points at files that exist", () => {
    const referenced = new Set(
      [...RULE.matchAll(/`(src\/game\/[\w-]+\.ts)`/g)].map((match) => match[1] as string),
    );

    expect(referenced.size).toBeGreaterThan(0);
    for (const relative of referenced) {
      expect(existsSync(resolve(REPO_ROOT, relative)), `${relative} does not exist`).toBe(true);
    }
  });

  it("keeps the lab capture URL honest about pinning the frame", () => {
    // `play=0` is what makes a capture reproducible; a rule that told an agent
    // to screenshot a playing animation would be advice that cannot be followed.
    expect(RULE).toContain("play=0");
    expect(RULE).toContain("bg=duo");
  });
});
