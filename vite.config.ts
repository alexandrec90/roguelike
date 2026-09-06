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
      // Three pages: the scene, the asset lab that inspects what the scene
      // draws, and the tree lab where competing procedural mechanisms are
      // compared side by side under one wind.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        lab: resolve(import.meta.dirname, "lab.html"),
        trees: resolve(import.meta.dirname, "trees.html"),
      },
    },
  },
});
