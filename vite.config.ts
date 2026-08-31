import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 4100,
    strictPort: false,
  },
  preview: {
    port: 5100,
  },
  build: {
    rollupOptions: {
      // Two pages: the scene, and the asset lab that inspects what the scene draws.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        lab: resolve(import.meta.dirname, "lab.html"),
      },
    },
  },
});
