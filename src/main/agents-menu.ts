import type { MenuItemConstructorOptions } from 'electron'
import { PERMISSION_LEVELS, type PermissionLevelSettings } from '../shared/permission-levels'
import { CODING_TOOL_IDS, getTool, type CodingToolId } from '../shared/tools'

export interface AgentsMenuOptions {
  /** The selected level of each coding tool, checked in the menu. */
  selected: PermissionLevelSettings
  selectPermissionLevel(tool: CodingToolId, level: string): void
}

/**
 * The Agents menu: a submenu for each coding tool that lists its permission
 * levels as radio items. Picking one selects it for the sessions that start
 * from then on.
 */
export function agentsMenuTemplate(options: AgentsMenuOptions): MenuItemConstructorOptions {
  return {
    label: 'Agents',
    submenu: CODING_TOOL_IDS.map((tool) => ({
      label: getTool(tool).label,
      submenu: PERMISSION_LEVELS[tool].map((level) => ({
        label: level.label,
        type: 'radio' as const,
        checked: options.selected[tool] === level.id,
        click: () => options.selectPermissionLevel(tool, level.id),
      })),
    })),
  }
}
