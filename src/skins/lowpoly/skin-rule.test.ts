/**
 * `.claude/rules/skin-lowpoly.md` is an instruction file, and ships with a test:
 * every module its API table names exists here and exports every symbol listed,
 * so an agent writing from the table never calls something that was renamed.
 * Read as text, because `renderer.ts` and `index.ts` touch WebGL and the DOM.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULE = readFileSync(resolve(HERE, "..", "..", "..", ".claude", "rules", "skin-lowpoly.md"), "utf8");

function apiRows(): { module: string; symbols: string[] }[] {
  const table = RULE.slice(RULE.indexOf("## The API, in one table"));
  return table.split("\n").flatMap((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const module = /^`([\w/-]+\.ts)`$/.exec(cells[0] ?? "")?.[1];
    if (module === undefined) {
      return [];
    }
    return [{ module, symbols: [...(cells[1] ?? "").matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1] as string) }];
  });
}

describe("the low-poly skin rule's API table", () => {
  const rows = apiRows();

  it("names modules that exist, each with symbols", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(existsSync(resolve(HERE, row.module)), `${row.module} does not exist`).toBe(true);
      expect(row.symbols.length).toBeGreaterThan(0);
    }
  });

  it("only names symbols the module exports", () => {
    for (const row of rows) {
      const source = readFileSync(resolve(HERE, row.module), "utf8");
      for (const symbol of row.symbols) {
        expect(source, `${row.module} does not export ${symbol}`).toMatch(
          new RegExp(`export\\s+(?:const|function|class|interface|type)\\s+${symbol.replace("$", "\\$")}\\b`),
        );
      }
    }
  });

  it("is scoped to this skin alone, so it never loads on the pixel skin's files", () => {
    expect(RULE).toMatch(/paths:\n\s+- src\/skins\/lowpoly\/\*\*\/\*\.ts\n---/);
  });
});
