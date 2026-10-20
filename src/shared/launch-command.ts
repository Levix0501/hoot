import type { AgentLaunchSettings } from './launch-settings'
import type { CodingToolId } from './tools'

/** The arguments that make an agent act without asking for approval. */
export const YOLO_ARGUMENTS: Readonly<Record<CodingToolId, readonly string[]>> = {
  claude: ['--dangerously-skip-permissions'],
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
  opencode: ['--auto'],
}

/** Which of an agent's own launch settings its extra arguments already decide. */
export interface ExtraArgumentKinds {
  permission: boolean
  model: boolean
  effort: boolean
}

const NO_EXTRA_ARGUMENT_KINDS: ExtraArgumentKinds = {
  permission: false,
  model: false,
  effort: false,
}

/** The `-c` keys of Codex that set its permission, model or effort. */
const CODEX_CONFIG_KEYS: Readonly<Record<string, keyof ExtraArgumentKinds>> = {
  sandbox_mode: 'permission',
  approval_policy: 'permission',
  model: 'model',
  model_reasoning_effort: 'effort',
}

/** The Claude Code options that set its permission mode, with a value or alone. */
const CLAUDE_PERMISSION_OPTIONS = new Set([
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
])

/** The option that follows the key of a `--config` argument, when it has no `=`. */
function configKey(argument: string): string | null {
  const separator = argument.indexOf('=')
  return separator === -1 ? null : argument.slice(0, separator).trim()
}

/**
 * Which of an agent's settings its extra arguments already decide, by the
 * arguments a user would add on the Agents page. An option and its value count
 * as the option alone, and `--option=value` counts as the option.
 */
export function extraArgumentKinds(
  tool: CodingToolId,
  args: readonly string[],
): ExtraArgumentKinds {
  const kinds = { ...NO_EXTRA_ARGUMENT_KINDS }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    const separator = argument.indexOf('=')
    const option = separator === -1 ? argument : argument.slice(0, separator)
    const value = separator === -1 ? undefined : argument.slice(separator + 1)
    switch (tool) {
      case 'claude':
        if (CLAUDE_PERMISSION_OPTIONS.has(option)) kinds.permission = true
        else if (option === '--permission-mode') kinds.permission = true
        else if (option === '--model') kinds.model = true
        else if (option === '--effort') kinds.effort = true
        break
      case 'codex':
        if (
          option === '-s' ||
          option === '--sandbox' ||
          option === '-a' ||
          option === '--ask-for-approval' ||
          option === '--approve-for-me' ||
          option === '--dangerously-bypass-approvals-and-sandbox' ||
          option === '--yolo'
        ) {
          kinds.permission = true
        } else if (option === '-m' || option === '--model') {
          kinds.model = true
        } else if (option === '-c' || option === '--config') {
          const key = value === undefined ? args[index + 1] : value
          const kind = key === undefined ? undefined : CODEX_CONFIG_KEYS[configKey(key) ?? '']
          if (kind) kinds[kind] = true
          // A value given as the next argument is that argument, not another option.
          if (value === undefined && key !== undefined) index += 1
        }
        break
      case 'opencode':
        if (option === '--auto') kinds.permission = true
        break
    }
  }
  return kinds
}

/** The arguments that choose a model, if the agent has such an argument. */
export function modelArguments(tool: CodingToolId, model: string): string[] {
  return tool === 'opencode' ? [] : ['--model', model]
}

/** The arguments that choose an effort level, if the agent has such an argument. */
export function effortArguments(tool: CodingToolId, effort: string): string[] {
  switch (tool) {
    case 'claude':
      return ['--effort', effort]
    case 'codex':
      return ['-c', `model_reasoning_effort=${effort}`]
    case 'opencode':
      return []
  }
}

export interface AgentLaunchArgumentsInput {
  tool: CodingToolId
  yoloMode: boolean
  settings: AgentLaunchSettings
  /** What Hoot gives Claude Code with `--settings`; `null` for the others. */
  hookSettings: string | null
}

/**
 * The arguments of a new session, after those that run its command: the YOLO
 * arguments while YOLO mode is on and the extra arguments do not set
 * permissions, then the chosen model and effort, the extra arguments, and
 * Claude Code's hooks.
 */
