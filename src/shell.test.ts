import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The page is the game world and nothing else: no title, no border, no chrome.
 * These assertions exist because that is a product decision, not a styling
 * preference — a header or a framed viewport reintroduced here would look like
 * polish rather than the regression it is.
 */
const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "src/style.css"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
const scene = readFileSync(resolve(root, "src/game/demo-scene.ts"), "utf8");

/** The block of a CSS rule, so a property is matched against its own selector. */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  return source.slice(start, end);
}

describe("the page shell", () => {
  it("renders no chrome elements at all", () => {
    for (const tag of ["header", "footer", "nav", "h1", "button", "a "]) {
      expect(html).not.toContain(`<${tag}`);
    }
  });

  it("carries no scene title", () => {
    expect(html.toLowerCase()).not.toContain("ember cellar");
  });

  it("hosts the canvas in one full-viewport element", () => {
    expect(html).toContain('id="game"');
    const game = ruleBody(css, "#game");
    expect(game).toContain("width: 100vw");
    expect(game).toContain("height: 100vh");
  });

  it("frames the viewport with nothing", () => {
    const game = ruleBody(css, "#game");
    for (const property of ["border", "outline", "box-shadow", "aspect-ratio"]) {
      expect(game).not.toContain(`${property}:`);
    }
  });

  it("covers the window without distortion while keeping the horizon visible", () => {
    expect(main).toContain("integerCoverScale(");
    expect(main).toContain("coverOffset(");
    expect(main).not.toContain("integerScale(");
    expect(main).not.toContain("letterbox(");
  });

  it("leaves no decorative overlay over the world", () => {
    expect(css).not.toContain("::after");
    expect(css).not.toContain("::before");
  });

  it("draws no caption inside the canvas either", () => {
    // Removing the DOM chrome and leaving a label rendered into the world would
    // satisfy every assertion above while looking identical on screen.
    expect(scene).not.toContain(".text(");
  });
});
