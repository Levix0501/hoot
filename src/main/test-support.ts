// Helpers for the unit tests of every part of the main process.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * What removing a file or folder fails with on Windows while something has
 * it open or runs in it: the errors Node.js's own `fs.rm` tries again on.
 */
const IN_USE = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])

/** How many of the files left in a folder its warning names. */
const NAMED_FILES = 20

/**
 * Lists the processes whose program or command line names one of the
 * folders in HOOT_TEST_FOLDERS, separated by `|`, which no path on Windows
 * has: a line each, with its id, its parent's and its command line.
 */
const LIST_PROCESSES = `
$folders = $env:HOOT_TEST_FOLDERS.Split('|')
Get-CimInstance Win32_Process | ForEach-Object {
  $text = "$($_.ExecutablePath) $($_.CommandLine)"
  if ($folders | Where-Object { $text.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) {
    $line = if ($_.CommandLine) { $_.CommandLine } else { $_.ExecutablePath }
    "  $($_.ProcessId), started by $($_.ParentProcessId): $line"
  }
}
`

/**
 * Removes a test's temporary folder with everything in it.
 *
 * On Windows, which removes nothing in use, a file or folder in it can stay
 * in use for a while after the test, by something not yet known. There the
 * removal is tried again for `giveUpMs`, which this helper's own test
 * shortens, and then the folder is left behind rather than failing the test,
 * with a warning that says what is left in it and which processes run from
 * it or name it. Elsewhere, where a file in use can be removed, a folder
 * that cannot be removed fails the test: only the test leaves it so, such as
 * without the permissions it took away.
 */
export async function removeTestFolder(folder: string, giveUpMs = 10_000): Promise<void> {
  if (process.platform !== 'win32') {
    await fs.promises.rm(folder, { recursive: true, force: true })
    return
  }
  const giveUpAt = Date.now() + giveUpMs
  for (;;) {
    try {
      await fs.promises.rm(folder, { recursive: true, force: true })
      return
    } catch (error) {
      const failure = error as NodeJS.ErrnoException
      if (!IN_USE.has(failure.code ?? '')) throw error
      if (Date.now() >= giveUpAt) {
        warn(await leftBehind(folder, giveUpMs, failure))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

/** What the warning of a folder left behind says. */
async function leftBehind(
  folder: string,
  giveUpMs: number,
  failure: NodeJS.ErrnoException,
): Promise<string> {
  const entries = await fs.promises.readdir(folder, { recursive: true }).catch(() => [])
  const more = entries.length > NAMED_FILES ? ` and ${entries.length - NAMED_FILES} more` : ''
  return [
    `Left ${folder} behind: it could not be removed in ${giveUpMs / 1000} seconds, last for ${
      failure.code
    } on ${String(failure.path ?? folder)}.`,
    `Left in it: ${entries.slice(0, NAMED_FILES).join(', ') || 'nothing'}${more}.`,
    `Processes that run from it or name it: ${await processesNaming(folder)}`,
  ].join('\n')
}

/**
 * The processes whose program or command line names a folder, which are
 * likely what has it in use: those that run from it, or were given a file
 * in it. The folder is looked for as written and as it is on disk, as a
 * temporary folder may be written with the short names of its folders,
 * such as `C:\Users\RUNNER~1`.
 */
async function processesNaming(folder: string): Promise<string> {
  const onDisk = await fs.promises.realpath(folder).catch(() => folder)
  const folders = onDisk.toLowerCase() === folder.toLowerCase() ? [folder] : [folder, onDisk]
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PROCESSES],
      {
        env: { ...process.env, HOOT_TEST_FOLDERS: folders.join('|') },
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) resolve(`they could not be listed: ${error.message}`)
        else resolve(stdout.trim() === '' ? 'none' : `\n${stdout.trimEnd()}`)
      },
    )
  })
}

/** Prints a warning: on GitHub Actions, as an annotation, which shows on the run's page. */
function warn(text: string): void {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    console.warn(text)
    return
  }
  // Escaped as a workflow command's message is.
  const message = text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  console.warn(`::warning title=Test folder left behind::${message}`)
}
