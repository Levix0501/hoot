import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { Env } from '../env/env'

/** A command to run: the file, its arguments, its environment and its working directory. */
export interface CommandSpec {
  file: string
  args: string[]
  env: Env
  cwd: string
}

/** How a process ended. */
export interface ProcessEnd {
  /** Its exit code when it exited, otherwise `null`. */
  code: number | null
  /** The signal that ended it, otherwise `null`. */
  signal: NodeJS.Signals | null
  /** Why it could not be started, if it could not. */
  error: Error | null
}

/** A process that Hoot started, until it has ended. */
export interface RunningProcess {
  /** Sends the process a signal, while it runs. */
  signal(signal: NodeJS.Signals): void
  /** Settles once the process has ended, and what it wrote has been passed on. */
  ended: Promise<ProcessEnd>
}

/**
 * Starts a command with nothing on its standard input, and passes on what it
 * writes to its standard output and standard error, as UTF-8 text, in the
 * order it arrives.
 */
export function startProcess(spec: CommandSpec, onOutput: (text: string) => void): RunningProcess {
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(spec.file, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error))
    return { signal: () => {}, ended: Promise.resolve({ code: null, signal: null, error: reason }) }
  }
  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new StringDecoder('utf8')
    stream?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      if (text) onOutput(text)
    })
    stream?.on('end', () => {
      const rest = decoder.end()
      if (rest) onOutput(rest)
    })
  }
  const ended = new Promise<ProcessEnd>((resolve) => {
    let settled = false
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({ code: null, signal: null, error })
    })
    // After its output has ended, unlike `exit`.
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, error: null })
    })
  })
  return {
    signal: (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    },
    ended,
  }
}

/** How a command that was run to its end ended, and what it wrote. */
export interface CommandResult extends ProcessEnd {
  /** What it wrote to its standard output. */
  stdout: string
  /** What it wrote to its standard output and its standard error, in the order it arrived. */
  output: string
  /** Whether it was stopped because it took too long. */
  timedOut: boolean
}

/**
 * Runs a command to its end and returns what it wrote. A command that is not
 * done within `timeoutMs` is ended with SIGKILL, together with the processes
 * it started, which could otherwise keep its output open.
 */
export async function runCommand(spec: CommandSpec, timeoutMs: number): Promise<CommandResult> {
  let stdout = ''
  let output = ''
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(spec.file, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // In a process group of its own, which a timeout ends.
      detached: true,
    })
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error))
    return { code: null, signal: null, error: reason, stdout, output, timedOut: false }
  }
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = stdoutDecoder.write(chunk)
    stdout += text
    output += text
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += stderrDecoder.write(chunk)
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      // It has ended meanwhile.
      child.kill('SIGKILL')
    }
  }, timeoutMs)
  const end = await new Promise<ProcessEnd>((resolve) => {
    let settled = false
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({ code: null, signal: null, error })
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, error: null })
    })
  })
  clearTimeout(timer)
  const rest = stdoutDecoder.end()
  stdout += rest
  output += rest + stderrDecoder.end()
  return { ...end, stdout, output, timedOut }
}
