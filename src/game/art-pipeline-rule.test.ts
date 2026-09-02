/**
 * The art rules and the art-check skill are instruction files, and instruction
 * files ship with a test like code does.
 *
 * What is testable about them is the part that goes stale silently: the API
 * table an agent is told it can write from without opening the module, the
 * files the decision tables point at, and the lab handle the capture ritual
 * tells an agent to call. A renamed export leaves the table quietly wrong, and
 * the next agent writes a call that does not exist — the exact failure the
 * table was added to prevent.
 *
 * The prose is not tested here; that needs an eval harness this project does
 * not have. `/art-check` is deliberately not evaluated at all — its subject is
 * a live browser's pixels — which is the other reason this file exists.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const RULES_DIR = resolve(REPO_ROOT, ".claude", "rules");

/** The art rules, by name, so a failure says which file to fix. */
const ART_RULES = ["art-pipeline.md", "procedural-effects.md"] as const;

function ruleText(name: string): string {
  return readFileSync(resolve(RULES_DIR, name), "utf8");
}

const SKILL = readFileSync(
  resolve(REPO_ROOT, ".claude", "skills", "art-check", "SKILL.md"),
  "utf8",
);

/** Lazy loaders for the sibling modules, so nothing unrelated gets imported. */
const MODULES = import.meta.glob<Record<string, unknown>>("./*.ts");

/** Cells of every Markdown table row whose first cell is a backticked module. */
function apiRows(text: string): { module: string; symbols: string[] }[] {
  const rows: { module: string; symbols: string[] }[] = [];
  for (const line of text.split("\n")) {
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

describe("the art rules' API tables", () => {
  it("name modules that exist, with symbols to check", () => {
    const rows = ART_RULES.flatMap((name) => apiRows(ruleText(name)));

    // A parser that silently matched nothing would make every assertion below
    // vacuous, which is the one way this test could pass while lying.
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(MODULES[`./${row.module}`], `${row.module} is not a sibling module`).toBeDefined();
      expect(row.symbols.length, `${row.module} lists no symbols`).toBeGreaterThan(0);
    }
  });

  it("only name symbols the module actually exports", async () => {
    for (const name of ART_RULES) {
      for (const { module, symbols } of apiRows(ruleText(name))) {
        const loader = MODULES[`./${module}`];
        if (!loader) {
          continue; // reported by the test above
        }
        const exported = Object.keys(await loader());
        for (const symbol of symbols) {
          expect(
            exported,
            `${name}: ${module} no longer exports '${symbol}' — fix the rule's table`,
          ).toContain(symbol);
        }
      }
    }
  });
});

describe("the art rules' decision tables", () => {
  it("point at files that exist", () => {
    for (const name of ART_RULES) {
      const referenced = new Set(
        [...ruleText(name).matchAll(/`(src\/game\/[\w-]+\.ts)`/g)].map((match) => match[1] as string),
      );

      expect(referenced.size, `${name} points at no modules at all`).toBeGreaterThan(0);
      for (const relative of referenced) {
        expect(existsSync(resolve(REPO_ROOT, relative)), `${name}: ${relative} does not exist`).toBe(
          true,
        );
      }
    }
  });

  it("send shading work to the module that owns it", () => {
    // The whole point of adding a light pass was that nobody hand-draws a
    // shaded frame again; a rule that forgot to say where shading lives would
    // leave that as an unenforced preference.
    expect(ruleText("art-pipeline.md")).toContain("src/game/shading.ts");
    expect(ruleText("art-pipeline.md")).toContain("shadeCloud");
  });
});

describe("CLAUDE.md's cross-reference list", () => {
  it("mentions every rule file, so none is discoverable only by luck", () => {
    const root = readFileSync(resolve(REPO_ROOT, "CLAUDE.md"), "utf8");
    for (const file of readdirSync(RULES_DIR).filter((name) => name.endsWith(".md"))) {
      expect(root, `CLAUDE.md never mentions .claude/rules/${file}`).toContain(file);
    }
  });
});

describe("the /art-check skill", () => {
  it("declares the frontmatter the repository contract requires", () => {
    expect(SKILL).toMatch(/^---\n(?:.*\n)*?name:\s*art-check\s*\n/);
    expect(SKILL).toMatch(/\ndescription:\s*\S.*\n/);
  });

  it("keeps the lab capture URL honest about pinning the frame", () => {
    // `play=0` is what makes a capture reproducible; a ritual that told an agent
    // to screenshot a playing animation would be advice that cannot be followed.
    expect(SKILL).toContain("play=0");
    expect(SKILL).toContain("bg=duo");
  });

  it("only names query keys the lab actually reads", () => {
    const labState = readFileSync(resolve(REPO_ROOT, "src", "lab", "lab-state.ts"), "utf8");
    for (const key of ["asset", "variant", "frame", "t", "play", "zoom", "bg", "grid", "bounds", "tile"]) {
      expect(SKILL, `the skill never documents '${key}'`).toContain(`\`${key}\``);
      expect(labState, `the lab does not read '${key}' from the URL`).toContain(
        `params.get("${key}")`,
      );
    }
  });

  it("only names capture-handle methods the lab exposes", () => {
    const labMain = readFileSync(resolve(REPO_ROOT, "src", "lab", "main.ts"), "utf8");
    for (const method of ["state", "apply", "seek", "assets", "snapshot"]) {
      expect(SKILL, `the skill never mentions assetLab.${method}`).toContain(`${method}(`);
      expect(labMain, `window.assetLab no longer exposes ${method}`).toMatch(
        new RegExp(`\\n\\s*${method}:`),
      );
    }
  });
});
