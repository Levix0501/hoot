import fs from 'node:fs'
import path from 'node:path'
import type { World } from './world'

/** Writes a Node.js program with the given body and returns the path of its executable file. */
export function writeProgram(world: World, name: string, body: string): string {
  const directory = path.join(world.root, 'programs')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 })
  return file
}

/**
 * A program that records every byte it receives on its terminal, as hex, in
 * `bytesFile`. Ctrl+C ends it without being recorded.
 */
export function writeByteRecorder(world: World): { command: string; bytesFile: string } {
  const bytesFile = path.join(world.records, 'received-bytes.txt')
  const command = writeProgram(
    world,
    'byte-recorder',
    `const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(bytesFile)}, '')
process.stdin.setRawMode(true)
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte === 3) process.exit(0)
    fs.appendFileSync(${JSON.stringify(bytesFile)}, byte.toString(16).padStart(2, '0'))
  }
})
process.stdout.write('recorder ready\\r\\n')
`,
  )
  return { command, bytesFile }
}

/** A program that turns on mouse reporting (DEC modes 1000 and 1006) and prints what it receives. */
export function writeMouseReporter(world: World): string {
  return writeProgram(
    world,
    'mouse-reporter',
    `process.stdin.setRawMode(true)
process.stdout.write('\\x1b[?1000h\\x1b[?1006h')
process.stdin.on('data', (chunk) => {
  if (chunk.includes(3)) {
    process.stdout.write('\\x1b[?1000l\\x1b[?1006l')
    process.exit(0)
  }
  process.stdout.write('GOT ' + JSON.stringify(chunk.toString('latin1')) + '\\r\\n')
})
process.stdout.write('reporter ready\\r\\n')
`,
  )
}

/**
 * A program that shows every byte it receives, as it receives it: printable
 * characters as they are and others as `<hex>`. Ctrl+C ends it.
 */
export function writeEchoProgram(world: World): string {
  return writeProgram(
    world,
    'echo-input',
    `process.stdin.setRawMode(true)
process.stdout.write('echo ready\\r\\n')
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte === 3) {
      process.stdout.write('\\r\\n')
      process.exit(0)
    }
    process.stdout.write(
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '<' + byte.toString(16).padStart(2, '0') + '>',
    )
  }
})
`,
  )
}
