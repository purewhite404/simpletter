import { defineConfig } from 'vite'

// The app's UI (index.html → src/main.ts). Tauri runs it on a fixed port (tauri.conf.json `devUrl`).
export default defineConfig({
  clearScreen: false, // keep Rust's errors on screen
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  }
})
