import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(import.meta.dirname, 'src/renderer'),
    },
  },
  build: { outDir: 'dist', minify: false },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          void startup(['.'])
        },
        vite: { build: { outDir: 'dist-electron/main', minify: false } },
      },
      {
        // Sandboxed preload scripts must be CommonJS.
        onstart({ reload }) {
          reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            minify: false,
            rolldownOptions: {
              input: 'src/preload/index.ts',
              output: { format: 'cjs', entryFileNames: 'index.cjs', codeSplitting: false },
            },
          },
        },
      },
      {
        entry: 'src/pty-host/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/pty-host',
            minify: false,
            rolldownOptions: { external: ['node-pty'] },
          },
        },
      },
    ]),
  ],
})
