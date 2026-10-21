import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backend = `http://127.0.0.1:${rootEnv.PORT || 3001}`;
  const gpsMax = rootEnv.GPS_MAX_ACCURACY_M ?? "50";

  return {
    plugins: [react()],
    envDir: path.resolve(__dirname, ".."),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_GPS_MAX_ACCURACY_M": JSON.stringify(gpsMax),
    },
    server: {
      host: true,
      allowedHosts: true,
      port: 5173,
      proxy: {
        "/api": {
          target: backend,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
        "/socket.io": {
          target: backend,
          changeOrigin: true,
          ws: true,
        },
        "/photos": {
          target: backend,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
