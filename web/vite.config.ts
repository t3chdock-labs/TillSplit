import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "TillSplit",
        short_name: "TillSplit",
        description: "Kassenbons erfassen, auswerten und in Actual Budget aufteilen",
        lang: "de",
        start_url: "/",
        display: "standalone",
        background_color: "#0b1220",
        theme_color: "#0f766e",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Fotos, Screenshots und PDFs direkt aus anderen Apps "teilen"
        share_target: {
          action: "/api/teilen",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "dateien", accept: ["image/*", "application/pdf"] }] },
        },
      } as never,
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
