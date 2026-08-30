import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 4100,
    strictPort: false,
  },
  preview: {
    port: 5100,
  },
});
