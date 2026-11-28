import { CODING_TOOL_IDS, normalizeHarnessOrder, type CodingToolId } from './tools'

/** How an agent starts the sessions Hoot opens with it. */
export interface AgentLaunchSettings {
  /** Whether the agent appears in the new session menu. */
  enabled: boolean
  /** The model a session starts with; `null` for the agent's own default. */
  model: string | null
  /** The effort level a session starts with; `null` for the agent's own default. */
  effort: string | null
  /** Arguments added to the end of a session's own arguments, in order. */
  extraArgs: string[]
}

/**
 * What the Agents page keeps besides the agents themselves: the default
 * agent, the YOLO mode switch, and the order of the harnesses.
 */
export interface LaunchSettings {
  /**
   * The agent a new chat starts with while it can be used, by its id; `null`
   * for none. A new chat starts with the first agent that can be used while
   * this one cannot (see `sessionAgent`).
   */
  defaultAgent: string | null
  /** Whether each agent gets the arguments that make it act without asking. */
  yoloMode: boolean
  /** The harnesses in the user's order, every coding tool once. */
  harnessOrder: CodingToolId[]
}

/** The settings an agent starts with until the user changes one. */
export function defaultAgentLaunchSettings(): AgentLaunchSettings {
  return { enabled: true, model: null, effort: null, extraArgs: [] }
}

/** The settings Hoot starts with: no default agent, YOLO mode on, and the default harness order. */
export function defaultLaunchSettings(): LaunchSettings {
  return { defaultAgent: null, yoloMode: true, harnessOrder: [...CODING_TOOL_IDS] }
}

/** The settings with another default agent, or `null` while the settings are not known. */
export function withDefaultAgent(
  settings: LaunchSettings | null,
  id: string | null,
): LaunchSettings | null {
  return settings === null ? null : { ...settings, defaultAgent: id }
}

/** The settings with YOLO mode on or off, or `null` while the settings are not known. */
export function withYoloMode(settings: LaunchSettings | null, on: boolean): LaunchSettings | null {
  return settings === null ? null : { ...settings, yoloMode: on }
}

/** The settings with another harness order, or `null` while the settings are not known. */
export function withHarnessOrder(
  settings: LaunchSettings | null,
  order: readonly CodingToolId[],
): LaunchSettings | null {
  return settings === null ? null : { ...settings, harnessOrder: normalizeHarnessOrder(order) }
}
