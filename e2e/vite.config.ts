import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  root: fileURLToPath(new URL("./app", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "react-opencode": fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    },
  },
  server: { port: 5199, strictPort: true },
})
