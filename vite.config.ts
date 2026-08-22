import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // npm dependencies changing while `tauri dev` is running must not create a
    // second React instance in Vite's optimized dependency cache.
    dedupe: ["react", "react-dom"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
