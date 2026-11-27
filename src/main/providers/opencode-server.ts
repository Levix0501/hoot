import { spawn as spawnProcess, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { setEnvVariable, type Env } from '../env/env'
import { commandProgram } from '../tools/command-program'
import { writeHootOpenCodeConfig, type OpenCodeServer } from './opencode-config'

/** How long OpenCode may take to say where its server listens. */
const START_TIMEOUT_MS = 30_000

/** How long a server may take to end as Hoot quits before it is made to. */
const STOP_TIMEOUT_MS = 2_000

/** How long Hoot waits for a server a Hoot that did not quit left running to answer. */
const LEFT_OVER_TIMEOUT_MS = 2_000

/** The user name a server of OpenCode's takes its password with. */
const SERVER_USER = 'opencode'

/** How much of a server's output Hoot keeps, for the error of one that did not start. */
const OUTPUT_KEPT = 8_192

/** A server that runs, as Hoot notes it for the next Hoot (see `OpenCodeServersOptions.stateFile`). */
interface NotedServer extends OpenCodeServer {
  pid: number
}

interface Running {
  server: OpenCodeServer
  child: ChildProcess
}

export interface OpenCodeServersOptions {
  /**
   * The file of Hoot's configuration of OpenCode, which its servers take
   * besides the user's own (see `hootOpenCodeConfig`).
   */
  configFile: string
  /** Hoot's configuration of OpenCode as it is now. */
  config(): unknown
  /**
   * Where Hoot notes the servers that run, so that those a Hoot that did not
   * quit left running are stopped as the next one starts.
   */
  stateFile: string
  /** The folder its servers run in. */
  cwd: string
  spawn?: typeof spawnProcess
  fetch?: typeof fetch
}

/** The last line a program wrote that holds something; `''` for none. */
function lastLine(output: string): string {
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .findLast((line) => line !== '') ?? ''
  )
}

/**
 * The servers of OpenCode's that Hoot runs for its own sessions of OpenCode,
 * with `opencode serve`: one for each OpenCode it runs, by its command and
 * the file that leads to, which an update replaces, each on a port of the
 * computer's own address that the system picks, asking for a password of its
 * own. Each takes Hoot's configuration of OpenCode, the user's providers,
 * from its file (`OPENCODE_CONFIG`), besides the user's own configuration,
 * and reads either again as it changes. The user's own background service is
 * left alone. A server starts when a session first needs it, again for the
 * next one after it ended, and stops as Hoot quits.
 */
