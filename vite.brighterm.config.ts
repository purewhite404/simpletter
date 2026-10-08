import { defineConfig } from 'vite'

/**
 * The notes UI as Brighterm's Notes plugin (kind "app"): dist-brighterm/ =
 * manifest.json + index.html + main.js + style.css, the layout of
 * brighterm/plugins-builtin/notes/. One classic script (IIFE), not minified —
 * Brighterm scans plugin sources before installing them.
 */
export default defineConfig({
  publicDir: 'src/brighterm/static',
  build: {
    outDir: 'dist-brighterm',
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
    lib: {
      entry: 'src/brighterm/main.ts',
      formats: ['iife'],
      name: 'SimpletterNotes',
      fileName: () => 'main.js',
      cssFileName: 'style'
    }
  }
})
