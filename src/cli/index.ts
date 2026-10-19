// hoot, Hoot's command line program. Hoot's own executable runs it as Node.js
// (ELECTRON_RUN_AS_NODE), started by the launchers in resources/bin, which
// Hoot puts first on the PATH of every session it starts.
import { readFile } from 'node:fs/promises'
import { runHoot } from './program'

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

process.exitCode = await runHoot(process.argv.slice(2), {
  env: process.env,
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  readStdin,
  readFile: (file) => readFile(file),
  startedAt: performance.timeOrigin,
})
