import { chromium, type Browser, type Page } from "playwright-core";
import { inject } from "vitest";

/** A window big enough for a whole-number scale, so the canvas has real pixels to read. */
const VIEWPORT = { width: 1280, height: 720 };

/**
 * The machine's own Chrome, headless, on its real GPU.
 *
 * `playwright-core` downloads no browser, so a stale driver never means a stale
 * Chrome. The ANGLE flags are the point of this tier: left alone, headless Chrome may
 * fall back to a software rasteriser, which compiles shaders a real driver rejects.
 */
export function launchChrome(): Promise<Browser> {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=default", "--enable-unsafe-webgpu"],
  });
}

/** A page, and everything it complained about while it was open. */
export interface WatchedPage {
  readonly page: Page;
  /** Uncaught exceptions and `console.error`s, in order. A clean run leaves this empty. */
  readonly complaints: string[];
}

/** Open `path` on the dev server, recording every error the page raises from the first byte. */
export async function open(browser: Browser, path: string): Promise<WatchedPage> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const complaints: string[] = [];
  page.on("pageerror", (error) => complaints.push(`uncaught: ${error.message}`));
  page.on("console", (message) => {
    // No page declares an icon, so Chrome's own probe for one 404s. It is not the page's request.
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) {
      complaints.push(`console.error: ${message.text()}`);
    }
  });
  await page.goto(`${inject("baseUrl")}${path}`, { waitUntil: "load" });
  return { page, complaints };
}

/** The renderer string WebGL2 reports, such as `ANGLE (Intel, Iris Xe, D3D11)`. */
export function gpuRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl === null) {
      return "no WebGL2";
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
  });
}

/** What a frame looks like, as counts: enough to tell a picture from a dead canvas. */
export interface PictureStats {
  /** Different colours in the sample. A cleared or garbled target has a handful. */
  readonly colours: number;
  /** Share of sampled pixels that are not black, 0 to 1. */
  readonly lit: number;
}

/**
 * Sample what the compositor actually shows.
 *
 * A screenshot rather than `canvas.toDataURL`, because a WebGL canvas without
 * `preserveDrawingBuffer` reads back cleared outside its own frame - a blank that
 * would be this test's fault, not the game's. The decoding runs in the page since a
 * browser already holds a PNG decoder and Node does not.
 */
export async function pictureStats(page: Page): Promise<PictureStats> {
  const png = (await page.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("No 2D context to decode the screenshot on");
    }
    context.drawImage(image, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
    const seen = new Set<number>();
    let lit = 0;
    let total = 0;
    for (let at = 0; at < pixels.length; at += 4 * 7) {
      const red = pixels[at] ?? 0;
      const green = pixels[at + 1] ?? 0;
      const blue = pixels[at + 2] ?? 0;
      seen.add((red << 16) | (green << 8) | blue);
      lit += red + green + blue > 0 ? 1 : 0;
      total += 1;
    }
    return { colours: seen.size, lit: lit / total };
  }, png);
}
