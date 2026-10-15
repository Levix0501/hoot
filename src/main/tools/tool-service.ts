import { EventEmitter } from 'node:events'
import type { ToolAvailability, ToolsState } from '../../shared/ipc'
import { TOOLS } from '../../shared/tools'
import type { Env } from '../env/env'
import { resolveLoginShellEnv } from '../env/login-shell-env'
import { findAgentCommand } from './find-command'

export interface ToolServiceOptions {
  /** The program of the shell Shell sessions run, whose login environment is read outside Windows. */
  shell: string
  baseEnv: Env
  cwd: string
  /**
   * Hoot's folder of agents' commands, where a coding tool that is not on the
   * login shell PATH is looked for; `null` where Hoot has none, as on Windows.
   */
  agentsBinDirectory?: string | null
  /** Replaceable for tests. */
  resolveEnv?: typeof resolveLoginShellEnv
  platform?: NodeJS.Platform
}

export interface LoginEnvironment {
  env: Env
  /** Set when the login shell environment could not be read and `env` is the base environment. */
  error: string | null
}

/** What a detection found, and the login shell environment it read to find it. */
export interface Detection {
  state: ToolsState
  login: LoginEnvironment
}

/**
 * Reads the login shell environment (on Windows, takes the one Hoot started
 * with) and checks which tools can be found: on its PATH, or else, for a
 * coding tool, in Hoot's folder of agents. Detection runs at startup and
 * again whenever the user asks for it, or an agent has been installed or
 * updated.
 */
export class ToolService extends EventEmitter<{ changed: [ToolsState] }> {
  private state: ToolsState = { detecting: false, tools: [], error: null }
  private login: LoginEnvironment | null = null
  private running: Promise<Detection> | null = null
  /** The detection that starts once the running one ends. */
  private queued: Promise<Detection> | null = null

  constructor(private readonly options: ToolServiceOptions) {
    super()
  }

  getState(): ToolsState {
    return this.state
  }

  /** Re-reads the login shell environment and re-checks every tool. */
  async detect(): Promise<ToolsState> {
    return (await this.detectWithEnvironment()).state
  }

  /**
   * Re-reads the login shell environment and re-checks every tool, in a
   * detection that starts no earlier than this call, so that it sees what
   * changed before it: while one runs, the next starts once it ends, for
   * every call made meanwhile.
   */
  detectWithEnvironment(): Promise<Detection> {
    if (this.queued) return this.queued
    const running = this.running
    if (!running) return this.start()
    const startNext = () => {
      this.queued = null
      return this.start()
    }
    const queued = running.then(startNext, startNext)
    this.queued = queued
    return queued
  }

  /** The most recently read login shell environment, detecting first if needed. */
  async getLoginEnvironment(): Promise<LoginEnvironment> {
    if (this.running) await this.running
    if (!this.login) await this.detect()
    return this.login ?? { env: this.options.baseEnv, error: 'Not detected.' }
  }

  /** Waits for a running detection and returns the current state. */
  async settledState(): Promise<ToolsState> {
    if (this.running) return (await this.running).state
    if (!this.login) return this.detect()
    return this.state
  }

  private start(): Promise<Detection> {
    this.setState({ ...this.state, detecting: true })
    const running = this.runDetection().finally(() => {
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }

  /**
   * The login shell environment, or the base environment when it could not
   * be read. On Windows, the base environment, without starting a shell:
   * Windows gives every app the user's environment, which no shell's startup
   * files change, and the one shell SHELL names there, Git Bash's when it
   * started Hoot, gives PATH and HOME in a form of its own, such as
   * `/c/Users/me`, which Windows programs cannot read.
   */
  private async readLoginEnvironment(): Promise<LoginEnvironment> {
    if ((this.options.platform ?? process.platform) === 'win32') {
      return { env: this.options.baseEnv, error: null }
    }
    const resolveEnv = this.options.resolveEnv ?? resolveLoginShellEnv
    try {
      const env = await resolveEnv({
        shell: this.options.shell,
        baseEnv: this.options.baseEnv,
        cwd: this.options.cwd,
      })
      return { env, error: null }
    } catch (error) {
      return {
        env: this.options.baseEnv,
        error: `Could not read the login shell environment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  private async runDetection(): Promise<Detection> {
    const login = await this.readLoginEnvironment()
    this.login = login

    const agentsBin = this.options.agentsBinDirectory ?? null
    const tools: ToolAvailability[] = await Promise.all(
      TOOLS.map(async (tool) => {
        if (!tool.command) return { id: tool.id, available: true, path: this.options.shell }
        const found = await findAgentCommand(tool.command, login.env, agentsBin)
        return { id: tool.id, available: found !== null, path: found }
      }),
    )
    const state: ToolsState = { detecting: false, tools, error: login.error }
    this.setState(state)
    return { state, login }
  }

  private setState(state: ToolsState): void {
    this.state = state
    this.emit('changed', state)
  }
}
