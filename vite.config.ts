import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "cmd/olcrtc-manager/web/dist",
    emptyOutDir: true,
  },
});
