// Installs the app that `pnpm app:package` built as /Applications/Hoot.app,
// replacing an earlier installation.
//
// The new copy is moved into place by renaming it, so a Hoot running from
// /Applications keeps the files it has open and runs the version it started
// with until it is quit and opened again.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
// electron-builder names its output folder after the architecture it built for.
const built = path.join(
  appRoot,
  'release',
  process.arch === 'arm64' ? 'mac-arm64' : 'mac',
  'Hoot.app',
)
if (!fs.existsSync(built)) {
  console.error('Hoot is not packaged yet. Run `pnpm app:package` first.')
  process.exit(1)
}

const target = '/Applications/Hoot.app'
const incoming = '/Applications/.Hoot.app.incoming'
const outgoing = '/Applications/.Hoot.app.outgoing'
for (const leftover of [incoming, outgoing]) fs.rmSync(leftover, { recursive: true, force: true })

// ditto copies the bundle exactly, keeping its symbolic links and code signature intact.
const copy = spawnSync('/usr/bin/ditto', [built, incoming], { stdio: 'inherit' })
if (copy.status !== 0) process.exit(copy.status ?? 1)
if (fs.existsSync(target)) fs.renameSync(target, outgoing)
fs.renameSync(incoming, target)
fs.rmSync(outgoing, { recursive: true, force: true })

console.log(`Installed ${target}. If Hoot is running, quit and open it again to use this version.`)
