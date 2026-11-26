import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchChrome, open } from "./support/browser";

let browser: Browser;

beforeAll(async () => {
  browser = await launchChrome();
});

afterAll(async () => {
  await browser?.close();
});

describe("asset lab", () => {
  it("renders every registered asset without a page error", async () => {
    const { page, complaints } = await open(browser, "/lab.html?play=0");
    await page.waitForFunction("Boolean(window.assetLab)");

    const shots = await page.evaluate<{ assets: number; settled: number; pictures: number }>(`(async () => {
      const lab = window.assetLab;
      const assets = lab.assets();
      const pictures = new Set();
      let settled = 0;
      for (const { id } of assets) {
        settled += lab.apply({ assetId: id, variantId: "authored", frame: 0, playing: false }).assetId === id ? 1 : 0;
        lab.seek(250);
        await new Promise(requestAnimationFrame);
        pictures.add(lab.snapshot());
      }
      return { assets: assets.length, settled, pictures: pictures.size };
    })()`);

    expect(shots.assets).toBeGreaterThan(0);
    // Without this, a patch the lab ignored would photograph one asset over and over.
    expect(shots.settled).toBe(shots.assets);
    // Assets all drawing the same blank target is the failure this exists to see.
    expect(shots.pictures).toBeGreaterThan(shots.assets / 2);
    expect(complaints).toEqual([]);
    await page.close();
  });

  it("produces byte-identical pixels for the same seek of an animated effect", async () => {
    const { page } = await open(browser, "/lab.html?play=0");
    await page.waitForFunction("Boolean(window.assetLab)");

    const shots = await page.evaluate<{ early: string; first: string; second: string }>(`(async () => {
      const lab = window.assetLab;
      const effect = lab.assets().find(({ category }) => category === "effect");
      lab.apply({ assetId: effect.id, playing: false });
      const shot = async (ms) => {
        lab.seek(ms);
        await new Promise(requestAnimationFrame);
        return lab.snapshot();
      };
      return { early: await shot(100), first: await shot(400), second: await shot(400) };
    })()`);

    expect(shots.first).toBe(shots.second);
    // Equal only means something for a picture that moves.
    expect(shots.first).not.toBe(shots.early);
    await page.close();
  });
});

describe("tree lab", () => {
  it("keeps the shader and the CPU volume in exact agreement", async () => {
    const { page, complaints } = await open(browser, "/trees.html?renderer=diff");
    await page.waitForFunction("Boolean(window.treeGallery)");
    await page.waitForTimeout(1000);

    const parity = await page.evaluate<{ bodies: number; mismatched: number; webgl2: boolean }>(
      "window.treeGallery.parity()",
    );

    expect(parity.webgl2).toBe(true);
    expect(parity.bodies).toBeGreaterThan(0);
    expect(parity.mismatched).toBe(0);
    expect(complaints).toEqual([]);
    await page.close();
  });
});
