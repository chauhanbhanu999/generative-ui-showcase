import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    strictPort: true,
    proxy: {
      // /api/agent   → http://localhost:8006/
      // /api/agent/state → http://localhost:8006/state
      "/api/agent": {
        target: "http://localhost:8006",
        rewrite: (path) => path.replace(/^\/api\/agent/, ""),
        changeOrigin: true,
      },
    },
  },
});
