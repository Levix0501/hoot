import { gt, lt, valid } from 'semver'
import { getCodingTool, type CodingToolId } from './tools'

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
  /** The command that read its version, as the Agents page shows it. */
  versionCommand: string
  /**
   * Whether updating it can write where it is: for an installation by npm,
   * whether the user can create files in its global folder, where npm puts
   * packages and their commands; `true` for the others, which Hoot does not
   * check.
   */
  writable: boolean
  /** Whether Hoot can install another version of it in its place. */
  switchable: boolean
  /** Whether Hoot can uninstall it: it knows how it was installed, and can write there. */
  removable: boolean
}

/**
 * Another copy of an agent on the computer, which a terminal would run were
 * the ones before it gone: further on the login shell PATH, or in a folder
 * an installer or a version manager of Node.js puts it in.
 */
export interface AgentCopy {
  /** The command's absolute path. */
  path: string
  /**
   * The version the command reports, or, where it does not run, the one its
   * npm package names; `null` when neither is known.
   */
  version: string | null
  /** Whether the command runs, reporting its version. */
  runs: boolean
  /** Whether Hoot can uninstall it. */
  removable: boolean
}

/**
 * What an agent's installation follows: its latest version, which Update
 * installs; Claude Code's Stable channel, which lags the latest by a week or
 * so; or one version it stays on, which nothing updates in Hoot's sessions.
 */
export type AgentFollow =
  | { kind: 'latest' }
  | { kind: 'stable' }
  | { kind: 'stay'; version: string }

/** A version of an agent that its version menu offers. */
export interface AgentRelease {
  version: string
  /** The day it came out, as `YYYY-MM-DD`; `null` where the registry does not say. */
  date: string | null
}

/** How Install puts an agent on the computer: with its official installer, or with npm. */
export type InstallRoute = 'official' | 'npm'

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

/**
 * What an operation started from the Agents page does to an agent: installs
 * it, updates it, installs another version in its place, or uninstalls a
 * copy of it.
 */
export type AgentOperationKind = 'install' | 'update' | 'switch' | 'uninstall'

/** What an operation works on, which its row and its failure name. */
export interface AgentOperationTarget {
  kind: AgentOperationKind
  /**
   * The version an update or a switch installs, or that of the copy an
   * uninstall removes; `null` for an install, which installs the latest.
   */
  version: string | null
  /** How an install puts the agent on the computer; `null` for the others. */
  route: InstallRoute | null
  /** The command of the copy an uninstall removes; `null` for the others. */
  path: string | null
}

/**
 * Where an operation is: waiting for the one before it, which Cancel can
 * take it out of; running, which goes on to its end; or ended. An ended
 * operation's message is the result as the Agents page writes it.
 */
export type AgentOperation =
  | (AgentOperationTarget & { status: 'waiting' })
  | (AgentOperationTarget & { status: 'running' })
  | (AgentOperationTarget & { status: 'succeeded'; message: string })
  | (AgentOperationTarget & {
      status: 'failed'
      message: string
      /** The last lines of what its command wrote. */
      tail: string[]
      /** Everything its command wrote, as a terminal would show it at the end. */
      output: string
      /** Why it failed, as the end of its message says it. */
      reason: string
      /** The command that ran, as the Agents page shows it; `null` when none ran. */
      command: string | null
      /** Its exit code when it exited, otherwise `null`. */
      exitCode: number | null
      /** How many seconds its command ran, rounded; `null` when none ran. */
      seconds: number | null
    })
  | (AgentOperationTarget & { status: 'cancelled' })

/** A model a session can start with, and the effort levels it supports. */
export interface AgentModelOption {
  /** The value the agent's model argument gets: an alias or a model ID. */
  value: string
  /** What the Agents page writes for the option. */
  label: string
  /** The effort levels the model supports, in the agent's order. */
  efforts: string[]
}

