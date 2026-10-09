// Starts the built app.
//
// On macOS the app is opened through LaunchServices (`open`), the way Finder
// and the Dock open apps. `open` hands its own environment to the app, so it
// runs with an empty one: LaunchServices then starts Hoot with the
// graphical login session environment instead of this terminal's environment.
// Sessions build their environment from it.
//
// Pass `--background` for unattended checks: Hoot starts without coming to
// the front, and its window stays off screen until its Dock icon is clicked.
// Other arguments are passed on to the app.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
if (!fs.existsSync(path.join(appRoot, 'dist-electron', 'main', 'index.js'))) {
  console.error('Hoot is not built yet. Run `pnpm build` first.')
  process.exit(1)
}

// The `electron` package exports the path of the Electron executable,
// downloading Electron first if needed.
const executable = createRequire(import.meta.url)('electron') as string
const args = process.argv.slice(2)
const background = args.includes('--background')

const child =
  process.platform === 'darwin'
    ? spawn(
        '/usr/bin/open',
        [
          '-n',
          '-W',
          ...(background ? ['-g'] : []),
          '-a',
          path.resolve(executable, '../../..'),
          '--args',
          appRoot,
          ...args,
        ],
        { stdio: 'inherit', env: {} },
      )
    : spawn(executable, [appRoot, ...args], { stdio: 'inherit' })

child.on('exit', (code) => process.exit(code ?? 0))
