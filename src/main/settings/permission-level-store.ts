import { EventEmitter } from 'node:events'
import Conf from 'conf'
import {
  findPermissionLevel,
  permissionLevelOrDefault,
  type PermissionLevel,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'

interface StoredSettings {
  /** Only the levels the user picked; a tool without an entry uses its highest level. */
  permissionLevels?: Partial<Record<CodingToolId, string>>
}

/**
 * The permission level selected for each coding tool, kept in `settings.json`
 * in the user data directory. Sessions read it when they start, so a change
 * applies to the next session that starts and never to a running one.
 */
export class PermissionLevelStore extends EventEmitter<{ changed: [PermissionLevelSettings] }> {
  private readonly config: Conf<StoredSettings>
  private selected: PermissionLevelSettings

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    const stored: unknown = this.config.get('permissionLevels')
    const pick = (tool: CodingToolId) =>
      permissionLevelOrDefault(
        tool,
        typeof stored === 'object' && stored !== null
          ? (stored as Record<string, unknown>)[tool]
          : undefined,
      ).id
    this.selected = Object.fromEntries(
      CODING_TOOL_IDS.map((tool) => [tool, pick(tool)]),
    ) as PermissionLevelSettings
  }

  /** The id of the selected level of every coding tool. */
  all(): PermissionLevelSettings {
    return { ...this.selected }
  }

  /** The selected level of a coding tool. */
  level(tool: CodingToolId): PermissionLevel {
    return permissionLevelOrDefault(tool, this.selected[tool])
  }

  /** Selects one of the tool's levels and saves the choice; other ids are ignored. */
  select(tool: CodingToolId, id: string): void {
    const level = findPermissionLevel(tool, id)
    if (!level || this.selected[tool] === level.id) return
    this.selected = { ...this.selected, [tool]: level.id }
    try {
      this.config.set(`permissionLevels.${tool}`, level.id)
    } catch (error) {
      // The choice still applies until Hoot quits.
      console.error(`Could not save the permission level of ${tool}:`, error)
    }
    this.emit('changed', this.all())
  }
}
