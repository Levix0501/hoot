import { gt, valid } from 'semver'
import type { CodingToolId } from './tools'

/**
 * How an agent was installed, as Hoot tells from the file its command leads
 * to: by npm into a global folder, by Homebrew, by the agent's official
 * installer, or some other way.
 */
export type InstallMethod = 'npm' | 'homebrew' | 'official' | 'unknown'

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
  /**
   * The command Update runs, as the Agents page shows it (see
   * `shownCommand`); `null` where Hoot cannot tell how it was installed.
   */
  updateCommand: string | null
  /** The command that read its version, as the Agents page shows it. */
  versionCommand: string
  /**
   * Whether updating it can write where it is: for an installation by npm,
   * whether the user can create files in its global folder, where npm puts
   * packages and their commands; `true` for the others, which Hoot does not
   * check.
   */
  writable: boolean
}

/**
 * A Node.js requirement that the computer does not meet: the versions an
 * agent's latest version needs, as its npm package's `engines` field says,
 * and the version of the node its sessions would run it with, the first on
 * the login shell PATH.
 */
export interface UnmetNodeRequirement {
  range: string
  found: string
}

/** An install or an update of an agent, started from the Agents page. */
export type AgentOperationKind = 'install' | 'update'

/**
 * Where an install or an update is: waiting for the one before it, running
 * (with the last line of what its command wrote so far, and whether Cancel can
 * still stop it: not once it was cancelled and waits for its command to end,
 * nor once its command has ended and the agent is read again), or ended. An
 * ended operation's message is the result as the Agents page writes it.
 */
export type AgentOperation =
  | { kind: AgentOperationKind; status: 'waiting' }
  | { kind: AgentOperationKind; status: 'running'; cancellable: boolean }
  | { kind: AgentOperationKind; status: 'succeeded'; message: string }
  | {
      kind: AgentOperationKind
      status: 'failed'
      message: string
      /** The last lines of what its command wrote. */
      tail: string[]
      /** Everything its command wrote, as a terminal would show it at the end. */
      output: string
      /** The command that ran, as the Agents page shows it; `null` when none ran. */
      command: string | null
      /** Its exit code when it exited, otherwise `null`. */
      exitCode: number | null
    }
  | { kind: AgentOperationKind; status: 'cancelled' }

/** A model a session can start with, and the effort levels it supports. */
export interface AgentModelOption {
  /** The value the agent's model argument gets: an alias or a model ID. */
  value: string
  /** What the Agents page writes for the option. */
  label: string
  /** The effort levels the model supports, in the agent's order. */
  efforts: string[]
}

/** The models, and Default's effort levels, that a detection read from an agent. */
export interface AgentLaunchOptions {
  models: AgentModelOption[]
  /** The effort levels of the model a session uses when none is selected. */
  defaultEfforts: string[]
}

export interface AgentState {
  id: CodingToolId
  /** Whether its installation, version, latest version or launch options are being read. */
  checking: boolean
  /** Whether its installation has been looked for at least once. */
  detected: boolean
  /** `null` when it is not installed, or before it was first looked for. */
  installation: AgentInstallation | null
  /** The latest version on registry.npmjs.org, once read. */
  latest: string | null
  /** Whether the last attempt to read the latest version failed. */
  latestFailed: boolean
  /**
   * The command Install runs, as the Agents page shows it (see
   * `shownCommand`); `null` where Install cannot run, the computer having no
   * npm that the user can install with.
   */
  installCommand: string | null
  /**
   * The Node.js its latest version needs, where npm would install it, when
   * its command runs on Node.js and the node its sessions would run it with
   * is too old; `null` otherwise, also when either is not known. Where it is
   * installed some other way, as by Homebrew, npm's package does not apply.
   */
  nodeRequirement: UnmetNodeRequirement | null
  /** Its operation that waits, runs, or ended last since Hoot started. */
  operation: AgentOperation | null
  /**
   * The models, and Default's effort levels, that the last detection read
   * from the agent's own configuration; `null` where Hoot offers no model
   * choice, as for OpenCode.
   */
  launchOptions: AgentLaunchOptions | null
}

/**
 * Where Install puts an agent: in the global folder of the computer's npm,
 * when the user can install into it; otherwise nowhere, the computer having
 * no npm that runs, or one whose global folder the user cannot write to.
 */
export type InstallTarget =
  | { kind: 'npm'; prefix: string; displayPrefix: string }
  | { kind: 'npm-not-writable'; prefix: string; displayPrefix: string }
  | { kind: 'node-required' }

export interface AgentsState {
  /** Claude Code, Codex and OpenCode, in this order. */
  agents: AgentState[]
  /** Where Install puts an agent; `null` until it is known. */
  installTarget: InstallTarget | null
  /** Whether a detection is running. */
  detecting: boolean
  /** When the last detection started, on Hoot's clock; `null` before the first. */
  detectedAt: number | null
  /** The settings Hoot gives Claude Code, as its `--settings` argument. */
  claudeHookSettings: string
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
 * What the Agents page says about Install where the computer has no npm that
 * runs: agents are installed with the npm that comes with Node.js.
 */
export const INSTALL_NEEDS_NODE_MESSAGE = 'Install needs Node.js and npm'

/**
 * What the Agents page says about Install where the user cannot write to the
 * global folder of the computer's npm, which an agent's row also names.
 */
export const INSTALL_NEEDS_WRITE_ACCESS_MESSAGE = "Install needs write access to npm's folder"

/**
 * Why Update cannot update an installation by npm where the user cannot
 * write to its global folder, as the agent's row writes it after the path.
 */
export const FOLDER_NOT_WRITABLE_MESSAGE = "npm's folder isn't writable"

/**
 * A command as the Agents page shows it: the program, written as a user
 * would run it, with `~` for the home folder, and its arguments, each in
 * double quotes where it has a space.
 */
export function shownCommand(parts: string[]): string {
  return parts.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ')
}

/**
 * The Node.js versions a range names, as the Agents page writes them:
 * `22.19.0 or later` for `>=22.19.0`, and any other range as it is written.
 */
export function nodeVersionsText(range: string): string {
  const atLeast = /^>=\s*v?(\d+(?:\.\d+){0,2})$/.exec(range.trim())
  return atLeast ? `${atLeast[1]} or later` : range.trim()
}

/** What the Agents page says about Install where the agent's latest version needs a newer Node.js. */
export function installNeedsNodeVersionMessage(requirement: UnmetNodeRequirement): string {
  return `Install needs Node.js ${nodeVersionsText(requirement.range)}`
}

/**
 * Why a version of an agent cannot run on the computer, as the agent's row
 * writes it: `1.3.0 needs Node.js 22.19.0 or later (yours is 20.19.6)`.
 */
export function nodeRequirementMessage(version: string, requirement: UnmetNodeRequirement): string {
  return `${version} needs Node.js ${nodeVersionsText(requirement.range)} (yours is ${requirement.found})`
}

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
