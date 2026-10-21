import { CODING_TOOL_IDS, type CodingToolId } from './tools'

/** How one agent starts the sessions Hoot opens with it. */
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

/** What the Agents page keeps for every agent, the default agent and the YOLO mode switch. */
export interface LaunchSettings {
  /**
   * The agent a new chat starts with while it can be used; `null` never. A
   * new chat falls back to the first agent that can be used when this one
   * cannot.
   */
  defaultAgent: CodingToolId
  /** Whether each agent gets the arguments that make it act without asking. */
  yoloMode: boolean
  agents: Readonly<Record<CodingToolId, AgentLaunchSettings>>
}

/** The settings an agent starts with until the user changes one. */
export function defaultAgentLaunchSettings(): AgentLaunchSettings {
  return { enabled: true, model: null, effort: null, extraArgs: [] }
}

/**
 * The settings Hoot starts with: Claude Code the default agent, YOLO mode on,
 * every agent enabled and unchanged.
 */
export function defaultLaunchSettings(): LaunchSettings {
  return {
    defaultAgent: 'claude',
    yoloMode: true,
    agents: Object.fromEntries(
      CODING_TOOL_IDS.map((id) => [id, defaultAgentLaunchSettings()]),
    ) as Record<CodingToolId, AgentLaunchSettings>,
  }
}

/** What changes about an agent's launch settings; what is left out stays as it is. */
export interface AgentLaunchSettingsChange {
  enabled?: boolean
  model?: string | null
  effort?: string | null
  extraArgs?: string[]
}

/** An agent's settings with `change` applied. */
export function withLaunchSettingsChange(
  settings: AgentLaunchSettings,
  change: AgentLaunchSettingsChange,
): AgentLaunchSettings {
  return {
    enabled: change.enabled ?? settings.enabled,
    model: change.model === undefined ? settings.model : change.model,
    effort: change.effort === undefined ? settings.effort : change.effort,
    extraArgs: change.extraArgs === undefined ? settings.extraArgs : change.extraArgs,
  }
}

/** Whether a coding tool is enabled, as the settings say; unknown ones are. */
export function agentEnabled(settings: LaunchSettings | null, id: CodingToolId): boolean {
  return settings === null || settings.agents[id]?.enabled !== false
}

/** The settings with another default agent, or `null` while the settings are not known. */
export function withDefaultAgent(
  settings: LaunchSettings | null,
  id: CodingToolId,
): LaunchSettings | null {
  return settings === null ? null : { ...settings, defaultAgent: id }
}

/** The settings with YOLO mode on or off, or `null` while the settings are not known. */
export function withYoloMode(settings: LaunchSettings | null, on: boolean): LaunchSettings | null {
  return settings === null ? null : { ...settings, yoloMode: on }
}

/** The settings with an agent's change applied, or `null` while they are not known. */
export function withAgentLaunchSettingsChange(
  settings: LaunchSettings | null,
  id: CodingToolId,
  change: AgentLaunchSettingsChange,
): LaunchSettings | null {
  if (settings === null) return null
  return {
    ...settings,
    agents: {
      ...settings.agents,
      [id]: withLaunchSettingsChange(settings.agents[id], change),
    },
  }
}
