import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";

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

const plugins: PluginOption[] = [react(), tailwindcss(), analyticsPlugin];

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
