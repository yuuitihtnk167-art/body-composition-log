import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
　base: "/body-composition-log/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [react()],
});
