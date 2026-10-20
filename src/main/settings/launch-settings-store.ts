import { EventEmitter } from 'node:events'
import Conf from 'conf'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  withLaunchSettingsChange,
  type AgentLaunchSettings,
  type AgentLaunchSettingsChange,
  type LaunchSettings,
} from '../../shared/launch-settings'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'

interface StoredSettings {
  /** What the Agents page keeps; absent until a setting is changed. */
  launchSettings?: unknown
}

function booleanOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function textOf(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value !== '' ? value : value === null ? null : fallback
}

function argumentsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null
  return value
}

/** An agent's settings as stored, with each invalid field replaced by its default. */
function readAgent(value: unknown): AgentLaunchSettings {
  const fallback = defaultAgentLaunchSettings()
  if (typeof value !== 'object' || value === null) return fallback
  const stored = value as Record<string, unknown>
  return {
    enabled: booleanOf(stored.enabled, fallback.enabled),
    model: textOf(stored.model, fallback.model),
    effort: textOf(stored.effort, fallback.effort),
    extraArgs: argumentsOf(stored.extraArgs) ?? fallback.extraArgs,
  }
}

function readSettings(value: unknown): LaunchSettings {
  const fallback = defaultLaunchSettings()
  if (typeof value !== 'object' || value === null) return fallback
  const stored = value as Record<string, unknown>
  const agents = stored.agents
  const agentSettings =
    typeof agents === 'object' && agents !== null ? (agents as Record<string, unknown>) : {}
  return {
    yoloMode: booleanOf(stored.yoloMode, fallback.yoloMode),
    agents: Object.fromEntries(
      CODING_TOOL_IDS.map((id) => [id, readAgent(agentSettings[id])]),
    ) as Record<CodingToolId, AgentLaunchSettings>,
  }
}

/**
 * The YOLO mode switch and the launch settings of each agent, kept in
 * `settings.json` in the user data directory. Sessions read them when they
 * start, so a change applies to the next session and never to a running one.
 * Permission levels saved by earlier versions are ignored.
 */
export class LaunchSettingsStore extends EventEmitter<{ changed: [LaunchSettings] }> {
  private readonly config: Conf<StoredSettings>
  private settings: LaunchSettings

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    this.settings = readSettings(this.config.get('launchSettings'))
  }

  all(): LaunchSettings {
    return this.settings
  }

  agent(id: CodingToolId): AgentLaunchSettings {
    return this.settings.agents[id]
  }

  /** Turns YOLO mode on or off, for the sessions that start from now on. */
  setYoloMode(on: boolean): void {
    if (this.settings.yoloMode === on) return
    this.settings = { ...this.settings, yoloMode: on }
    this.save()
  }

  /** Changes an agent's launch settings, for the sessions that start from now on. */
  change(id: CodingToolId, change: AgentLaunchSettingsChange): void {
    const current = this.settings.agents[id]
    const next = withLaunchSettingsChange(current, change)
    if (
      next.enabled === current.enabled &&
      next.model === current.model &&
      next.effort === current.effort &&
      next.extraArgs === current.extraArgs
    ) {
      return
    }
    this.settings = {
      ...this.settings,
      agents: { ...this.settings.agents, [id]: next },
    }
    this.save()
  }

  private save(): void {
    try {
      this.config.set('launchSettings', this.settings)
    } catch (error) {
      // The change still applies until Hoot quits.
      console.error('Could not save the launch settings:', error)
    }
    this.emit('changed', this.all())
  }
}
