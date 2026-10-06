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

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

  it("names the key that really switches the skin", () => {
    const key = /\*\*(F\d+)\*\* cycles the\s+skin/.exec(SKILL)?.[1];
    expect(SKIN_KEYS).toContain(key);
  });
});
