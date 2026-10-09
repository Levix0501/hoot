import { EventEmitter } from 'node:events'
import type { ToolAvailability, ToolsState } from '../../shared/ipc'
import { TOOLS } from '../../shared/tools'
import type { Env } from '../env/env'
import { resolveLoginShellEnv } from '../env/login-shell-env'
import { findCommand } from './find-command'

export interface ToolServiceOptions {
  shell: string
  baseEnv: Env
  cwd: string
  /** Replaceable for tests. */
  resolveEnv?: typeof resolveLoginShellEnv
}

export interface LoginEnvironment {
  env: Env
  /** Set when the login shell environment could not be read and `env` is the base environment. */
  error: string | null
}

/**
 * Reads the login shell environment and checks which tools can be found in its
 * PATH. Detection runs at startup and again whenever the user asks for it.
 */
export class ToolService extends EventEmitter<{ changed: [ToolsState] }> {
  private state: ToolsState = { detecting: false, tools: [], error: null }
  private login: LoginEnvironment | null = null
  private running: Promise<ToolsState> | null = null

  constructor(private readonly options: ToolServiceOptions) {
    super()
  }

  getState(): ToolsState {
    return this.state
  }

  /** Re-reads the login shell environment and re-checks every tool. */
  detect(): Promise<ToolsState> {
    if (this.running) return this.running
    this.setState({ ...this.state, detecting: true })
    this.running = this.runDetection().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** The most recently read login shell environment, detecting first if needed. */
  async getLoginEnvironment(): Promise<LoginEnvironment> {
    if (this.running) await this.running
    if (!this.login) await this.detect()
    return this.login ?? { env: this.options.baseEnv, error: 'Not detected.' }
  }

  /** Waits for a running detection and returns the current state. */
  async settledState(): Promise<ToolsState> {
    if (this.running) return this.running
    if (!this.login) return this.detect()
    return this.state
  }

  private async runDetection(): Promise<ToolsState> {
    const resolveEnv = this.options.resolveEnv ?? resolveLoginShellEnv
    let login: LoginEnvironment
    try {
      const env = await resolveEnv({
        shell: this.options.shell,
        baseEnv: this.options.baseEnv,
        cwd: this.options.cwd,
      })
      login = { env, error: null }
    } catch (error) {
      login = {
        env: this.options.baseEnv,
        error: `Could not read the login shell environment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
    this.login = login

    const tools: ToolAvailability[] = await Promise.all(
      TOOLS.map(async (tool) => {
        if (!tool.command) return { id: tool.id, available: true, path: this.options.shell }
        const found = await findCommand(tool.command, login.env.PATH)
        return { id: tool.id, available: found !== null, path: found }
      }),
    )
    const state: ToolsState = { detecting: false, tools, error: login.error }
    this.setState(state)
    return state
  }

  private setState(state: ToolsState): void {
    this.state = state
    this.emit('changed', state)
  }
}