export class OpenCodeServers {
  private readonly running = new Map<string, Promise<Running>>()
  private readonly spawn: typeof spawnProcess
  private readonly fetch: typeof fetch
  /** The configuration's text as it was last written; `null` before the first write. */
  private written: string | null = null
  /** The servers a Hoot that did not quit left running being stopped (see `stopLeftOver`). */
  private leftOver: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeServersOptions) {
    this.spawn = options.spawn ?? spawnProcess
    this.fetch = options.fetch ?? fetch
  }

  /** The server for the OpenCode at `command`: the one that runs for it, else a new one. */
  async ensure(command: string, env: Env): Promise<OpenCodeServer> {
    await this.leftOver
    const key = await this.keyOf(command)
    let running = this.running.get(key)
    if (running === undefined) {
      const started = this.start(command, env, key)
      running = started
      this.running.set(key, started)
      started.catch(() => {
        if (this.running.get(key) === started) this.running.delete(key)
      })
    }
    return (await running).server
  }

  /**
   * Writes Hoot's configuration of OpenCode again while a server runs, which
   * reads it again: as the user's providers, or what models.dev tells of
   * their models, change.
   */
  async configChanged(): Promise<void> {
    if (this.running.size === 0) return
    await this.writeConfig()
  }

  /**
   * Stops every server Hoot runs, as it quits, those that do not end in a
   * moment by force, then removes its configuration of OpenCode, which holds
   * keys.
   */
  async stopAll(): Promise<void> {
    const running = await Promise.all(
      [...this.running.values()].map((started) => started.catch(() => null)),
    )
    this.running.clear()
    await Promise.all(running.flatMap((entry) => (entry === null ? [] : [stopChild(entry.child)])))
    this.written = null
    await Promise.all([
      fs.rm(this.options.stateFile, { force: true }),
      fs.rm(this.options.configFile, { force: true }),
    ]).catch(() => {})
  }

  /**
   * Stops the servers a Hoot that did not quit left running, as it notes them
   * (see `OpenCodeServersOptions.stateFile`), and removes the configuration
   * they took, as the one Hoot that runs starts; a server of its own waits
   * for that. A server is stopped only where it still answers at its address
   * as one of Hoot's does: asking for a password, and taking Hoot's, so that
   * no other program is stopped in its place.
   */
  stopLeftOver(): Promise<void> {
    this.leftOver = this.stopNoted()
    return this.leftOver
  }

  /** Stops the servers noted (see `stopLeftOver`). */
  private async stopNoted(): Promise<void> {
    const noted = await fs
      .readFile(this.options.stateFile, 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null)
    const servers = Array.isArray(noted) ? noted.filter(isNotedServer) : []
    await Promise.all(
      servers.map(async (server) => {
        if (await this.answersAsHoots(server)) {
          try {
            process.kill(server.pid)
          } catch {
            // Gone meanwhile.
          }
        }
      }),
    )
    await Promise.all([
      fs.rm(this.options.stateFile, { force: true }),
      fs.rm(this.options.configFile, { force: true }),
    ]).catch(() => {})
  }

  /** What tells the servers of two OpenCodes apart: the command and the file it leads to. */
  private async keyOf(command: string): Promise<string> {
    const file = await fs.stat(command).catch(() => null)
    return `${command}\n${file?.mtimeMs ?? ''}\n${file?.size ?? ''}`
  }

  /** Starts a server of the OpenCode at `command`, with Hoot's configuration written first. */
  private async start(command: string, env: Env, key: string): Promise<Running> {
    await this.writeConfig()
    const program = await commandProgram(command, env)
    const password = randomBytes(32).toString('base64url')
    const serverEnv = { ...env }
    setEnvVariable(serverEnv, 'OPENCODE_CONFIG', this.options.configFile)
    setEnvVariable(serverEnv, 'OPENCODE_SERVER_PASSWORD', password)
    const child = this.spawn(
      program.file,
      [...program.args, 'serve', '--port', '0', '--hostname', '127.0.0.1'],
      {
        cwd: this.options.cwd,
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    const url = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('OpenCode did not start its server in time.'))
      }, START_TIMEOUT_MS)
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-OUTPUT_KEPT)
        const listening = /listening on (http:\/\/\S+)/.exec(output)
        if (listening !== null) {
          clearTimeout(timer)
          resolve(listening[1]!)
        }
      }
      child.stdout?.on('data', read)
      child.stderr?.on('data', read)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        const reason = lastLine(output)
        reject(new Error(reason === '' ? `It exited with ${code ?? signal}.` : reason))
      })
    })
    const running: Running = { server: { url, password }, child }
    // One that ends is started again for the next session that needs it.
    child.once('exit', () => {
      void (async () => {
        const current = this.running.get(key)
        if (current !== undefined && (await current.catch(() => null)) === running) {
          this.running.delete(key)
        }
        await this.noteServers()
      })()
    })
    void this.noteServers()
    return running
  }

  /** Writes Hoot's configuration of OpenCode, when it changed since it was last written. */
  private async writeConfig(): Promise<void> {
    const config = this.options.config()
    const text = JSON.stringify(config)
    if (text === this.written) return
    await writeHootOpenCodeConfig(this.options.configFile, config)
    this.written = text
  }

  /** Notes the servers that run for the next Hoot (see `OpenCodeServersOptions.stateFile`). */
  private async noteServers(): Promise<void> {
    const running = await Promise.all(
      [...this.running.values()].map((started) => started.catch(() => null)),
    )
    const noted: NotedServer[] = running.flatMap((entry) =>
      entry === null || entry.child.pid === undefined || entry.child.exitCode !== null
        ? []
        : [{ ...entry.server, pid: entry.child.pid }],
    )
    try {
      if (noted.length === 0) await fs.rm(this.options.stateFile, { force: true })
      else await fs.writeFile(this.options.stateFile, JSON.stringify(noted), { mode: 0o600 })
    } catch (error) {
      console.error("Could not note Hoot's OpenCode servers:", error)
    }
  }

  /**
   * Whether a server answers at its address as one of Hoot's does: refusing
   * a request without its password, and taking one with it.
   */
  private async answersAsHoots(server: OpenCodeServer): Promise<boolean> {
    const status = async (password: string | null) => {
      const headers: Record<string, string> =
        password === null
          ? {}
          : {
              authorization: `Basic ${Buffer.from(`${SERVER_USER}:${password}`).toString('base64')}`,
            }
      const answer = await this.fetch(new URL('/api/info', server.url), {
        headers,
        signal: AbortSignal.timeout(LEFT_OVER_TIMEOUT_MS),
      })
      await answer.body?.cancel()
      return answer.status
    }
    try {
      return (await status(null)) === 401 && (await status(server.password)) === 200
    } catch {
      return false
    }
  }
}

function isNotedServer(value: unknown): value is NotedServer {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.url === 'string' &&
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(entry.url) &&
    typeof entry.password === 'string' &&
    typeof entry.pid === 'number' &&
    Number.isInteger(entry.pid) &&
    entry.pid > 0
  )
}

/** Ends a server's process, by force where it does not end in a moment. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill()
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS)
  await ended
  clearTimeout(timer)
}
