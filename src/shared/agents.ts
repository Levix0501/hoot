import { gt, valid } from 'semver'
import type { CodingToolId } from './tools'

/**
 * How an agent was installed, as Hoot tells from the file its command leads
 * to: by npm into a global folder, by Hoot into its own folder, by Homebrew,
 * by the agent's official installer, or some other way.
 */
export type InstallMethod = 'npm' | 'hoot' | 'homebrew' | 'official' | 'unknown'

/** The installation of an agent that Hoot finds, which its sessions run. */
export interface AgentInstallation {
  /** The command's absolute path. */
  path: string
  /** The same path, with `~` for the home folder. */
  displayPath: string
  method: InstallMethod
  /** The version the command reports; `null` when it does not run. */
  version: string | null
  /** What the command wrote when it was run with `--version`, kept when it does not run. */
  versionOutput: string
}

/** An install or an update of an agent, started from the Agents page. */
export type AgentOperationKind = 'install' | 'update'

/**
 * Where an install or an update is: waiting for the one before it, running
 * (with the last line of what its command wrote so far, and whether it was
 * cancelled and waits for its command to end), or ended. An ended
 * operation's message is the result as the Agents page writes it.
 */
export type AgentOperation =
  | { kind: AgentOperationKind; status: 'waiting' }
  | { kind: AgentOperationKind; status: 'running'; lastLine: string; cancelling: boolean }
  | { kind: AgentOperationKind; status: 'succeeded'; message: string }
  | {
      kind: AgentOperationKind
      status: 'failed'
      message: string
      /** The last lines of what its command wrote. */
      tail: string[]
      /** Everything its command wrote, as a terminal would show it at the end. */
      output: string
    }
  | { kind: AgentOperationKind; status: 'cancelled' }

export interface AgentState {
  id: CodingToolId
  /** Whether its installation, its version or its latest version is being read. */
  checking: boolean
  /** `null` when it is not installed, or before it was first looked for. */
  installation: AgentInstallation | null
  /** The latest version on registry.npmjs.org, once read. */
  latest: string | null
  /** Whether the last attempt to read the latest version failed. */
  latestFailed: boolean
  /** Its operation that waits, runs, or ended last since Hoot started. */
  operation: AgentOperation | null
}

/**
 * Where Install puts an agent: in the global folder of the computer's npm,
 * when it can use that npm, or else in Hoot's folder of agents.
 */
export type InstallTarget =
  | { kind: 'npm'; prefix: string; displayPrefix: string }
  | { kind: 'hoot'; directory: string; displayDirectory: string }

export interface AgentsState {
  /** Claude Code, Codex and OpenCode, in this order. */
  agents: AgentState[]
  /** Where Install puts an agent; `null` until it is known. */
  installTarget: InstallTarget | null
}

/** One operation that the quit confirmation tells about. */
export interface AgentOperationSummary {
  /** The agent's name, such as Claude Code. */
  label: string
  kind: AgentOperationKind
  /** Whether it waits for the one before it, rather than running. */
  waiting: boolean
}

/**
 * The line that puts the commands in Hoot's folder of agents on PATH, for zsh
 * and bash, which the Agents page copies for whoever wants them outside Hoot.
 */
export const AGENTS_PATH_COMMAND = 'export PATH="$HOME/.hoot/agents/bin:$PATH"'

/**
 * The version a command reports in what it writes for `--version`, such as
 * 2.1.293 in "2.1.293 (Claude Code)" or 0.161.0 in "codex-cli 0.161.0".
 */
export function parseVersion(output: string): string | null {
  for (const match of output.matchAll(
    /(?<![\w.])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?![\w.])/g,
  )) {
    const version = match[1] ?? ''
    if (valid(version)) return version
  }
  return null
}

/** Whether `latest` is a newer version than `installed`, by the rules of semantic versioning. */
export function isNewerVersion(latest: string, installed: string): boolean {
  return valid(latest) !== null && valid(installed) !== null && gt(latest, installed)
}

/** How the Agents page writes an install method; `null` where it writes none. */
export function installMethodLabel(method: InstallMethod): string | null {
  switch (method) {
    case 'npm':
      return 'npm'
    case 'hoot':
      return "Installed by Hoot · only in Hoot's sessions"
    case 'homebrew':
      return 'Homebrew'
    case 'official':
      return 'Official installer'
    case 'unknown':
      return null
  }
}

/** The result of an install that succeeded. */
export function installedMessage(version: string): string {
  return `✓ Installed ${version}`
}

/**
 * The result of an update that succeeded, which says how many sessions that
 * started before it still run the version before it.
 */
export function updatedMessage(version: string, stillRunning: number, previous: string): string {
  if (stillRunning === 0) return `✓ Updated to ${version}`
  return stillRunning === 1
    ? `✓ Updated to ${version}. 1 running session still uses ${previous}.`
    : `✓ Updated to ${version}. ${stillRunning} running sessions still use ${previous}.`
}

/** The result of an operation that failed, for a reason. */
export function failedMessage(kind: AgentOperationKind, reason: string): string {
  return `✕ ${kind === 'install' ? 'Install' : 'Update'} failed: ${reason}`
}

/** The result of an operation that was cancelled. */
export const CANCELLED_MESSAGE = 'Cancelled'
