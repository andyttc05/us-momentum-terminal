import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dataService = process.env.DATA_SERVICE_URL || "http://127.0.0.1:8787";

// GitHub Pages serves the site from the repository subpath. The deploy build
// sets VITE_BASE_PATH to that subpath; local development and the plain local
// production build keep the root default so nothing changes for normal use.
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": { target: dataService, changeOrigin: true },
    },
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: dataService, changeOrigin: true },
    },
  },
  plugins: [react()],
});
