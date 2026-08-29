import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll("\\", "/");
          if (!modulePath.includes("/node_modules/")) return;
          if (modulePath.includes("/node_modules/@mui/icons-material/")) {
            return "mui-icons";
          }
          if (
            modulePath.includes("/node_modules/@mui/") ||
            modulePath.includes("/node_modules/@emotion/")
          ) {
            return "mui";
          }
          if (
            modulePath.includes("/node_modules/react-markdown/") ||
            modulePath.includes("/node_modules/remark-gfm/") ||
            modulePath.includes("/node_modules/remark-") ||
            modulePath.includes("/node_modules/rehype-") ||
            modulePath.includes("/node_modules/unified/") ||
            modulePath.includes("/node_modules/micromark") ||
            modulePath.includes("/node_modules/mdast-")
          ) {
            return "markdown";
          }
          if (
            modulePath.includes("/node_modules/react/") ||
            modulePath.includes("/node_modules/react-dom/") ||
            modulePath.includes("/node_modules/scheduler/")
          ) {
            return "react";
          }
          if (modulePath.includes("/node_modules/@tauri-apps/")) {
            return "tauri";
          }
        },
      },
    },
  },
  server: {
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
