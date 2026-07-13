import { defineConfig } from "vite";

const OVERPASS_UA = "StreetDots/1.0 (https://github.com/; vite proxy)";

/** Set BASE_PATH=/repo-name/ in CI for project pages. Local/default is "/". */
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  server: {
    proxy: {
      "/api/overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, "/api/interpreter"),
        headers: { "User-Agent": OVERPASS_UA },
      },
      "/api/nominatim": {
        target: "https://nominatim.openstreetmap.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nominatim/, ""),
        headers: { "User-Agent": OVERPASS_UA },
      },
    },
  },
  preview: {
    proxy: {
      "/api/overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, "/api/interpreter"),
        headers: { "User-Agent": OVERPASS_UA },
      },
      "/api/nominatim": {
        target: "https://nominatim.openstreetmap.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nominatim/, ""),
        headers: { "User-Agent": OVERPASS_UA },
      },
    },
  },
});
