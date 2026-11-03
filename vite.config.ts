import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import svgr from 'vite-plugin-svgr'

// Hoot's processes take `fs` to be Electron's `original-fs`, as Visual Studio
// Code does: Electron's own `fs` takes an `.asar` file for a folder, so that,
// say, the `default_app.asar` in an Electron project's dependencies could be
// neither deleted with its worktree nor opened in the file panel. So does
// every package bundled, also one that requires `fs` as it runs; node-pty,
// which is loaded as it is, keeps Electron's. Nothing reads Hoot's own
// app.asar with `fs`: Electron loads Hoot's scripts and page itself, and the
// files Hoot reads as it runs are outside the archive, in its resources.
const originalFs = {
  fs: 'original-fs',
  'node:fs': 'node:original-fs',
  'fs/promises': 'original-fs/promises',
  'node:fs/promises': 'node:original-fs/promises',
}

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
    // `*.svg?react` imports an SVG file as a React component, whose `title`
    // prop replaces the file's own title, or leaves it out when empty.
    svgr({ svgrOptions: { titleProp: true } }),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          void startup(['.'])
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rolldownOptions: { output: { paths: originalFs } },
          },
        },
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
            rolldownOptions: { external: ['node-pty'], output: { paths: originalFs } },
          },
        },
      },
      {
        // The utility process that deletes the files of a worktree.
        entry: 'src/deleter/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/deleter',
            minify: false,
            rolldownOptions: { output: { paths: originalFs } },
          },
        },
      },
      {
        // hoot, the command line program of Hoot's sessions, which Hoot's
        // own executable runs as Node.js.
        entry: 'src/cli/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/cli',
            minify: false,
            rolldownOptions: { output: { paths: originalFs } },
          },
        },
      },
    ]),
  ],
})