/** A default that an agent's own configuration sets, and where it is set. */
export interface ConfiguredDefault {
  value: string
  /** The file that sets it, as the Agents page names it, such as settings.json. */
  source: string
}

/** The models, and Default's effort levels, that a detection read from an agent. */
export interface AgentLaunchOptions {
  models: AgentModelOption[]
  /** The effort levels of the model a session uses when none is selected. */
  defaultEfforts: string[]
  /** The model the agent's own configuration starts sessions with, when it names one. */
  defaultModel: ConfiguredDefault | null
  /** The effort level the agent's own configuration starts sessions with, when it names one. */
  defaultEffort: ConfiguredDefault | null
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
  /** The version Claude Code's Stable channel is on, once read; `null` for the others. */
  stable: string | null
  /**
   * The versions its version menu offers, newest first, once read: the
   * recent ones Hoot works with in full; `null` before they are read, or when
   * they could not be.
   */
  releases: AgentRelease[] | null
  /** What its installation follows, which the user picks in its version menu. */
  follow: AgentFollow
  /**
   * How Install puts it on the computer: with its official installer, or
   * with npm where it has none for this platform.
   */
  installRoute: InstallRoute
  /** Its other copies, in the order a terminal would find them, after the one in use. */
  copies: AgentCopy[]
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

/**
 * Whether a version of an agent is older than the oldest Hoot works with
 * (see `minimumVersion`); never for what is no version.
 */
export function belowMinimumVersion(tool: CodingToolId, version: string): boolean {
  return valid(version) !== null && lt(version, getCodingTool(tool).minimumVersion)
}

/** That Hoot needs a newer version of an agent, as a clause: "Hoot needs OpenCode 2.1.0 or later". */
export function minimumVersionText(tool: CodingToolId): string {
  const { label, minimumVersion } = getCodingTool(tool)
  return `Hoot needs ${label} ${minimumVersion} or later`
}

/** Whether `latest` is a newer version than `installed`, by the rules of semantic versioning. */
export function isNewerVersion(latest: string, installed: string): boolean {
  return valid(latest) !== null && valid(installed) !== null && gt(latest, installed)
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

/** The result of a switch that succeeded. */
export function switchedMessage(version: string): string {
  return `✓ Switched to ${version}`
}

/** The result of an uninstall that succeeded. */
export const UNINSTALLED_MESSAGE = '✓ Uninstalled'

/** What an operation is called where its row and its failure name it: Install, Update… */
export function operationName(kind: AgentOperationKind): string {
  switch (kind) {
    case 'install':
      return 'Install'
    case 'update':
      return 'Update'
    case 'switch':
      return 'Switch'
    case 'uninstall':
      return 'Uninstall'
  }
}

/** The result of an operation that failed, for a reason. */
export function failedMessage(kind: AgentOperationKind, reason: string): string {
  return `✕ ${operationName(kind)} failed: ${reason}`
}

/**
 * The version an installation's Update installs under what it follows: the
 * latest version, or Stable's; `null` while it stays on a version, or before
 * the version it would install is known.
 */
export function updateTargetOf(
  agent: Pick<AgentState, 'follow' | 'latest' | 'stable'>,
): string | null {
  switch (agent.follow.kind) {
    case 'latest':
      return agent.latest
    case 'stable':
      return agent.stable
    case 'stay':
      return null
  }
}

/**
 * The version an installation that stays on one should go back to, when
 * something outside Hoot, such as the agent's own updater in a terminal,
 * has installed another one in its place; `null` otherwise.
 */
export function driftedFrom(agent: Pick<AgentState, 'follow' | 'installation'>): string | null {
  const version = agent.installation?.version ?? null
  if (agent.follow.kind !== 'stay' || version === null) return null
  return version === agent.follow.version ? null : agent.follow.version
}

/** The result of an operation that was cancelled. */
export const CANCELLED_MESSAGE = 'Cancelled'
