import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { valid } from 'semver'
import {
  failedMessage,
  FOLDER_NOT_WRITABLE_MESSAGE,
  installedMessage,
  INSTALL_NEEDS_NODE_MESSAGE,
  INSTALL_NEEDS_WRITE_ACCESS_MESSAGE,
  isNewerVersion,
  nodeRequirementMessage,
  shownCommand,
  switchedMessage,
  UNINSTALLED_MESSAGE,
  updatedMessage,
  updateTargetOf,
  type AgentCopy,
  type AgentFollow,
  type AgentInstallation,
  type AgentLaunchOptions,
  type AgentOperation,
  type AgentOperationSummary,
  type AgentOperationTarget,
  type AgentRelease,
  type AgentsState,
  type InstallRoute,
  type InstallTarget,
  type UnmetNodeRequirement,
} from '../../shared/agents'
import { CODING_TOOLS, type CodingToolDefinition, type CodingToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import { prependToPath } from '../env/session-env'
import type { Detection, LoginEnvironment } from '../tools/tool-service'
import { commandProgram } from '../tools/command-program'
import { findAgentCopies } from './agent-command'
import { canonicalPath, homeDisplayPath, samePath } from './agent-paths'
import {
  detectInstallMethod,
  OFFICIAL_UPDATE_COMMANDS,
  type DetectedInstallMethod,
  type InstallMethodContext,
} from './install-method'
import {
  hasOfficialInstaller,
  officialInstallCommand,
  removeFiles,
  switchCommandOf,
  uninstallPlanOf,
  type UninstallPlan,
  type UserCommand,
} from './install-plans'
import type { LatestRelease } from './latest-version'
import { readNodeVersion, unmetNodeRequirement } from './node'
import { canInstallInto, findComputerNpm, npmGlobalFolderOf, type ComputerNpm } from './npm'
import { startProcess, type CommandSpec, type ProcessEnd, type RunningProcess } from './processes'
import type { Releases } from './releases'
import { TerminalText } from './terminal-text'
import { readVersion } from './version'

/** How many of the last lines of a failed operation's output its row shows. */
const TAIL_LINES = 5
/** How long a detection's results are shown before the page checks again. */
const DETECTION_INTERVAL_MS = 20 * 60 * 60 * 1000

/** Where what each agent follows is kept (see `AgentFollowStore`). */
export interface AgentFollows {
  get(tool: CodingToolId): AgentFollow
  set(tool: CodingToolId, follow: AgentFollow): void
}

/** What each agent follows while Hoot runs, where it is kept nowhere else, as in tests. */
function followsInMemory(): AgentFollows {
  const follows = new Map<CodingToolId, AgentFollow>()
  return {
    get: (tool) => follows.get(tool) ?? { kind: 'latest' },
    set: (tool, follow) => {
      follows.set(tool, follow)
    },
  }
}

export interface AgentServiceOptions {
  /**
   * Reads the login shell environment and finds the tools again, in a
   * detection that starts no earlier than the call.
   */
  detectTools(): Promise<Detection>
  /** The login shell environment read last. */
  getLoginEnvironment(): Promise<LoginEnvironment>
  /** The home folder. */
  home: string
  /**
   * The latest version of an agent's npm package on registry.npmjs.org, and
   * the Node.js it needs where the agent's command runs on Node.js; `null`
   * when it cannot be read.
   */
  latestRelease(npmPackage: string, command: string): Promise<LatestRelease | null>
  /**
   * The versions of an agent its version menu offers (see `fetchReleases`);
   * `null` when they cannot be read. None are offered without it.
   */
  releases?(tool: CodingToolId, npmPackage: string, command: string): Promise<Releases | null>
  /** Where what each agent follows is kept; only while Hoot runs without it. */
  follows?: AgentFollows
  /** The ids of an agent's sessions that are starting or running. */
  runningSessions(id: CodingToolId): string[]
  /**
   * Closes an agent's sessions, before the copy they run is uninstalled:
   * settles once their processes have ended.
   */
  closeSessions?(id: CodingToolId): Promise<void>
  /**
   * The models and Default effort levels an agent offers under its own
   * configuration, from the detection that found it; `null` where Hoot offers
   * no model choice.
   */
  launchOptions(tool: CodingToolId, detection: Detection): Promise<AgentLaunchOptions | null>
  /**
   * The computer's own folders copies of agents may be in besides those on
   * PATH, such as Homebrew's (see `systemFolders`); none by default.
   */
  systemFolders?: string[]
  /**
   * What installs an agent with its official installer (see
   * `officialInstallCommand`); replaceable for tests, which download nothing.
   */
  officialInstaller?(tool: CodingToolId, env: Env): UserCommand | null
  /** Hoot's clock, replaceable for tests. */
  now?(): number
  /** The platform Hoot runs on: what its commands are, and where agents live. */
  platform?: NodeJS.Platform
}

/** An agent's installation, with what updating it, and uninstalling it, needs. */
interface Installation extends AgentInstallation {
  detectedMethod: DetectedInstallMethod
  uninstall: UninstallPlan | null
}

/** Another copy of an agent, with what uninstalling it needs. */
interface Copy extends AgentCopy {
  detectedMethod: DetectedInstallMethod
  uninstall: UninstallPlan | null
}

/**
 * What an operation does, and the name its results give it, such as npm: a
 * command it runs, or files Hoot removes itself.
 */
type Plan =
  | { name: string; command: CommandSpec; shown: string }
  | { name: string; remove: string[]; shown: string }

/** Why an operation could not run its command. */
class OperationFailure extends Error {}

interface Operation {
  target: AgentOperationTarget
  /** Where it is, as the Agents page shows it. */
  state: AgentOperation
  /** Set when it is cancelled, or stopped for quitting. */
  cancelled: boolean
  /** Set when it is stopped for quitting: it ends without anything read again. */
  stopped: boolean
  /** Its command's process, while it runs. */
  process: RunningProcess | null
  /** Whether its command's process has been sent SIGTERM. */
  terminated: boolean
  /**
   * Set once its command's process has ended, or it is known to start none:
   * stopping it then changes nothing, and its result stands.
   */
  commandDone: boolean
  /** Settles once it has ended, with its result. */
  ended: PromiseWithResolvers<void>
}

interface AgentRecord {
  tool: CodingToolDefinition
  installation: Installation | null
  /** Its other copies, after the one in use, in the order a terminal finds them. */
  copies: Copy[]
  /** Whether its installation has been looked for. */
  detected: boolean
  /** Its readings of its installation under way. */
  readings: number
  /** The latest of those readings, which alone sets its installation. */
  readingId: number
  latest: string | null
  /** The Node.js versions the latest version needs, where its command runs on Node.js. */
  latestNode: string | null
  latestFailed: boolean
  latestReadings: number
  latestId: number
  /** The version of Claude Code's Stable channel, once read. */
  stable: string | null
  /** The versions its version menu offers, once read. */
  releases: AgentRelease[] | null
  /** The Node.js versions each of those needs, where its command runs on Node.js. */
  releaseNode: Map<string, string>
  releasesId: number
  operation: Operation | null
  /** The models its configuration offers, and Default's effort levels, from the last detection. */
  launchOptions: AgentLaunchOptions | null
}

/** The arguments npm installs an agent's latest version with, in a global folder. */
function npmInstallArgs(tool: CodingToolDefinition): string[] {
  return ['install', '-g', `${tool.npmPackage}@latest`, '--loglevel=http']
}

/** The arguments npm installs one version of an agent with, in a global folder. */
function npmVersionArgs(tool: CodingToolDefinition, version: string): string[] {
  return ['install', '-g', `${tool.npmPackage}@${version}`, '--loglevel=http']
}

/**
 * What updating an installation runs, as a user would run it, to the
 * version it follows: npm installs the latest, or that version when it
 * follows another, as Claude Code's Stable; Claude Code's own `install`
 * installs that version, whatever channel its own settings name; Codex and
 * OpenCode update themselves to their latest. `null` where Hoot cannot tell
 * how it was installed.
 */
function updateCommandOf(
  tool: CodingToolDefinition,
  command: string,
  method: DetectedInstallMethod,
  version: string,
  latest: boolean,
): UserCommand | null {
  switch (method.kind) {
    case 'npm':
      return {
        program: method.npm,
        args: latest ? npmInstallArgs(tool) : npmVersionArgs(tool, version),
      }
    case 'homebrew':
      return {
        program: method.brew,
        args: ['upgrade', method.cask ? '--cask' : '--formula', method.name],
      }
    case 'official':
      return tool.id === 'claude'
        ? { program: command, args: ['install', version] }
        : { program: command, args: [OFFICIAL_UPDATE_COMMANDS[tool.id]] }
    case 'unknown':
      return null
  }
}

/** The name an operation's results give what it ran: npm, brew, the installer, or the agent's own command. */
function planName(
  tool: CodingToolDefinition,
  command: UserCommand,
  method: DetectedInstallMethod,
): string {
  if (method.kind === 'npm') return 'npm'
  if (method.kind === 'homebrew') return 'brew'
  if (command.shown !== undefined) return 'the installer'
  return `${tool.command} ${command.args[0] ?? ''}`.trim()
}

function isPending(operation: Operation | null): boolean {
  return operation?.state.status === 'waiting' || operation?.state.status === 'running'
}

/** An agent's operation, while it runs or waits, as the quit confirmation tells it. */
function summary(record: AgentRecord, waiting: boolean): AgentOperationSummary[] {
  const operation = record.operation
  if (!operation || !isPending(operation)) return []
  const { kind, version } = operation.target
  const label =
    kind === 'switch' && version !== null ? `${record.tool.label} ${version}` : record.tool.label
  return [{ label, kind, waiting }]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The version an installation by npm's package names, for a copy that does
 * not run to report its own; `null` for the others, and when it cannot be read.
 */
async function packageVersion(
  tool: CodingToolDefinition,
  method: DetectedInstallMethod,
  platform: NodeJS.Platform,
): Promise<string | null> {
  if (method.kind !== 'npm') return null
  const paths = platform === 'win32' ? path.win32 : path.posix
  const modules =
    platform === 'win32'
      ? paths.join(method.prefix, 'node_modules')
      : paths.join(method.prefix, 'lib', 'node_modules')
  try {
    const text = await fs.readFile(paths.join(modules, tool.npmPackage, 'package.json'), 'utf8')
    const version: unknown = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' && valid(version) !== null ? version : null
  } catch {
    return null
  }
}

async function exists(file: string): Promise<boolean> {
  return (await fs.lstat(file).catch(() => null)) !== null
}

/**
 * Sends the command of an operation stopped for quitting SIGTERM, once its
 * process has started, and only once: npm puts back what it changed when it
 * gets SIGTERM, once the step under way has ended (a download, for example),
 * but a second SIGTERM ends it at once, before it has, leaving the agent half
 * replaced.
 */
function terminate(operation: Operation): void {
  if (operation.terminated || !operation.process) return
  operation.terminated = true
  operation.process.signal('SIGTERM')
}

/**
 * The agents of the Agents page: where each is installed, how, which version
 * it is and which is the latest, which versions its version menu offers,
 * what it follows, and its other copies; and the operations started from the
 * page, one at a time in the order they were asked for, each of which can be
 * cancelled until it starts. An install uses the agent's official installer,
 * or the computer's npm when the user can install into its global folder. An
 * update, or a switch to another version, runs what the installation's
 * method installs with, in its place; for npm, when the user can write to its
 * global folder. Where npm installs an agent whose command runs on Node.js,
 * the node that sessions would run it with must be one the version needs. An
 * uninstall removes one copy the way it was installed, after the sessions
 * that run it have closed.
 */
export class AgentService extends EventEmitter<{ changed: [AgentsState] }> {
  private readonly records: AgentRecord[] = CODING_TOOLS.map((tool) => ({
    tool,
    installation: null,
    copies: [],
    detected: false,
    readings: 0,
    readingId: 0,
    latest: null,
    latestNode: null,
    latestFailed: false,
    latestReadings: 0,
    latestId: 0,
    stable: null,
    releases: null,
    releaseNode: new Map(),
    releasesId: 0,
    operation: null,
    launchOptions: null,
  }))
  private installTarget: InstallTarget | null = null
  /** The version of the node that sessions run agents' JavaScript commands with. */
  private nodeVersion: string | null = null
  private readonly canonicalHome: Promise<string>
  private detecting: Promise<void> | null = null
  private queuedDetection: Promise<void> | null = null
  /** When the last detection started, on Hoot's clock; `null` before the first. */
  private lastDetectionStartedAt: number | null = null
  /** The operations waiting, in the order they were asked for. */
  private queue: AgentRecord[] = []
  private running: AgentRecord | null = null
  /**
   * Set once every operation is stopped for quitting, until `resume`: an
   * operation asked for meanwhile runs no command and ends cancelled at once,
   * since Hoot, which is quitting, would not wait for its command to end.
   */
  private quitting = false
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly follows: AgentFollows

  constructor(private readonly options: AgentServiceOptions) {
    super()
    this.canonicalHome = canonicalPath(options.home)
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? (() => Date.now())
    this.follows = options.follows ?? followsInMemory()
  }

  getState(): AgentsState {
    return {
      agents: this.records.map((record) => ({
        id: record.tool.id,
        checking: !record.detected || record.readings > 0 || record.latestReadings > 0,
        detected: record.detected,
        installation: record.installation && {
          path: record.installation.path,
          displayPath: record.installation.displayPath,
          method: record.installation.method,
          version: record.installation.version,
          versionOutput: record.installation.versionOutput,
          versionCommand: record.installation.versionCommand,
          writable: record.installation.writable,
          switchable: record.installation.switchable,
          removable: record.installation.removable,
        },
        latest: record.latest,
        latestFailed: record.latestFailed,
        stable: record.stable,
        releases: record.releases,
        follow: this.followOf(record.tool.id),
        installRoute: this.installRouteOf(record),
        copies: record.copies.map((copy) => ({
          path: copy.path,
          version: copy.version,
          runs: copy.runs,
          removable: copy.removable,
        })),
        nodeRequirement: this.nodeRequirementOf(record),
        operation: record.operation?.state ?? null,
        launchOptions: record.launchOptions,
      })),
      installTarget: this.installTarget,
      detecting: this.detecting !== null,
      detectedAt: this.lastDetectionStartedAt,
    }
  }

  /** What an agent's installation follows, which its sessions are run under. */
  followOf(tool: CodingToolId): AgentFollow {
    return this.follows.get(tool)
  }

  /**
   * Reads the login shell environment again, looks for every agent's
   * installation and reads its version, and reads every agent's latest
   * version. It starts no earlier than the call: while one runs, the next
   * starts once it ends, for every call made meanwhile. The versions each
   * agent's version menu offers are read too, without being waited for.
   */
  detect(): Promise<void> {
    if (this.queuedDetection) return this.queuedDetection
    const running = this.detecting
    if (!running) return this.startDetection()
    const startNext = () => {
      this.queuedDetection = null
      return this.startDetection()
    }
    this.queuedDetection = running.then(startNext, startNext)
    return this.queuedDetection
  }

  /**
   * Detects when the Agents page is opened: the first time since Hoot
   * started, and once the last detection started 20 hours ago or more. A
   * page opened sooner shows the last results as they are.
   */
  openPage(): void {
    if (this.lastDetectionStartedAt === null) {
      void this.detect()
      return
    }
    if (
      this.detecting === null &&
      this.now() - this.lastDetectionStartedAt >= DETECTION_INTERVAL_MS
    ) {
      void this.detect()
    }
  }

  /**
   * Installs an agent, now or after the operations before it: with its
   * official installer, or with npm, as the Agents page offers once the
   * installer has failed.
   */
  install(id: CodingToolId, route?: InstallRoute): void {
    const record = this.record(id)
    this.enqueue(id, {
      kind: 'install',
      version: null,
      route: route ?? this.installRouteOf(record),
      path: null,
    })
  }

  /** Updates an agent's installation to the version it follows, now or after the operations before it. */
  update(id: CodingToolId): void {
    const record = this.record(id)
    const target = this.updateTarget(record)
    if (target === null) return
    this.enqueue(id, { kind: 'update', version: target, route: null, path: null })
  }

  /**
   * Updates every agent that can be updated, one after another: those whose
   * version they follow is newer, and those whose last update failed. Those
   * that stay on a version are left as they are.
   */
  updateAll(): void {
    for (const record of this.records) {
      if (record.installation === null || record.installation.version === null) continue
      if (this.followOf(record.tool.id).kind === 'stay') continue
      const failed = record.operation?.state.status === 'failed' ? record.operation.target : null
      // An install that failed leaves its row showing the failure, not Update.
      if (failed?.kind === 'install') continue
      if (isPending(record.operation)) continue
      if (failed?.kind === 'update' || this.canUpdate(record)) this.update(record.tool.id)
    }
  }

  /**
   * Sets what an agent's installation follows, as the user picks it in its
   * version menu, and installs what that asks for: the version it now stays
   * on, unless it is installed; the latest version, or Stable's, when it is
   * newer than the one installed and Hoot can update it. Stable never
   * installs an older version: the installation waits for Stable to catch up.
   */
  setFollow(id: CodingToolId, follow: AgentFollow): void {
    const record = this.record(id)
    if (isPending(record.operation)) return
    if (follow.kind === 'stable' && id !== 'claude') return
    this.follows.set(id, follow)
    const installed = record.installation?.version ?? null
    if (installed !== null) {
      if (follow.kind === 'stay') {
        if (follow.version !== installed) {
          this.enqueue(id, { kind: 'switch', version: follow.version, route: null, path: null })
        }
      } else if (this.canUpdate(record)) {
        this.update(id)
      }
    }
    this.changed()
  }

  /**
   * Installs the version an agent stays on again, where something outside
   * Hoot has installed another in its place.
   */
  restore(id: CodingToolId): void {
    const record = this.record(id)
    const follow = this.followOf(record.tool.id)
    const installed = record.installation?.version ?? null
    if (follow.kind !== 'stay' || installed === null || installed === follow.version) return
    this.enqueue(id, { kind: 'switch', version: follow.version, route: null, path: null })
  }

  /** Uninstalls the copy of an agent whose command is at `file`, now or after the operations before it. */
  uninstall(id: CodingToolId, file: string): void {
    const record = this.record(id)
    const copy = this.copyAt(record, file)
    if (copy === null || !copy.removable) return
    this.enqueue(id, { kind: 'uninstall', version: copy.version, route: null, path: copy.path })
  }

  /** Runs an agent's operation that failed again, as it ran. */
  retry(id: CodingToolId): void {
    const record = this.record(id)
    const operation = record.operation
    if (operation?.state.status !== 'failed') return
    this.enqueue(id, operation.target)
  }

  /**
   * Whether an agent's row offers Update: a newer version than the one
   * installed of what it follows, and a method and folder Hoot can use.
   */
  private canUpdate(record: AgentRecord): boolean {
    const installation = record.installation
    if (installation === null || installation.version === null) return false
    const target = this.updateTarget(record)
    if (target === null || record.latestFailed) return false
    if (!isNewerVersion(target, installation.version)) return false
    if (installation.method === 'unknown' || !installation.writable) return false
    return installation.method !== 'npm' || this.nodeRequirementOf(record) === null
  }

  /** The version an agent's Update installs under what it follows (see `updateTargetOf`). */
  private updateTarget(record: AgentRecord): string | null {
    return updateTargetOf({
      follow: this.followOf(record.tool.id),
      latest: record.latest,
      stable: record.stable,
    })
  }

  /**
   * How Install puts an agent on the computer: with its official installer
   * where it has one for the platform, else with npm.
   */
  private installRouteOf(record: AgentRecord): InstallRoute {
    return hasOfficialInstaller(record.tool.id, this.platform) ? 'official' : 'npm'
  }

  /** The copy of an agent whose command is at `file`: the one in use, or another. */
  private copyAt(record: AgentRecord, file: string | null): Installation | Copy | null {
    if (file === null) return null
    const installation = record.installation
    if (installation !== null && samePath(installation.path, file, this.platform))
      return installation
    return record.copies.find((copy) => samePath(copy.path, file, this.platform)) ?? null
  }

  /**
   * Cancels an agent's operation while it waits: it leaves the queue and runs
   * nothing. One that runs goes on to its end, as stopping it would gain
   * nothing: npm, sent SIGTERM, still ends the step under way first (its
   * download, for example), and then puts back the version before.
   */
  cancel(id: CodingToolId): void {
    const record = this.record(id)
    const operation = record.operation
    if (operation?.state.status !== 'waiting') return
    this.queue = this.queue.filter((queued) => queued !== record)
    operation.cancelled = true
    operation.state = { ...operation.target, status: 'cancelled' }
    operation.ended.resolve()
    this.changed()
    void this.readInstallations([record])
  }

  /** The operations running or waiting, the running one first, for the quit confirmation. */
  pendingOperations(): AgentOperationSummary[] {
    return [
      ...(this.running ? summary(this.running, false) : []),
      ...this.queue.flatMap((record) => summary(record, true)),
    ]
  }

  /**
   * Stops every operation, for quitting: those waiting never run their
   * command, and the command of the one running is sent SIGTERM. Settles once
   * that one has ended: once its process has or, when its command had
   * already ended, once it has read the agent again for its result. Those
   * asked for afterwards, also while it waits, never run their command
   * either, until `resume`.
   */
  async stopAll(): Promise<void> {
    this.quitting = true
    for (const record of this.queue.splice(0)) {
      const operation = record.operation
      if (!operation) continue
      operation.cancelled = true
      operation.stopped = true
      operation.state = { ...operation.target, status: 'cancelled' }
      operation.ended.resolve()
    }
    const operation = this.running?.operation
    if (operation && !operation.commandDone) {
      operation.cancelled = true
      operation.stopped = true
      terminate(operation)
    }
    this.changed()
    await operation?.ended.promise
  }

  /**
   * Lets operations run again after `stopAll`, for a Hoot that keeps running
   * after all, as when restarting into an update fails.
   */
  resume(): void {
    this.quitting = false
  }

  private record(id: CodingToolId): AgentRecord {
    const record = this.records.find((candidate) => candidate.tool.id === id)
    if (!record) throw new Error(`Unknown agent: ${id}`)
    return record
  }

  private changed(): void {
    this.emit('changed', this.getState())
  }

  /**
   * The Node.js that an agent's latest version needs and the node that
   * sessions run agents with does not meet, where npm would install it: when
   * it is not installed, or installed by npm.
   */
  private nodeRequirementOf(record: AgentRecord): UnmetNodeRequirement | null {
    if (record.installation !== null && record.installation.method !== 'npm') return null
    return unmetNodeRequirement(record.latestNode, this.nodeVersion)
  }

  private startDetection(): Promise<void> {
    this.lastDetectionStartedAt = this.now()
    for (const record of this.records) void this.readReleases(record)
    const detecting = Promise.all([
      this.readInstallations(this.records),
      ...this.records.map((record) => this.readLatest(record)),
    ])
      .then(async ([reading]) => {
        if (reading !== null) await this.readLaunchOptions(reading.detection)
      })
      .finally(() => {
        if (this.detecting === detecting) this.detecting = null
        this.changed()
      })
    this.detecting = detecting
    this.changed()
    return detecting
  }

  /**
   * Reads every agent's launch options from the configuration the detection
   * found, replacing those of the last detection once all are read.
   */
  private async readLaunchOptions(detection: Detection): Promise<void> {
    const options = await Promise.all(
      this.records.map((record) =>
        this.options.launchOptions(record.tool.id, detection).catch(() => record.launchOptions),
      ),
    )
    for (const [index, value] of options.entries()) {
      const record = this.records[index]
      if (record) record.launchOptions = value
    }
  }

  /**
   * Reads the login shell environment again, then looks for these agents'
   * installations and their other copies and reads their versions; also
   * where Install puts an agent with npm, and the version of the node that
   * sessions run agents with. Returns what it found for each, also when a
   * later reading has started since, whose result then stands instead.
   */
  private async readInstallations(
    records: AgentRecord[],
  ): Promise<{ installations: Array<Installation | null>; detection: Detection }> {
    const ids = records.map((record) => {
      record.readings += 1
      record.readingId += 1
      return record.readingId
    })
    this.changed()
    const finished = new Set<AgentRecord>()
    const finish = (record: AgentRecord) => {
      if (finished.has(record)) return
      finished.add(record)
      record.readings -= 1
      this.changed()
    }
    try {
      const detection = await this.options.detectTools()
      const { env } = detection.login
      const [npm, nodeVersion] = await Promise.all([
        findComputerNpm(env, this.options.home, this.platform),
        readNodeVersion(env, this.options.home, this.platform),
      ])
      this.installTarget = await this.targetOf(npm)
      this.nodeVersion = nodeVersion
      const installations = await Promise.all(
        records.map(async (record, index) => {
          try {
            const command =
              detection.state.tools.find((entry) => entry.id === record.tool.id)?.path ?? null
            const [installation, copies] = await Promise.all([
              command === null
                ? null
                : this.describe(record.tool, command, env, npm).catch(() => null),
              command === null ? [] : this.readCopies(record.tool, command, env, npm),
            ])
            if (ids[index] === record.readingId) {
              record.installation = installation
              record.copies = installation === null ? [] : copies
              record.detected = true
            }
            return installation
          } finally {
            finish(record)
          }
        }),
      )
      return { installations, detection }
    } finally {
      for (const record of records) finish(record)
    }
  }

  private async readLatest(record: AgentRecord): Promise<void> {
    record.latestReadings += 1
    record.latestId += 1
    const id = record.latestId
    this.changed()
    try {
      const { tool } = record
      const release = await this.options
        .latestRelease(tool.npmPackage, tool.command)
        .catch(() => null)
      if (id === record.latestId) {
        record.latest = release?.version ?? null
        record.latestNode = release?.node ?? null
        record.latestFailed = release === null
      }
    } finally {
      record.latestReadings -= 1
      this.changed()
    }
  }

  /**
   * Reads the versions an agent's version menu offers, and Stable's version
   * for Claude Code; those read before stay when they cannot be read again.
   */
  private async readReleases(record: AgentRecord): Promise<void> {
    const read = this.options.releases
    if (read === undefined) return
    record.releasesId += 1
    const id = record.releasesId
    const { tool } = record
    const releases = await read(tool.id, tool.npmPackage, tool.command).catch(() => null)
    if (id !== record.releasesId || releases === null) return
    record.releases = releases.versions
    record.releaseNode = releases.node
    record.stable = tool.id === 'claude' ? releases.stable : null
    this.changed()
  }

  private async displayPath(file: string): Promise<string> {
    return homeDisplayPath(file, this.options.home, await this.canonicalHome)
  }

  private async targetOf(npm: ComputerNpm | null): Promise<InstallTarget> {
    if (npm === null || (this.platform !== 'darwin' && this.platform !== 'win32')) {
      return { kind: 'node-required' }
    }
    const displayPrefix = await this.displayPath(npm.prefix)
    return npm.usable
      ? { kind: 'npm', prefix: npm.prefix, displayPrefix }
      : { kind: 'npm-not-writable', prefix: npm.prefix, displayPrefix }
  }

  /** What telling how a copy of an agent was installed needs. */
  private methodContext(env: Env, npm: ComputerNpm | null): InstallMethodContext {
    const { home } = this.options
    return {
      home,
      env,
      computerNpm: npm,
      npmGlobalFolder: (other) => npmGlobalFolderOf(other, env, home, this.platform),
      platform: this.platform,
    }
  }

  /**
   * An agent's installation as a detection found it: how it was installed,
   * its version, and whether Hoot can update it, install another version in
   * its place, and uninstall it.
   */
  private async describe(
    tool: CodingToolDefinition,
    command: string,
    env: Env,
    npm: ComputerNpm | null,
  ): Promise<Installation> {
    const { home } = this.options
    const [method, version, displayPath] = await Promise.all([
      detectInstallMethod(tool, command, this.methodContext(env, npm)),
      readVersion(command, env, home, this.platform),
      this.displayPath(command),
    ])
    const writable =
      method.kind === 'npm' ? await canInstallInto(method.prefix, this.platform) : true
    const uninstall = await uninstallPlanOf(tool, command, method, {
      home,
      env,
      platform: this.platform,
      writable,
    })
    return {
      path: command,
      displayPath,
      method: method.kind,
      version: version.version,
      versionOutput: version.output,
      versionCommand: version.command,
      writable,
      switchable:
        writable && switchCommandOf(tool, command, method, '0.0.0', this.platform) !== null,
      removable: uninstall !== null,
      detectedMethod: method,
      uninstall,
    }
  }

  /**
   * An agent's copies other than the one in use at `command`, in the order a
   * terminal finds them (see `findAgentCopies`), with their versions and
   * whether Hoot can uninstall each.
   */
  private async readCopies(
    tool: CodingToolDefinition,
    command: string,
    env: Env,
    npm: ComputerNpm | null,
  ): Promise<Copy[]> {
    const { home } = this.options
    const files = await findAgentCopies(
      tool.id,
      tool.command,
      env,
      home,
      this.platform,
      this.options.systemFolders ?? [],
    ).catch(() => [] as string[])
    const others = files.filter((file) => !samePath(file, command, this.platform))
    const copies = await Promise.all(
      others.map(async (file): Promise<Copy | null> => {
        try {
          const [method, version] = await Promise.all([
            detectInstallMethod(tool, file, this.methodContext(env, npm)),
            readVersion(file, env, home, this.platform),
          ])
          const writable =
            method.kind === 'npm' ? await canInstallInto(method.prefix, this.platform) : true
          const uninstall = await uninstallPlanOf(tool, file, method, {
            home,
            env,
            platform: this.platform,
            writable,
          })
          return {
            path: file,
            version: version.version ?? (await packageVersion(tool, method, this.platform)),
            runs: version.version !== null,
            removable: uninstall !== null,
            detectedMethod: method,
            uninstall,
          }
        } catch {
          return null
        }
      }),
    )
    return copies.filter((copy): copy is Copy => copy !== null)
  }

  private enqueue(id: CodingToolId, target: AgentOperationTarget): void {
    const record = this.record(id)
    if (isPending(record.operation)) return
    const operation: Operation = {
      target,
      state: { ...target, status: 'waiting' },
      cancelled: false,
      stopped: false,
      process: null,
      terminated: false,
      commandDone: false,
      ended: Promise.withResolvers<void>(),
    }
    record.operation = operation
    if (this.quitting) {
      // Hoot quits without waiting for a command started now.
      operation.cancelled = true
      operation.stopped = true
      operation.commandDone = true
      operation.state = { ...target, status: 'cancelled' }
      operation.ended.resolve()
      this.changed()
      return
    }
    this.queue.push(record)
    this.changed()
    this.startNext()
  }

  private startNext(): void {
    if (this.running) return
    const record = this.queue.shift()
    const operation = record?.operation
    if (!record || !operation) return
    this.running = record
    void this.perform(record, operation).finally(() => {
      this.running = null
      this.startNext()
    })
  }

  private async perform(record: AgentRecord, operation: Operation): Promise<void> {
    const { target } = operation
    const { kind } = target
    operation.state = { ...target, status: 'running' }
    this.changed()
    const before = record.installation
    const sessionsBefore =
      kind === 'update' || kind === 'switch' ? this.options.runningSessions(record.tool.id) : []
    const output = new TerminalText()
    let plan: Plan | null = null
    let end: ProcessEnd | null = null
    let seconds: number | null = null
    let failure: string | null = null
    try {
      plan = await this.plan(record, target, before)
      if (!operation.cancelled) {
        // The sessions that run the copy close before it goes.
        const inUse =
          before !== null &&
          target.path !== null &&
          samePath(before.path, target.path, this.platform)
        if (kind === 'uninstall' && inUse) await this.options.closeSessions?.(record.tool.id)
        const startedAt = this.now()
        if ('remove' in plan) {
          end = await this.removeAll(plan.remove, output)
        } else {
          const process = startProcess(plan.command, (text) => {
            void output.write(text)
          })
          operation.process = process
          // Stopped for quitting while it started.
          if (operation.cancelled) terminate(operation)
          end = await process.ended
          operation.process = null
        }
        seconds = Math.round((this.now() - startedAt) / 1000)
        await output.settled()
      }
    } catch (error) {
      failure =
        error instanceof OperationFailure
          ? error.message
          : `Hoot could not run it: ${errorMessage(error)}`
    } finally {
      operation.commandDone = true
    }

    const command = plan === null ? null : plan.shown
    try {
      if (operation.stopped) {
        operation.state = { ...target, status: 'cancelled' }
        return
      }
      const { installations } = await this.readInstallations([record])
      const after = installations[0] ?? null
      if (failure !== null || plan === null || end === null) {
        operation.state = this.failed(target, failure ?? 'it did not run', output, {
          command,
          exitCode: end?.code ?? null,
          seconds,
        })
      } else {
        const remains = target.path === null ? false : await exists(target.path)
        operation.state = this.outcome(record.tool, target, plan, end, before, after, {
          sessionsBefore,
          output,
          command: command ?? '',
          seconds,
          remains,
        })
        // An agent whose copy in use is gone follows its latest version again.
        if (
          kind === 'uninstall' &&
          operation.state.status === 'succeeded' &&
          before !== null &&
          target.path !== null &&
          samePath(before.path, target.path, this.platform) &&
          this.followOf(record.tool.id).kind === 'stay'
        ) {
          this.follows.set(record.tool.id, { kind: 'latest' })
        }
      }
    } finally {
      output.dispose()
      this.changed()
      operation.ended.resolve()
    }
  }

  /**
   * Removes the files an official installer made, one after another, writing
   * each as it goes; ends as a process that could not run when one cannot be.
   */
  private async removeAll(paths: string[], output: TerminalText): Promise<ProcessEnd> {
    for (const file of paths) {
      try {
        await removeFiles([file])
        await output.write(`Removed ${await this.displayPath(file)}\r\n`)
      } catch (error) {
        return {
          code: null,
          signal: null,
          error: error instanceof Error ? error : new Error(String(error)),
        }
      }
    }
    return { code: 0, signal: null, error: null }
  }

  /**
   * What an operation runs, from the login shell environment read last. What
   * an install or an update by npm needs is checked again first, as it may
   * have changed since the agent was last read.
   */
  private async plan(
    record: AgentRecord,
    target: AgentOperationTarget,
    before: Installation | null,
  ): Promise<Plan> {
    const { tool } = record
    const { env } = await this.options.getLoginEnvironment()
    switch (target.kind) {
      case 'install': {
        if (target.route === 'official') {
          const command = this.options.officialInstaller
            ? this.options.officialInstaller(tool.id, env)
            : officialInstallCommand(tool.id, env, this.platform)
          if (command === null) {
            throw new OperationFailure(`${tool.label} has no official installer for this computer`)
          }
          return this.commandPlan('the installer', command, env)
        }
        const npm = await findComputerNpm(env, this.options.home, this.platform)
        if (npm === null) throw new OperationFailure(INSTALL_NEEDS_NODE_MESSAGE)
        if (!npm.usable) throw new OperationFailure(INSTALL_NEEDS_WRITE_ACCESS_MESSAGE)
        await this.checkNode(record, env, null)
        return this.npmPlan(npm.path, npmInstallArgs(tool), env)
      }
      case 'uninstall': {
        const copy = this.copyAt(record, target.path)
        if (copy === null) throw new OperationFailure(`${tool.label} is no longer there`)
        const plan = copy.uninstall
        if (plan === null) {
          throw new OperationFailure(`Hoot cannot tell how to uninstall ${tool.label} there`)
        }
        if (plan.kind === 'remove') {
          const shown = await Promise.all(plan.paths.map((file) => this.displayPath(file)))
          return { name: 'Hoot', remove: plan.paths, shown: shownCommand(['rm', '-rf', ...shown]) }
        }
        return this.methodPlan(tool, plan.command, env, copy.detectedMethod)
      }
      case 'update':
      case 'switch':
        break
    }
    if (before === null) throw new OperationFailure(`${tool.label} is not installed`)
    if (before.version === null) throw new OperationFailure(`${tool.label} doesn't run`)
    const version = target.version ?? record.latest ?? ''
    const method = before.detectedMethod
    const command =
      target.kind === 'switch'
        ? switchCommandOf(tool, before.path, method, version, this.platform)
        : updateCommandOf(
            tool,
            before.path,
            method,
            version,
            this.followOf(record.tool.id).kind === 'latest',
          )
    if (command === null) {
      throw new OperationFailure(
        target.kind === 'switch'
          ? `Hoot cannot install another version of ${tool.label} where it is`
          : `Hoot cannot tell how ${tool.label} was installed; update it the way you installed it`,
      )
    }
    if (method.kind === 'npm') {
      if (!(await canInstallInto(method.prefix, this.platform))) {
        throw new OperationFailure(FOLDER_NOT_WRITABLE_MESSAGE)
      }
      await this.checkNode(record, env, target.kind === 'switch' ? version : null)
    }
    return this.methodPlan(tool, command, env, method)
  }

  /**
   * An operation that runs what installed a copy of an agent, as its method
   * has it: an npm that is not the computer's runs with the node beside it.
   */
  private async methodPlan(
    tool: CodingToolDefinition,
    command: UserCommand,
    env: Env,
    method: DetectedInstallMethod,
  ): Promise<Plan> {
    if (method.kind === 'npm') {
      const npmEnv = { ...env }
      // Another global folder's npm runs with the node beside it.
      if (!method.computer) prependToPath(npmEnv, path.dirname(method.npm), this.platform)
      return this.npmPlan(command.program, command.args, npmEnv)
    }
    return this.commandPlan(planName(tool, command, method), command, env)
  }

  /** An operation that runs a command, with the variables it needs besides the login shell's. */
  private async commandPlan(name: string, command: UserCommand, env: Env): Promise<Plan> {
    const commandEnv = command.env ? { ...env, ...command.env } : env
    const program = await commandProgram(command.program, commandEnv, this.platform)
    return {
      name,
      command: {
        file: program.file,
        args: [...program.args, ...command.args],
        env: commandEnv,
        cwd: this.options.home,
      },
      shown:
        command.shown ??
        shownCommand([await this.displayPath(program.file), ...program.args, ...command.args]),
    }
  }

  /**
   * Fails an install or an update by npm whose agent's latest version, or a
   * switch whose version, needs a newer Node.js than the node that sessions
   * would run it with.
   */
  private async checkNode(record: AgentRecord, env: Env, version: string | null): Promise<void> {
    const range = version === null ? record.latestNode : (record.releaseNode.get(version) ?? null)
    const shown = version ?? record.latest
    if (shown === null || range === null) return
    const found = await readNodeVersion(env, this.options.home, this.platform)
    const requirement = unmetNodeRequirement(range, found)
    if (requirement) throw new OperationFailure(nodeRequirementMessage(shown, requirement))
  }

  /**
   * An operation that runs an npm the computer has. On Windows its command is
   * a batch file, which runs as what it points to (see `commandProgram`).
   */
  private async npmPlan(npm: string, args: string[], env: Env): Promise<Plan> {
    const program = await commandProgram(npm, env, this.platform)
    return {
      name: 'npm',
      command: {
        file: program.file,
        args: [...program.args, ...args],
        env,
        cwd: this.options.home,
      },
      shown: shownCommand([await this.displayPath(program.file), ...program.args, ...args]),
    }
  }

  /**
   * Whether an operation whose command ran succeeded: its command exited with
   * 0 and, for an uninstall, the copy is gone; for the others, the agent is
   * found and runs afterwards, for an update or a switch at the same path as
   * before, with a newer version after an update and the version asked for
   * after a switch.
   */
  private outcome(
    tool: CodingToolDefinition,
    target: AgentOperationTarget,
    plan: Plan,
    end: ProcessEnd,
    before: Installation | null,
    after: Installation | null,
    context: {
      sessionsBefore: string[]
      output: TerminalText
      command: string
      seconds: number | null
      /** Whether the copy an uninstall removes is still there. */
      remains: boolean
    },
  ): AgentOperation {
    const { name } = plan
    const { kind } = target
    const label = tool.label
    const command = context.command
    const exitCode = end.code
    let reason: string
    if (end.error) {
      reason =
        'remove' in plan
          ? `could not remove it: ${end.error.message}`
          : `could not run ${name}: ${end.error.message}`
    } else if (end.signal) reason = `${name} was ended by ${end.signal}`
    else if (end.code !== 0) reason = `${name} exited with code ${end.code}`
    else if (kind === 'uninstall') {
      if (!context.remains) return { ...target, status: 'succeeded', message: UNINSTALLED_MESSAGE }
      reason = `${name} finished, but ${label} is still there`
    } else if (after === null) {
      reason = `${name} finished, but ${label} is ${kind === 'install' ? 'not' : 'no longer'} found`
    } else if (kind !== 'install' && before !== null && after.path !== before.path) {
      reason = `${name} finished, but ${label} is now found at ${after.displayPath}`
    } else if (after.version === null) {
      reason = `${name} finished, but ${label} doesn't run`
    } else if (kind === 'install') {
      return { ...target, status: 'succeeded', message: installedMessage(after.version) }
    } else if (before?.version == null) {
      reason = `${name} finished, but ${label} did not run before it`
    } else if (kind === 'switch') {
      if (after.version === target.version) {
        return { ...target, status: 'succeeded', message: switchedMessage(after.version) }
      }
      reason = `${name} finished, but the version is ${after.version}, not ${target.version ?? ''}`
    } else if (after.version === before.version) {
      reason = `${name} finished, but the version is still ${before.version}`
    } else if (!isNewerVersion(after.version, before.version)) {
      reason = `${name} finished, but the version is ${after.version}, not newer than ${before.version}`
    } else {
      const running = new Set(this.options.runningSessions(tool.id))
      const stillRunning = context.sessionsBefore.filter((id) => running.has(id)).length
      return {
        ...target,
        status: 'succeeded',
        message: updatedMessage(after.version, stillRunning, before.version),
      }
    }
    return this.failed(target, reason, context.output, {
      command,
      exitCode,
      seconds: context.seconds,
    })
  }

  private failed(
    target: AgentOperationTarget,
    reason: string,
    output: TerminalText,
    run: { command: string | null; exitCode: number | null; seconds: number | null },
  ): AgentOperation {
    const lines = output.lines()
    return {
      ...target,
      status: 'failed',
      message: failedMessage(target.kind, reason),
      reason,
      tail: lines.slice(-TAIL_LINES),
      output: lines.join('\n'),
      ...run,
    }
  }
}
