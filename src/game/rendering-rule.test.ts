/**
 * `.claude/rules/rendering.md` is an instruction file, and ships with a test.
 *
 * What goes stale silently is its API table: an agent is told it can write from
 * that table without opening the module, so a renamed export leaves the next
 * agent writing a call that does not exist. This checks every module the table
 * names exists and exports every symbol it lists.
 *
 * Exports are read from the source text rather than by importing, because
 * several of these modules import Phaser, which will not load under Node.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULE = readFileSync(resolve(HERE, "..", "..", ".claude", "rules", "rendering.md"), "utf8");

function apiRows(): { module: string; symbols: string[] }[] {
  const rows: { module: string; symbols: string[] }[] = [];
  const table = RULE.slice(RULE.indexOf("## The API, in one table"));
  for (const line of table.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const module = /^`([\w/-]+\.ts)`$/.exec(cells[0] ?? "")?.[1];
    if (module === undefined) {
      continue;
    }
    const symbols = [...(cells[1] ?? "").matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(
      (match) => match[1] as string,
    );
    rows.push({ module, symbols });
  }
  return rows;
}

function exportsOf(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1] as string);
  }
  return names;
}

describe("the rendering rule's API table", () => {
  const rows = apiRows();

  it("parses, and names modules that exist", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      expect(existsSync(resolve(HERE, row.module)), `${row.module} does not exist`).toBe(true);
      expect(row.symbols.length, `${row.module} lists no symbols`).toBeGreaterThan(0);
    }
  });

  it("only names symbols the module exports", () => {
    for (const row of rows) {
      const exported = exportsOf(readFileSync(resolve(HERE, row.module), "utf8"));
      for (const symbol of row.symbols) {
        expect(exported.has(symbol), `${row.module} does not export ${symbol}`).toBe(true);
      }
    }
  });

  it("points at files that exist", () => {
    for (const match of RULE.matchAll(/`([\w/-]+\.ts)`/g)) {
      const file = match[1] as string;
      const path = file.startsWith("src/") ? resolve(HERE, "..", "..", file) : resolve(HERE, file);
      expect(existsSync(path), `${file} is named but missing`).toBe(true);
    }
  });
});
