import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** يتغيّر عند كل تشغيل `npm run dev` — للتأكد أنك لا تشاهد كاشاً قديماً */
const mat3amViteBootStamp = new Date().toISOString();

export default defineConfig({
  define: {
    __MAT3AM_VITE_BOOT_STAMP__: JSON.stringify(mat3amViteBootStamp),
  },
  plugins: [react()],
  server: {
    port: 9999,
    strictPort: true,
    host: true,
    headers: {
      "Cache-Control": "no-store",
    },
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
  base: "/",
  /** يجب أن يطابق ما يخدمه api_server (REST_DIR = ui/restaurant) وحزمة PyInstaller (مجلد ui). */
  build: {
    outDir: "ui/restaurant",
    emptyOutDir: true,
  },
});
