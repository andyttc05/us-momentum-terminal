import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dataService = process.env.DATA_SERVICE_URL || "http://127.0.0.1:8787";

export default defineConfig({
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
