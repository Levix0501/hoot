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
 * agent, the YOLO mode switch, and whether closing a running session asks
 * first.
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
  /**
   * Whether closing a running session asks for confirmation first, as it
   * does until the user tells it not to.
   */
  confirmClose: boolean
}

/** The settings an agent starts with until the user changes one. */
export function defaultAgentLaunchSettings(): AgentLaunchSettings {
  return { enabled: true, model: null, effort: null, extraArgs: [] }
}

/** The settings Hoot starts with: no default agent, YOLO mode on, closing a running session asking first. */
export function defaultLaunchSettings(): LaunchSettings {
  return { defaultAgent: null, yoloMode: true, confirmClose: true }
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

/**
 * The settings with closing a running session asking first or not, or `null`
 * while the settings are not known.
 */
export function withConfirmClose(
  settings: LaunchSettings | null,
  on: boolean,
): LaunchSettings | null {
  return settings === null ? null : { ...settings, confirmClose: on }
}
