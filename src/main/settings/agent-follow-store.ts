import Conf from 'conf'
import { valid } from 'semver'
import { belowMinimumVersion, type AgentFollow } from '../../shared/agents'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'

interface StoredSettings {
  /** What each agent's installation follows, for those that follow anything but its latest version. */
  agentFollow?: Partial<Record<CodingToolId, unknown>>
}

const LATEST: AgentFollow = { kind: 'latest' }

/**
 * What a stored value says an agent follows; its latest version for anything
 * else, and for a version older than the oldest Hoot works with, which it no
 * longer stays on.
 */
function followOf(tool: CodingToolId, stored: unknown): AgentFollow {
  if (typeof stored !== 'object' || stored === null) return LATEST
  const { kind, version } = stored as { kind?: unknown; version?: unknown }
  if (kind === 'stable' && tool === 'claude') return { kind: 'stable' }
  if (
    kind === 'stay' &&
    typeof version === 'string' &&
    valid(version) !== null &&
    !belowMinimumVersion(tool, version)
  ) {
    return { kind: 'stay', version }
  }
  return LATEST
}

/**
 * What each agent's installation follows, as the user picked it in its
 * version menu: its latest version, Claude Code's Stable, or a version it
 * stays on. Kept in `settings.json` in the user data directory, beside the
 * launch settings; Conf reads the file before every change and writes all
 * of it, so the settings do not overwrite each other.
 */
export class AgentFollowStore {
  private readonly config: Conf<StoredSettings>
  private readonly follows: Map<CodingToolId, AgentFollow>

  constructor(directory: string) {
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    const stored = this.config.get('agentFollow') ?? {}
    this.follows = new Map(CODING_TOOL_IDS.map((tool) => [tool, followOf(tool, stored[tool])]))
  }

  get(tool: CodingToolId): AgentFollow {
    return this.follows.get(tool) ?? LATEST
  }

  set(tool: CodingToolId, follow: AgentFollow): void {
    this.follows.set(tool, followOf(tool, follow))
    const stored: Partial<Record<CodingToolId, AgentFollow>> = {}
    for (const [id, value] of this.follows) if (value.kind !== 'latest') stored[id] = value
    try {
      this.config.set('agentFollow', stored)
    } catch (error) {
      // It holds until Hoot quits.
      console.error('Could not save what the agents follow:', error)
    }
  }
}
