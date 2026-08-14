import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable-512x512.png",
        "pwa-icon-provenance.json",
      ],
      injectManifest: {
        globPatterns: ["**/*.{css,html,js,json,png}"],
      },
      manifest: {
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { sizes: "192x192", src: "/pwa-192x192.png", type: "image/png" },
          { sizes: "512x512", src: "/pwa-512x512.png", type: "image/png" },
          {
            purpose: "maskable",
            sizes: "512x512",
            src: "/pwa-maskable-512x512.png",
            type: "image/png",
          },
        ],
        name: "LP Bot",
        scope: "/",
        short_name: "LP Bot",
        start_url: "/",
        theme_color: "#ffffff",
      },
      registerType: "prompt",
      srcDir: "src",
      strategies: "injectManifest",
    }),
  ],
});
