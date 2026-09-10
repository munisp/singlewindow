import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
// Phase 17 (G5): Cesium is a pinned npm dependency bundled at build time
// (static assets copied into dist) — no runtime cesium.com CDN injection.
import cesium from "vite-plugin-cesium";
import fs from "node:fs";

// Strip vite-plugin-cesium's eager <script src="/cesium/Cesium.js"> + CSS injection:
// the GeospatialPortal lazy-loads those same-origin assets only when the user
// opens the 3D view (Phase 17 #8 — low-bandwidth pages must not pay for Cesium).
const cesiumLazyHtmlPlugin: PluginOption = {
  name: "cesium-lazy-html",
  enforce: "post",
  transformIndexHtml(html) {
    return html
      .replace(/\s*<script[^>]*src="[^"]*cesium\/Cesium\.js"[^>]*><\/script>/, "")
      .replace(/\s*<link[^>]*href="[^"]*cesium\/Widgets\/widgets\.css"[^>]*>/, "");
  },
};

// vite-plugin-cesium miscomputes outDir when build.outDir is an absolute path
// (this repo sets an absolute outDir), so its asset copy lands in a bogus
// nested dir. This companion plugin copies the prebuilt Cesium assets into the
// real outDir at the same /cesium/ base URL the plugin references.
const cesiumAssetsPlugin: PluginOption = {
  name: "cesium-assets-outdir-fix",
  apply: "build",
  closeBundle() {
    const src = path.resolve(import.meta.dirname, "node_modules/cesium/Build/Cesium");
    const dest = path.resolve(import.meta.dirname, "dist/public/cesium");
    if (!fs.existsSync(src)) return;
    fs.cpSync(src, dest, { recursive: true });
  },
};

// B15: only ship the umami analytics tag when VITE_ANALYTICS_ENDPOINT is a real
// http(s) URL; otherwise strip the %VITE_ANALYTICS_*% placeholders from the HTML.
const analyticsEndpoint = process.env.VITE_ANALYTICS_ENDPOINT ?? "";
const analyticsWebsiteId = process.env.VITE_ANALYTICS_WEBSITE_ID ?? "";
const analyticsEnabled = /^https?:\/\/.+/.test(analyticsEndpoint) && analyticsWebsiteId.length > 0;

const analyticsPlugin: PluginOption = {
  name: "analytics-tag",
  transformIndexHtml(html) {
    if (analyticsEnabled) {
      return html
        .replaceAll("%VITE_ANALYTICS_ENDPOINT%", analyticsEndpoint.replace(/\/+$/, ""))
        .replaceAll("%VITE_ANALYTICS_WEBSITE_ID%", analyticsWebsiteId);
    }
    // Remove the placeholder script tag entirely so no broken src is shipped.
    return html.replace(
      /\s*<script[^>]*src="%VITE_ANALYTICS_ENDPOINT%[^"]*"[^>]*><\/script>/,
      ""
    );
  },
};

const plugins: PluginOption[] = [react(), tailwindcss(), analyticsPlugin, cesium(), cesiumLazyHtmlPlugin, cesiumAssetsPlugin];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Note: MapLibre splits into a lazy chunk automatically (GeospatialPortal
    // is lazy-routed); Cesium ships as prebuilt same-origin assets under
    // /cesium/ loaded on demand — see the cesium plugins above.
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
