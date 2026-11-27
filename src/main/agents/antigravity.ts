import type { AgentLaunchOptions, AgentModelOption } from '../../shared/agents'
import { setEnvVariable, type Env } from '../env/env'
import { commandProgram } from '../tools/command-program'
import { runCommand, type CommandResult } from './processes'

/** How long Antigravity CLI may take to list its models, which it asks its server for. */
const MODELS_TIMEOUT_MS = 30_000

/** Antigravity CLI's effort levels, in its order, as `--effort` takes them. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * What `agy models` ends with, failing, when Antigravity CLI is signed in to
 * no Google account: "Error: Please sign in to view available models."
 */
const SIGNED_OUT = /please sign in/i

/**
 * An environment in which Antigravity CLI does not update itself: it can
 * start its updater on any run, even one that only says its version, and
 * this is the one setting that turns it off.
 */
export function withoutAntigravityUpdates(env: Env): Env {
  const copy = { ...env }
  setEnvVariable(copy, 'AGY_CLI_DISABLE_AUTO_UPDATE', 'true')
  return copy
}

/**
 * The models `agy models` lists, one a line as its id and its name with a
 * tab between them, made into one choice for each model with the effort
 * levels it comes in, in the order of the first of each: Antigravity CLI
 * lists a model once for each level, such as `gemini-4-neon-high`,
 * "Gemini 4 Neon (High)", and takes the model as `gemini-4-neon` with the
 * level as `--effort`. A model listed without a level, such as an
 * orchestrator, has none.
 */
export function antigravityModelsOf(output: string): AgentModelOption[] {
  const models = new Map<string, AgentModelOption>()
  for (const line of output.split(/\r?\n/)) {
    const [id = '', name = ''] = line.split('\t').map((part) => part.trim())
    if (id === '' || name === '' || /\s/.test(id)) continue
    const variant = new RegExp(`^(.+)-(${EFFORTS.join('|')})$`).exec(id)
    const value = variant?.[1] ?? id
    const effort = variant?.[2]
    const label = variant === null ? name : name.replace(/\s*\([^)]*\)$/, '')
    const model = models.get(value) ?? { value, label, efforts: [] }
    if (effort !== undefined && !model.efforts.includes(effort)) model.efforts.push(effort)
    models.set(value, model)
  }
  return [...models.values()].map((model) => ({
    ...model,
    efforts: EFFORTS.filter((effort) => model.efforts.includes(effort)),
  }))
}

/**
 * The models Antigravity CLI offers the Google account it is signed in
 * with, as `agy models` lists them (see `antigravityModelsOf`); none when it
 * is signed in with none, which it says, or cannot reach its server. It
 * names no model or effort level of its own that Hoot reads: a session that
 * names none takes the one Antigravity CLI picks.
 */
export async function readAntigravityLaunchOptions(options: {
  command: string
  env: Env
  home: string
  platform?: NodeJS.Platform
  run?: (
    spec: { file: string; args: string[]; env: Env; cwd: string },
    timeoutMs: number,
  ) => Promise<CommandResult>
}): Promise<AgentLaunchOptions> {
  const none: AgentLaunchOptions = {
    models: [],
    defaultEfforts: [],
    defaultModel: null,
    defaultEffort: null,
    signedOut: false,
  }
  const platform = options.platform ?? process.platform
  const env = withoutAntigravityUpdates(options.env)
  const program = await commandProgram(options.command, env, platform).catch(() => null)
  if (program === null) return none
  const run = options.run ?? runCommand
  const result = await run(
    { file: program.file, args: [...program.args, 'models'], env, cwd: options.home },
    MODELS_TIMEOUT_MS,
  ).catch(() => null)
  if (result === null) return none
  if (result.code !== 0) return { ...none, signedOut: SIGNED_OUT.test(result.output) }
  return { ...none, models: antigravityModelsOf(result.stdout) }
}
