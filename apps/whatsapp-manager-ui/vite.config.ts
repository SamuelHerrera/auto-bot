import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: buildApiProxy(),
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});

function buildApiProxy() {
  const target = process.env.WHATSAPP_MANAGER_API_PROXY_TARGET || "http://127.0.0.1:3000";
  return {
    "/whatsapp": { target, changeOrigin: true },
    "/sessions": { target, changeOrigin: true },
    "/deliveries": { target, changeOrigin: true },
    "/number-rules": { target, changeOrigin: true },
    "/chats": { target, changeOrigin: true },
    "/messages": { target, changeOrigin: true },
    "/health": { target, changeOrigin: true },
  };
}
