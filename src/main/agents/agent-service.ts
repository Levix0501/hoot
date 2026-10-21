import { EventEmitter } from 'node:events'
import path from 'node:path'
import {
  failedMessage,
  FOLDER_NOT_WRITABLE_MESSAGE,
  installedMessage,
  INSTALL_NEEDS_NODE_MESSAGE,
  INSTALL_NEEDS_WRITE_ACCESS_MESSAGE,
  isNewerVersion,
  nodeRequirementMessage,
  shownCommand,
  updatedMessage,
  type AgentInstallation,
  type AgentLaunchOptions,
  type AgentOperation,
  type AgentOperationKind,
  type AgentOperationSummary,
  type AgentsState,
  type InstallTarget,
  type UnmetNodeRequirement,
} from '../../shared/agents'
import { CODING_TOOLS, type CodingToolDefinition, type CodingToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import { prependToPath } from '../env/session-env'
import type { Detection, LoginEnvironment } from '../tools/tool-service'
import { commandProgram } from '../tools/command-program'
import { canonicalPath, homeDisplayPath } from './agent-paths'
import {
  detectInstallMethod,
  OFFICIAL_UPDATE_COMMANDS,
  type DetectedInstallMethod,
} from './install-method'
import type { LatestRelease } from './latest-version'
import { readNodeVersion, unmetNodeRequirement } from './node'
import { canInstallInto, findComputerNpm, npmGlobalFolderOf, type ComputerNpm } from './npm'
import { startProcess, type CommandSpec, type ProcessEnd, type RunningProcess } from './processes'
import { TerminalText } from './terminal-text'
import { readVersion } from './version'

/** How many of the last lines of a failed operation's output its row shows. */
const TAIL_LINES = 5
/** How long a detection's results are shown before the page checks again. */
const DETECTION_INTERVAL_MS = 20 * 60 * 60 * 1000

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
  /** The ids of an agent's sessions that are starting or running. */
  runningSessions(id: CodingToolId): string[]
  /**
   * The models and Default effort levels an agent offers under its own
   * configuration, from the detection that found it; `null` where Hoot offers
   * no model choice.
   */
  launchOptions(tool: CodingToolId, detection: Detection): Promise<AgentLaunchOptions | null>
  /** Hoot's clock, replaceable for tests. */
  now?(): number
  /** The platform Hoot runs on: what its commands are, and where agents live. */
  platform?: NodeJS.Platform
}

/** An agent's installation, with what updating it needs. */
interface Installation extends AgentInstallation {
  detectedMethod: DetectedInstallMethod
}

/** What an operation runs, and the name its results give it, such as npm. */
interface Plan {
  name: string
  command: CommandSpec
}

/** Why an operation could not run its command. */
class OperationFailure extends Error {}

interface Operation {
  kind: AgentOperationKind
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
  operation: Operation | null
  /** The models its configuration offers, and Default's effort levels, from the last detection. */
  launchOptions: AgentLaunchOptions | null
}

/** The arguments npm installs an agent's latest version with, in a global folder. */
function npmInstallArgs(tool: CodingToolDefinition): string[] {
  return ['install', '-g', `${tool.npmPackage}@latest`, '--loglevel=http']
}

/** A command as a user would run it: on Windows, npm's batch file rather than what it points to. */
interface UserCommand {
  program: string
  args: string[]
}

/**
 * What updating an installation runs, as a user would run it; `null` where
 * Hoot cannot tell how it was installed.
 */
function updateCommandOf(
  tool: CodingToolDefinition,
  command: string,
  method: DetectedInstallMethod,
): UserCommand | null {
  switch (method.kind) {
    case 'npm':
      return { program: method.npm, args: npmInstallArgs(tool) }
    case 'homebrew':
      return {
        program: method.brew,
        args: ['upgrade', method.cask ? '--cask' : '--formula', method.name],
      }
    case 'official':
      return { program: command, args: [OFFICIAL_UPDATE_COMMANDS[tool.id]] }
    case 'unknown':
      return null
  }
}

function isPending(operation: Operation | null): boolean {
  return operation?.state.status === 'waiting' || operation?.state.status === 'running'
}