export function agentLaunchArguments(input: AgentLaunchArgumentsInput): string[] {
  const { tool, yoloMode, settings, hookSettings } = input
  const kinds = extraArgumentKinds(tool, settings.extraArgs)
  const args: string[] = []
  if (yoloMode && !kinds.permission) args.push(...YOLO_ARGUMENTS[tool])
  if (settings.model !== null && !kinds.model) args.push(...modelArguments(tool, settings.model))
  if (settings.effort !== null && !kinds.effort)
    args.push(...effortArguments(tool, settings.effort))
  args.push(...settings.extraArgs)
  if (tool === 'claude' && hookSettings !== null) args.push('--settings', hookSettings)
  return args
}

/** A part of a command as the Agents page shows it. */
export type CommandSegmentKind = 'program' | 'permission' | 'model' | 'effort' | 'argument'

export interface CommandSegment {
  kind: CommandSegmentKind
  /** The arguments this segment stands for in the command, in order. */
  args: string[]
  /** What the Agents page writes for it. */
  text: string
  /** Whether the user can remove it with the × beside it. */
  removable?: boolean
  /** Whether it is decided by YOLO mode, not here. */
  locked?: boolean
  /** Why the segment is as it is, shown when it is pointed at. */
  note?: string
  /** Whether the segment opens a choice. */
  selectable?: boolean
  /** Where an extra argument is in the extra arguments, from 0. */
  extraIndex?: number
}

/**
 * The arguments typed on the Agents page, split at spaces as a shell would,
 * except that text in single or double quotes stays one argument.
 */
export function splitArguments(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )
}

/** A command as a user would run it: an argument with a space is quoted. */
export function displayArgument(argument: string): string {
  return /\s/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument
}

/** The command a session runs, as the Agents page shows and copies it. */
export function displayCommand(segments: readonly CommandSegment[]): string {
  return segments.flatMap((segment) => segment.args.map(displayArgument)).join(' ')
}

/**
 * A command as the Agents page shows it: the program, a locked segment for
 * YOLO mode, the chosen model and effort, and every extra argument. Where the
 * extra arguments set the permissions, the model or the effort, they alone
 * show it: the segment that would is left out. Claude Code's hooks, which
 * Hoot adds for itself, are not shown.
 */
export function commandSegments(input: {
  tool: CodingToolId
  program: string
  yoloMode: boolean
  settings: AgentLaunchSettings
  modelEfforts: readonly string[]
  defaultEfforts: readonly string[]
}): CommandSegment[] {
  const { tool, program, yoloMode, settings } = input
  const kinds = extraArgumentKinds(tool, settings.extraArgs)
  const segments: CommandSegment[] = [{ kind: 'program', args: [program], text: program }]

  if (yoloMode && !kinds.permission) {
    segments.push({
      kind: 'permission',
      args: [...YOLO_ARGUMENTS[tool]],
      text: YOLO_ARGUMENTS[tool].join(' '),
      locked: true,
      note: 'Added by YOLO mode',
    })
  }

  if (tool !== 'opencode' && !kinds.model) {
    if (settings.model === null) {
      segments.push({
        kind: 'model',
        args: [],
        text: '+ model',
        selectable: true,
        note: 'Choose a model for new sessions.',
      })
    } else {
      segments.push({
        kind: 'model',
        args: modelArguments(tool, settings.model),
        text: modelArguments(tool, settings.model).join(' '),
        selectable: true,
        note: 'Choose a model for new sessions.',
      })
    }
  }

  const efforts = settings.model === null ? input.defaultEfforts : input.modelEfforts
  const hasEffortChoice = efforts.length > 0 || settings.effort !== null
  if (tool !== 'opencode' && !kinds.effort && hasEffortChoice) {
    if (settings.effort === null) {
      segments.push({
        kind: 'effort',
        args: [],
        text: '+ effort',
        selectable: true,
        note: 'Choose an effort level for new sessions.',
      })
    } else {
      segments.push({
        kind: 'effort',
        args: effortArguments(tool, settings.effort),
        text: effortArguments(tool, settings.effort).join(' '),
        selectable: true,
        note: 'Choose an effort level for new sessions.',
      })
    }
  }

  settings.extraArgs.forEach((argument, extraIndex) => {
    segments.push({
      kind: 'argument',
      args: [argument],
      text: argument,
      removable: true,
      extraIndex,
    })
  })
  return segments
}
