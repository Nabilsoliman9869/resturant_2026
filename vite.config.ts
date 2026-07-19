import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** يتغيّر عند كل تشغيل `npm run dev` — للتأكد أنك لا تشاهد كاشاً قديماً */
const mat3amViteBootStamp = new Date().toISOString();
const mat3amNoCacheHeaders = {
  "Cache-Control": "no-store",
};

const mat3amProxyConfig = {
  "/__whoami__": {
    target: "http://localhost:2288",
    changeOrigin: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
  },
  "/api": {
    target: "http://localhost:2288",
    changeOrigin: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
  },
  "/static": { target: "http://localhost:2288", changeOrigin: true },
  "/modules": { target: "http://localhost:2288", changeOrigin: true },
  "/app-settings": { target: "http://localhost:2288", changeOrigin: true },
  "/dashboard": { target: "http://localhost:2288", changeOrigin: true },
  "/dashboard.html": { target: "http://localhost:2288", changeOrigin: true },
  "/custody.html": { target: "http://localhost:2288", changeOrigin: true },
  "/create-agent.html": { target: "http://localhost:2288", changeOrigin: true },
  "/create_agent.html": { target: "http://localhost:2288", changeOrigin: true },
  "/link-invoices.html": { target: "http://localhost:2288", changeOrigin: true },
  "/link_invoices.html": { target: "http://localhost:2288", changeOrigin: true },
};

export default defineConfig({
  define: {
    __MAT3AM_VITE_BOOT_STAMP__: JSON.stringify(mat3amViteBootStamp),
  },
  plugins: [react()],
  server: {
    port: 9999,
    strictPort: true,
    host: true,
    headers: mat3amNoCacheHeaders,
    proxy: mat3amProxyConfig,
  },
  preview: {
    port: 9999,
    strictPort: true,
    host: true,
    headers: mat3amNoCacheHeaders,
    proxy: mat3amProxyConfig,
  },
  base: "/",
  /** يجب أن يطابق ما يخدمه api_server (REST_DIR = ui/restaurant) وحزمة PyInstaller (مجلد ui). */
  build: {
    outDir: "ui/restaurant",
    emptyOutDir: true,
  },
});