/** An agent's operation, while it runs or waits, as the quit confirmation tells it. */
function summary(record: AgentRecord, waiting: boolean): AgentOperationSummary[] {
  return record.operation && isPending(record.operation)
    ? [{ label: record.tool.label, kind: record.operation.kind, waiting }]
    : []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
 * it is and which is the latest; and the installs and updates started from
 * the page, one at a time in the order they were asked for, each of which can
 * be cancelled until it starts. An install uses the computer's npm, when the
 * user can install into its global folder. An update runs what the
 * installation's method updates it with, in its place; for npm, when the user
 * can write to its global folder. Where npm installs an agent whose command
 * runs on Node.js, the node that sessions would run it with must be one its
 * latest version needs.
 */
export class AgentService extends EventEmitter<{ changed: [AgentsState] }> {
  private readonly records: AgentRecord[] = CODING_TOOLS.map((tool) => ({
    tool,
    installation: null,
    detected: false,
    readings: 0,
    readingId: 0,
    latest: null,
    latestNode: null,
    latestFailed: false,
    latestReadings: 0,
    latestId: 0,
    operation: null,
    launchOptions: null,
  }))
  private installTarget: InstallTarget | null = null
  /** The computer's npm as Install would run it, with `~` for the home folder, when Install can. */
  private installNpm: string | null = null
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

  constructor(private readonly options: AgentServiceOptions) {
    super()
    this.canonicalHome = canonicalPath(options.home)
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? (() => Date.now())
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
          updateCommand: record.installation.updateCommand,
          writable: record.installation.writable,
        },
        latest: record.latest,
        latestFailed: record.latestFailed,
        installCommand:
          this.installNpm === null
            ? null
            : shownCommand([this.installNpm, ...npmInstallArgs(record.tool)]),
        nodeRequirement: this.nodeRequirementOf(record),
        operation: record.operation?.state ?? null,
        launchOptions: record.launchOptions,
      })),
      installTarget: this.installTarget,
      detecting: this.detecting !== null,
      detectedAt: this.lastDetectionStartedAt,
    }
  }

  /**
   * Reads the login shell environment again, looks for every agent's
   * installation and reads its version, and reads every agent's latest
   * version. It starts no earlier than the call: while one runs, the next
   * starts once it ends, for every call made meanwhile.
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

  /** Installs an agent, now or after the operations before it. */
  install(id: CodingToolId): void {
    this.enqueue(id, 'install')
  }

  /** Updates an agent's installation, now or after the operations before it. */
  update(id: CodingToolId): void {
    this.enqueue(id, 'update')
  }

  /**
   * Updates every agent that can be updated, one after another: those whose
   * latest version is newer, and those whose last update failed.
   */
  updateAll(): void {
    for (const record of this.records) {
      if (record.installation === null || record.installation.version === null) continue
      const failed = record.operation?.state.status === 'failed' ? record.operation.kind : null
      // An install that failed leaves its row showing the failure, not Update.
      if (failed === 'install') continue
      if (isPending(record.operation)) continue
      if (failed === 'update' || this.canUpdate(record)) this.enqueue(record.tool.id, 'update')
    }
  }

  /** Whether an agent's row offers Update: a newer version, and a method and folder Hoot can use. */
  private canUpdate(record: AgentRecord): boolean {
    const installation = record.installation
    if (installation === null || installation.version === null) return false
    if (record.latestFailed || record.latest === null) return false
    if (!isNewerVersion(record.latest, installation.version)) return false
    if (installation.method === 'unknown' || !installation.writable) return false
    return installation.method !== 'npm' || this.nodeRequirementOf(record) === null
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
    operation.state = { kind: operation.kind, status: 'cancelled' }
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
      operation.state = { kind: operation.kind, status: 'cancelled' }
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
   * installations and reads their versions; also where Install puts an agent,
   * and the version of the node that sessions run agents with. Returns what
   * it found for each, also when a later reading has started since, whose
   * result then stands instead.
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
      this.installNpm =
        npm !== null && this.installTarget.kind === 'npm' ? await this.displayPath(npm.path) : null
      this.nodeVersion = nodeVersion
      const installations = await Promise.all(
        records.map(async (record, index) => {
          try {
            const installation = await this.describe(record.tool, detection, npm).catch(() => null)
            if (ids[index] === record.readingId) {
              record.installation = installation
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

  /**
   * An agent's installation as a detection found it: how it was installed,
   * its version, and what updating it runs and needs.
   */
  private async describe(
    tool: CodingToolDefinition,
    detection: Detection,
    npm: ComputerNpm | null,
  ): Promise<Installation | null> {
    const command = detection.state.tools.find((entry) => entry.id === tool.id)?.path ?? null
    if (command === null) return null
    const { env } = detection.login
    const { home } = this.options
    const [method, version, displayPath] = await Promise.all([
      detectInstallMethod(tool, command, {
        home,
        env,
        computerNpm: npm,
        npmGlobalFolder: (other) => npmGlobalFolderOf(other, env, home, this.platform),
        platform: this.platform,
      }),
      readVersion(command, env, home, this.platform),
      this.displayPath(command),
    ])
    const update = updateCommandOf(tool, command, method)
    return {
      path: command,
      displayPath,
      method: method.kind,
      version: version.version,
      versionOutput: version.output,
      versionCommand: version.command,
      updateCommand:
        update === null
          ? null
          : shownCommand([await this.displayPath(update.program), ...update.args]),
      writable: method.kind === 'npm' ? await canInstallInto(method.prefix, this.platform) : true,
      detectedMethod: method,
    }
  }

  private enqueue(id: CodingToolId, kind: AgentOperationKind): void {
    const record = this.record(id)
    if (isPending(record.operation)) return
    const operation: Operation = {
      kind,
      state: { kind, status: 'waiting' },
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
      operation.state = { kind, status: 'cancelled' }
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
    const { kind } = operation
    operation.state = { kind, status: 'running' }
    this.changed()
    const before = record.installation
    const sessionsBefore = kind === 'update' ? this.options.runningSessions(record.tool.id) : []
    const output = new TerminalText()
    let plan: Plan | null = null
    let end: ProcessEnd | null = null
    let seconds: number | null = null
    let failure: string | null = null
    try {
      plan = await this.plan(record, kind, before)
      if (!operation.cancelled) {
        const startedAt = this.now()
        const process = startProcess(plan.command, (text) => {
          void output.write(text)
        })
        operation.process = process
        // Stopped for quitting while it started.
        if (operation.cancelled) terminate(operation)
        end = await process.ended
        seconds = Math.round((this.now() - startedAt) / 1000)
        operation.process = null
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

    const command = plan === null ? null : shownCommand([plan.command.file, ...plan.command.args])
    try {
      if (operation.stopped) {
        operation.state = { kind, status: 'cancelled' }
        return
      }
      const { installations } = await this.readInstallations([record])
      const after = installations[0] ?? null
      if (failure !== null || plan === null || end === null) {
        operation.state = this.failed(kind, failure ?? 'it did not run', output, {
          command,
          exitCode: end?.code ?? null,
          seconds,
        })
      } else {
        operation.state = this.outcome(record.tool, kind, plan, end, before, after, {
          sessionsBefore,
          output,
          command: command ?? '',
          seconds,
        })
      }
    } finally {
      output.dispose()
      this.changed()
      operation.ended.resolve()
    }
  }

  /**
   * What an operation runs, from the login shell environment read last. What
   * an install or an update by npm needs is checked again first, as it may
   * have changed since the agent was last read.
   */
  private async plan(
    record: AgentRecord,
    kind: AgentOperationKind,
    before: Installation | null,
  ): Promise<Plan> {
    const { tool } = record
    const { home } = this.options
    const { env } = await this.options.getLoginEnvironment()
    if (kind === 'install') {
      const npm = await findComputerNpm(env, home, this.platform)
      if (npm === null) throw new OperationFailure(INSTALL_NEEDS_NODE_MESSAGE)
      if (!npm.usable) throw new OperationFailure(INSTALL_NEEDS_WRITE_ACCESS_MESSAGE)
      await this.checkNode(record, env)
      return this.npmPlan(npm.path, npmInstallArgs(tool), env)
    }
    if (before === null) throw new OperationFailure(`${tool.label} is not installed`)
    if (before.version === null) throw new OperationFailure(`${tool.label} doesn't run`)
    const method = before.detectedMethod
    const update = updateCommandOf(tool, before.path, method)
    if (method.kind === 'unknown' || update === null) {
      throw new OperationFailure(
        `Hoot cannot tell how ${tool.label} was installed; update it the way you installed it`,
      )
    }
    const { program, args } = update
    switch (method.kind) {
      case 'npm': {
        if (!(await canInstallInto(method.prefix, this.platform))) {
          throw new OperationFailure(FOLDER_NOT_WRITABLE_MESSAGE)
        }
        await this.checkNode(record, env)
        const npmEnv = { ...env }
        // Another global folder's npm runs with the node beside it.
        if (!method.computer) {
          prependToPath(npmEnv, path.dirname(method.npm), this.platform)
        }
        return this.npmPlan(program, args, npmEnv)
      }
      case 'homebrew':
        return { name: 'brew', command: { file: program, args, env, cwd: home } }
      case 'official':
        return {
          name: `${tool.command} ${args.join(' ')}`,
          command: { file: program, args, env, cwd: home },
        }
    }
  }

  /**
   * Fails an install or an update by npm whose agent's latest version needs
   * a newer Node.js than the node that sessions would run it with.
   */
  private async checkNode(record: AgentRecord, env: Env): Promise<void> {
    if (record.latest === null || record.latestNode === null) return
    const version = await readNodeVersion(env, this.options.home, this.platform)
    const requirement = unmetNodeRequirement(record.latestNode, version)
    if (requirement) throw new OperationFailure(nodeRequirementMessage(record.latest, requirement))
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
    }
  }

  /**
   * Whether an operation whose command ran succeeded: its command exited with
   * 0, the agent is found and runs afterwards and, for an update, at the same
   * path as before, with a newer version.
   */
  private outcome(
    tool: CodingToolDefinition,
    kind: AgentOperationKind,
    plan: Plan,
    end: ProcessEnd,
    before: Installation | null,
    after: Installation | null,
    context: {
      sessionsBefore: string[]
      output: TerminalText
      command: string
      seconds: number | null
    },
  ): AgentOperation {
    const { name } = plan
    const label = tool.label
    const command = context.command
    const exitCode = end.code
    let reason: string
    if (end.error) reason = `could not run ${name}: ${end.error.message}`
    else if (end.signal) reason = `${name} was ended by ${end.signal}`
    else if (end.code !== 0) reason = `${name} exited with code ${end.code}`
    else if (after === null) {
      reason = `${name} finished, but ${label} is ${kind === 'install' ? 'not' : 'no longer'} found`
    } else if (kind === 'update' && before !== null && after.path !== before.path) {
      reason = `${name} finished, but ${label} is now found at ${after.displayPath}`
    } else if (after.version === null) {
      reason = `${name} finished, but ${label} doesn't run`
    } else if (kind === 'install') {
      return { kind, status: 'succeeded', message: installedMessage(after.version) }
    } else if (before?.version == null) {
      reason = `${name} finished, but ${label} did not run before it`
    } else if (after.version === before.version) {
      reason = `${name} finished, but the version is still ${before.version}`
    } else if (!isNewerVersion(after.version, before.version)) {
      reason = `${name} finished, but the version is ${after.version}, not newer than ${before.version}`
    } else {
      const running = new Set(this.options.runningSessions(tool.id))
      const stillRunning = context.sessionsBefore.filter((id) => running.has(id)).length
      return {
        kind,
        status: 'succeeded',
        message: updatedMessage(after.version, stillRunning, before.version),
      }
    }
    return this.failed(kind, reason, context.output, {
      command,
      exitCode,
      seconds: context.seconds,
    })
  }

  private failed(
    kind: AgentOperationKind,
    reason: string,
    output: TerminalText,
    run: { command: string | null; exitCode: number | null; seconds: number | null },
  ): AgentOperation {
    const lines = output.lines()
    return {
      kind,
      status: 'failed',
      message: failedMessage(kind, reason),
      reason,
      tail: lines.slice(-TAIL_LINES),
      output: lines.join('\n'),
      ...run,
    }
  }
}
