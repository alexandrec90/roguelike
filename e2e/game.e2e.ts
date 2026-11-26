import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gpuRenderer, launchChrome, open, pictureStats } from "./support/browser";

/** The two looks over one simulation, and where each dev build leaves the hero. */
const SKINS = [
  { skin: "pixel", hero: "window.__scene?.hero" },
  { skin: "lowpoly", hero: "window.__lowpoly?.hero" },
] as const;

/** Tiles the hero has walked in all: the simulation's own count, not a guess from pixels. */
function tilesWalked(page: Page, hero: string): Promise<number> {
  return page.evaluate(`${hero}.whereabouts().walked`);
}

let browser: Browser;

beforeAll(async () => {
  browser = await launchChrome();
});

afterAll(async () => {
  await browser?.close();
});

describe("graphics", () => {
  it("runs on a real GPU rather than a software rasteriser", async () => {
    const { page } = await open(browser, "/?skin=pixel");
    // On SwiftShader every other test here could pass and prove nothing CI could not.
    expect(await gpuRenderer(page)).toMatch(/^ANGLE \((?!.*(SwiftShader|llvmpipe|Microsoft Basic Render)).*\)/);
    await page.close();
  });
});

describe.each(SKINS)("$skin skin", ({ skin, hero }) => {
  it("boots to a live picture with no page errors", async () => {
    const { page, complaints } = await open(browser, `/?skin=${skin}&time=12&weather=clear`);
    await page.waitForFunction(`Boolean(${hero})`);
    await page.waitForTimeout(2000);

    const picture = await pictureStats(page);
    expect(complaints).toEqual([]);
    expect(picture.lit).toBeGreaterThan(0.8);
    expect(picture.colours).toBeGreaterThan(32);
    await page.close();
  });

  it("walks the hero while a key is held", async () => {
    const { page, complaints } = await open(browser, `/?skin=${skin}&time=12&weather=clear`);
    await page.waitForFunction(`Boolean(${hero})`);
    await page.waitForTimeout(1000);
    const before = await tilesWalked(page, hero);

    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyW");

    expect(await tilesWalked(page, hero)).toBeGreaterThan(before + 1);
    expect(complaints).toEqual([]);
    await page.close();
  });
});

describe("bench route", () => {
  it("drives every gait and a fight through the real key path", async () => {
    // The pixel skin is the only one that carries the bench; `lowpoly` is the default.
    const { page, complaints } = await open(browser, "/?skin=pixel&bench=1&sync=1&time=21&weather=storm");
    await page.waitForFunction("Array.isArray(window.__bench)", undefined, { timeout: 90_000 });

    const segments = await page.evaluate<{ name: string; frames: number }[]>(
      "window.__bench.map(({ name, work }) => ({ name, frames: work.n }))",
    );
    expect(segments.map(({ name }) => name)).toEqual(["stand", "north", "strafe", "diagonal", "fight"]);
    for (const { name, frames } of segments) {
      expect(frames, `${name} rendered no frames`).toBeGreaterThan(0);
    }
    expect(complaints).toEqual([]);
    await page.close();
  });
});
