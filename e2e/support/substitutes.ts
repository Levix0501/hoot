import fs from 'node:fs'
import path from 'node:path'

export interface SubstituteRecord {
  name: string
  /** Arguments after the command itself. */
  args: string[]
  cwd: string
  env: Record<string, string>
  pid: number
  /** Columns and rows of its terminal, updated when the terminal is resized. */
  size: [columns: number, rows: number]
}

/** One execution of a substitute command. */
export interface SubstituteRun {
  /** Arguments after the command itself. */
  args: string[]
  pid: number
}

/**
 * What a substitute does after recording: keep running, exit with code 0, or
 * print an error and exit with code 1 like a tool that rejects its arguments.
 */
export type SubstituteBehavior = 'stay' | 'exit' | 'fail'

/** The line a failing substitute prints before it exits. */
export function substituteError(command: string): string {
  return `error: substitute ${command} rejected its arguments`
}

/** The file whose new content a substitute prints, as it is appended: the prefix, its pid and `.say`. */
function sayFilePrefix(records: string, command: string): string {
  return path.join(records, `${command}-`)
}

/**
 * Makes a running substitute print `text` (for example control sequences that
 * set the terminal title). The substitute is the run with this pid, see
 * `readRuns`; it prints the text within a few tens of milliseconds.
 */
export function say(records: string, command: string, pid: number, text: string): void {
  fs.appendFileSync(`${sayFilePrefix(records, command)}${pid}.say`, text)
}

/**
 * Makes a running substitute exit with code 0, as a tool does when the user
 * quits it. The substitute is the run with this pid, see `readRuns`.
 */
export function quitSubstitute(pid: number): void {
  process.kill(pid, 'SIGUSR2')
}

/**
 * Writes an executable stand-in for a tool command. Every execution appends
 * its arguments and pid to a run log in `records`. It also records the
 * arguments, working directory, environment and terminal size it received
 * (recording the size again whenever it changes), prints a line, and then
 * behaves as `behavior` says. One that stays prints what `say` gives it, and
 * exits with code 0 when `quitSubstitute` tells it to.
 */
export function writeSubstitute(
  directory: string,
  command: string,
  records: string,
  behavior: SubstituteBehavior = 'stay',
): string {
  const file = path.join(directory, command)
  const recordFile = path.join(records, `${command}.json`)
  const runsFile = path.join(records, `${command}.runs.jsonl`)
  const ending = {
    stay: `process.stdout.write('substitute ${command} started\\r\\n')
process.on('SIGUSR2', () => process.exit(0))
const sayFile = ${JSON.stringify(sayFilePrefix(records, command))} + process.pid + '.say'
let said = 0
setInterval(() => {
  let text
  try {
    text = fs.readFileSync(sayFile)
  } catch {
    return
  }
  if (text.length > said) {
    process.stdout.write(text.subarray(said))
    said = text.length
  }
}, 20)`,
    exit: `process.stdout.write('substitute ${command} started\\r\\n')
process.exit(0)`,
    fail: `process.stdout.write(${JSON.stringify(`${substituteError(command)}\r\n`)})
process.exit(1)`,
  }[behavior]
  const script = `#!${process.execPath}
const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(runsFile)}, JSON.stringify({ args: process.argv.slice(2), pid: process.pid }) + '\\n')
const record = {
  name: ${JSON.stringify(command)},
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  pid: process.pid,
  size: [process.stdout.columns, process.stdout.rows],
}
// Replaced in one step so that a reader never sees a partly written record,
// through a file of this run's own, which another run saving at the same time
// cannot take away.
const temporary = ${JSON.stringify(recordFile)} + '.' + process.pid + '.tmp'
const save = () => {
  fs.writeFileSync(temporary, JSON.stringify(record))
  fs.renameSync(temporary, ${JSON.stringify(recordFile)})
}
save()
process.stdout.on('resize', () => {
  record.size = [process.stdout.columns, process.stdout.rows]
  save()
})
${ending}
`
  fs.writeFileSync(file, script, { mode: 0o755 })
  return file
}

export function readRecord(records: string, command: string): SubstituteRecord | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(records, `${command}.json`), 'utf8'),
    ) as SubstituteRecord
  } catch {
    return null
  }
}

/** Every execution of the substitute command so far, oldest first. */
export function readRuns(records: string, command: string): SubstituteRun[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(records, `${command}.runs.jsonl`), 'utf8')
  } catch {
    return []
  }
  // Only complete lines: the last one may still be being written.
  return text
    .split('\n')
    .slice(0, -1)
    .map((line) => JSON.parse(line) as SubstituteRun)
}
