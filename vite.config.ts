import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9999,
    strictPort: true,
    host: true,
    proxy: {
      "/__whoami__": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/api": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/static": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/modules": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/app-settings": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/dashboard": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/dashboard.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/custody.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/create-agent.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/create_agent.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/link-invoices.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
      "/link_invoices.html": { target: "http://127.0.0.1:2288", changeOrigin: true },
    },
  },
  base: "./",
});
