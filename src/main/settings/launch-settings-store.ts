import { EventEmitter } from 'node:events'
import Conf from 'conf'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  type AgentLaunchSettings,
  type LaunchSettings,
} from '../../shared/launch-settings'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'

interface StoredSettings {
  /** What the Agents page keeps; absent until a setting is changed. */
  launchSettings?: unknown
}

/**
 * What an earlier Hoot kept for its agents before they were made of providers:
 * the launch settings of each coding tool, and the tool that was the default.
 */
interface LegacySettings {
  agents: Partial<Record<CodingToolId, AgentLaunchSettings>>
  defaultTool: CodingToolId | null
}

function booleanOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function textOf(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value !== '' ? value : value === null ? null : fallback
}

function toolOf(value: unknown): CodingToolId | null {
  return CODING_TOOL_IDS.find((id) => id === value) ?? null
}

function argumentsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null
  return value
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** An agent's settings as an earlier Hoot stored them, with each invalid field replaced by its default. */
function readAgent(value: unknown): AgentLaunchSettings {
  const fallback = defaultAgentLaunchSettings()
  const stored = recordOf(value)
  if (stored === null) return fallback
  return {
    enabled: booleanOf(stored.enabled, fallback.enabled),
    model: textOf(stored.model, fallback.model),
    effort: textOf(stored.effort, fallback.effort),
    extraArgs: argumentsOf(stored.extraArgs) ?? fallback.extraArgs,
  }
}

function readSettings(value: unknown): LaunchSettings {
  const fallback = defaultLaunchSettings()
  const stored = recordOf(value)
  if (stored === null) return fallback
  return {
    defaultAgent: textOf(stored.defaultAgentId, fallback.defaultAgent),
    yoloMode: booleanOf(stored.yoloMode, fallback.yoloMode),
  }
}

/** What an earlier Hoot kept for its agents, while it is still there; `null` when it is not. */
function readLegacy(value: unknown): LegacySettings | null {
  const stored = recordOf(value)
  if (stored === null) return null
  const agents = recordOf(stored.agents)
  const defaultTool = toolOf(stored.defaultAgent)
  if (agents === null && defaultTool === null) return null
  return {
    agents: Object.fromEntries(
      CODING_TOOL_IDS.flatMap((id) =>
        agents !== null && Object.hasOwn(agents, id) ? [[id, readAgent(agents[id])]] : [],
      ),
    ),
    defaultTool,
  }
}

/**
 * The default agent and the YOLO mode switch, kept in `settings.json` in the
 * user data directory. Sessions read YOLO mode when they start, so a change
 * to it applies to the next session and never to a running one. It also keeps
 * what an earlier Hoot kept for each coding tool, before agents were made of
 * providers, until Hoot drops it as it opens. Permission levels and the
 * switch for asking before a running session is closed, which earlier
 * versions kept, are ignored.
 */
export class LaunchSettingsStore extends EventEmitter<{ changed: [LaunchSettings] }> {
  private readonly config: Conf<StoredSettings>
  private settings: LaunchSettings
  private legacy: LegacySettings | null

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    const stored = this.config.get('launchSettings')
    this.settings = readSettings(stored)
    this.legacy = readLegacy(stored)
  }

  all(): LaunchSettings {
    return this.settings
  }

  /** Makes an agent the default agent, by its id, or none. */
  setDefaultAgent(id: string | null): void {
    if (this.settings.defaultAgent === id) return
    this.settings = { ...this.settings, defaultAgent: id }
    this.save()
  }

  /** Turns YOLO mode on or off, for the sessions that start from now on. */
  setYoloMode(on: boolean): void {
    if (this.settings.yoloMode === on) return
    this.settings = { ...this.settings, yoloMode: on }
    this.save()
  }

  /**
   * The launch settings an earlier Hoot kept for a coding tool, which the
   * first agent made of it takes; `null` when there are none.
   */
  legacyAgent(tool: CodingToolId): AgentLaunchSettings | null {
    return this.legacy?.agents[tool] ?? null
  }

  /** The coding tool an earlier Hoot had for the default agent; `null` for none. */
  legacyDefaultTool(): CodingToolId | null {
    return this.legacy?.defaultTool ?? null
  }

  /** Forgets what an earlier Hoot kept for its coding tools, once the agents took it. */
  dropLegacy(): void {
    if (this.legacy === null) return
    this.legacy = null
    this.save()
  }

  private save(): void {
    try {
      this.config.set('launchSettings', {
        ...(this.legacy === null
          ? {}
          : { agents: this.legacy.agents, defaultAgent: this.legacy.defaultTool }),
        defaultAgentId: this.settings.defaultAgent,
        yoloMode: this.settings.yoloMode,
      })
    } catch (error) {
      // The change still applies until Hoot quits.
      console.error('Could not save the launch settings:', error)
    }
    this.emit('changed', this.all())
  }
}
