import { resolve } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

const root = resolve(import.meta.dirname, "../..");

/**
 * One dev server for the whole run, on a port the OS picks.
 *
 * The dev build, not `dist/`, because `__scene` and `__lowpoly` exist only there and
 * they are how a test reads the hero's state rather than guessing it from pixels.
 * Port 0 because the night's run must not collide with a dev server left running in
 * this checkout, and `strictPort` would turn that into a failure about nothing.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server: ViteDevServer = await createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error(`The dev server has no TCP address: ${String(address)}`);
  }
  project.provide("baseUrl", `http://127.0.0.1:${address.port}`);
  return () => server.close();
}
