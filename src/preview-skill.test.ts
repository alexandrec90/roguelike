/**
 * `/preview` is an instruction file, and instruction files ship with a test.
 *
 * What goes stale silently in it is every concrete thing it names: the npm
 * script, the host the URL is on, the pages it links, the `?skin=` values, the
 * port variable and base, the skin switch key. Rename any of them and the skill
 * still reads fine but hands the user a link to nothing. Each is checked here
 * against the file that owns it. The prose itself needs an eval harness this
 * project does not have.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SKIN_KEYS } from "./game/keybindings";
import { DEFAULT_SKIN, parseSkin } from "./skins/skin";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(resolve(REPO_ROOT, ".claude", "skills", "preview", "SKILL.md"), "utf8");
const VITE_CONFIG = readFileSync(resolve(REPO_ROOT, "vite.config.ts"), "utf8");
const PACKAGE = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

/** The skill's page table: each row's label and its path. */
function pageRows(): { label: string; path: string }[] {
  const table = SKILL.slice(SKILL.indexOf("| Page | Path |"));
  return table
    .split("\n")
    .map((line) => /^\| (.+?) \| `(\/[^`]*)` \|$/.exec(line))
    .flatMap((match) => (match === null ? [] : [{ label: match[1]!, path: match[2]! }]));
}

describe("the /preview skill", () => {
  it("is a skill Claude can find by name", () => {
    expect(SKILL).toMatch(/^---\nname: preview\ndescription: \S.+\n/);
  });

  it("starts the server the npm script defines, on the host it says the URL is on", () => {
    expect(SKILL).toContain("npm run dev");
    expect(PACKAGE.scripts.dev).toContain("--host 127.0.0.1");
    expect(SKILL).toContain("http://127.0.0.1:<port>/");
  });

  it("names the port variable, base and refusal the config really has", () => {
    expect(SKILL).toContain("VITE_PORT=");
    expect(VITE_CONFIG).toMatch(/portFrom\(env, "VITE_PORT"/);
    expect(VITE_CONFIG).toContain("const DEV_PORT = 4100;");
    expect(SKILL).toContain("Port 4100");
    expect(VITE_CONFIG).toContain("strictPort: true");
  });

  it("links only pages that exist and are built", () => {
    const rows = pageRows();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const { path } of rows) {
      const page = path.split("?")[0] === "/" ? "index.html" : path.split("?")[0]!.slice(1);
      expect(existsSync(resolve(REPO_ROOT, page)), `${page} does not exist`).toBe(true);
      if (page !== "index.html") {
        expect(VITE_CONFIG, `${page} is not a build input`).toContain(`"${page}"`);
      }
    }
  });

  it("names skins that load as themselves, and the default that loads with none", () => {
    const rows = pageRows();
    for (const { path } of rows) {
      const skin = new URLSearchParams(path.split("?")[1] ?? "").get("skin");
      if (skin !== null) {
        expect(parseSkin(skin)).toBe(skin);
      }
    }
    const fallback = rows.find(({ label }) => label.includes("(default)"));
    expect(fallback?.path).toBe("/");
    expect(fallback?.label.toLowerCase().replace("-", "")).toContain(DEFAULT_SKIN);
  });

  it("starts the server with plain output, so the URL line can be found", () => {
    // A session waited on `grep "Local:"` in a colored log: the escapes split the
    // word from its colon, the loop never ended, and its 90 s ran out in the foreground.
    const starts = SKILL.split("\n").filter((line) => line.includes("npm run dev >"));
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const line of starts) {
      expect(line, line).toMatch(/^NO_COLOR=1 /);
    }
  });

  it("waits for a line Vite really prints, in the background", () => {
    const wait = /^until grep -qE "([^"]+)" .*; do sleep 1; done;/m.exec(SKILL);
    expect(wait, "the skill's wait loop").not.toBeNull();
    const pattern = new RegExp(wait![1]!);
    // Vite 8's own lines, as `NO_COLOR=1 npm run dev` writes them.
    expect(pattern.test("  ➜  Local:   http://127.0.0.1:4103/")).toBe(true);
    expect(pattern.test("error when starting dev server:")).toBe(true);
    expect(pattern.test("Error: Port 4103 is already in use")).toBe(true);
    expect(pattern.test("  VITE v8.2.2  ready in 1334 ms")).toBe(false);
    expect(SKILL).toContain("second\nbackground** Bash task (`run_in_background`)");
  });

  it("names the key that really switches the skin", () => {
    const key = /\*\*(F\d+)\*\* cycles the\s+skin/.exec(SKILL)?.[1];
    expect(SKIN_KEYS).toContain(key);
  });
});

describe("starting the dev server", () => {
  it("is sent through /preview by every other instruction file", () => {
    // A session told by CLAUDE.md and /art-check to run `npm run dev` did, bare: a colored
    // log, then a foreground `until grep` on it. /preview had the fix and was never loaded.
    const others = [
      "CLAUDE.md",
      ...readdirSync(resolve(REPO_ROOT, ".claude", "skills"))
        .filter((name) => name !== "preview")
        .map((name) => join(".claude", "skills", name, "SKILL.md")),
    ].filter((path) => existsSync(resolve(REPO_ROOT, path)));
    expect(others).toContain(join(".claude", "skills", "art-check", "SKILL.md"));
    for (const path of others) {
      const bare = readFileSync(resolve(REPO_ROOT, path), "utf8")
        .split("\n")
        .filter((line) => /(^|[`\s])npm run dev\b/.test(line) && !/VITE_PORT=\d+ npm run dev/.test(line));
      expect(bare, `${path} starts the dev server without /preview`).toEqual([]);
    }
  });
});
