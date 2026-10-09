import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Env } from './env'

export interface ResolveLoginShellEnvOptions {
  /** Absolute path of the user's default shell. */
  shell: string
  /** Environment the shell starts from (the graphical login session environment). */
  baseEnv: Env
  /** Working directory of the probing shell. */
  cwd: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const STDERR_LIMIT = 4_000

/** Parses the output of `env -0`. */
export function parseEnvOutput(text: string): Env {
  const env: Env = {}
  for (const entry of text.split('\0')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return env
}

/**
 * Starts the user's default shell as an interactive login shell from
 * `baseEnv`, lets it run its startup files, and returns every environment
 * variable the shell has afterwards (including PATH).
 */
export function resolveLoginShellEnv(options: ResolveLoginShellEnvOptions): Promise<Env> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const mark = `__hoot_env_${randomBytes(8).toString('hex')}__`
  const command = `printf '%s' '${mark}'; /usr/bin/env -0; printf '%s' '${mark}'`

  return new Promise((resolve, reject) => {
    const child = spawn(options.shell, ['-i', '-l', '-c', command], {
      cwd: options.cwd,
      env: options.baseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    const stdout: Buffer[] = []
    let stderr = ''
    let settled = false

    const finish = (error: Error | null, env?: Env) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(env ?? {})
    }

    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The shell already exited.
      }
      finish(new Error(`Timed out after ${timeoutMs} ms while starting ${options.shell}.`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const start = output.indexOf(mark)
      const end = output.lastIndexOf(mark)
      if (start === -1 || end <= start) {
        const status = signal ? `signal ${signal}` : `code ${code}`
        const detail = stderr.trim()
        finish(
          new Error(
            `${options.shell} exited with ${status} before reporting its environment.` +
              (detail ? ` ${detail}` : ''),
          ),
        )
        return
      }
      finish(null, parseEnvOutput(output.slice(start + mark.length, end)))
    })
  })
}
