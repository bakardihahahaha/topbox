import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Same shape as decom's vite.config.ts: self-hosted fonts, installable offline-tolerant shell,
// no external CDN assets. PDFs are generated entirely in the browser (jsPDF) — the server never
// renders anything.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Biosite Sign-off",
        short_name: "Sign-off",
        description: "Mechanism checklist sign-offs — Biosite Systems",
        theme_color: "#1b1f22",
        background_color: "#1b1f22",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,woff2,svg,png}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
      },
    }),
  ],
  server: {
    port: 5175,
    proxy: {
      "/health": "http://localhost:8080",
      "/api": "http://localhost:8080",
    },
  },
});
