import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  define: {
    global: "globalThis",
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 30000,
  },
});
