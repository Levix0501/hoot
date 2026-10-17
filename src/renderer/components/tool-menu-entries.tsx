import { RefreshCwIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ToolsState } from '../../shared/ipc'
import {
  permissionLevelOrDefault,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import { TOOLS, type ToolId } from '../../shared/tools'
import { toolStatus } from '../../shared/tool-status'
import { ToolIcon } from './tool-icon'

interface ItemProps {
  children?: ReactNode
  disabled?: boolean
  closeOnClick?: boolean
  onClick?: () => void
  className?: string
  'data-testid'?: string
}

export interface ToolMenuComponents {
  Group: ComponentType<{ children?: ReactNode }>
  Item: ComponentType<ItemProps>
  Separator: ComponentType
  Label: ComponentType<{ children?: ReactNode }>
}

interface ToolMenuEntriesProps {
  components: ToolMenuComponents
  tools: ToolsState
  /** The permission level selected for each coding tool, shown next to it once known. */
  permissionLevels: PermissionLevelSettings | null
  onSelect: (toolId: ToolId) => void
  onRedetect: () => void
  /**
   * Shows the settings' Agents page, where a tool that is not installed can
   * be installed; without it, as on Windows, the menu gives the tool's
   * install command instead.
   */
  onInstall?: () => void
}

/**
 * The tool choices of a "new session" menu, with the permission level each
 * coding tool starts with, and availability: below a tool that is not
 * installed, "Install in Settings…", or where Hoot does not install tools,
 * its install command.
 */
export function ToolMenuEntries({
  components,
  tools,
  permissionLevels,
  onSelect,
  onRedetect,
  onInstall,
}: ToolMenuEntriesProps) {
  const { Group, Item, Separator, Label } = components
  return (
    <>
      <Group>
        <Label>Start a session with</Label>
        {TOOLS.map((tool) => {
          const status = toolStatus(tools, tool)
          const available = status === 'available'
          const unknown = status === 'checking'
          const level =
            tool.command !== null && permissionLevels
              ? permissionLevelOrDefault(tool.id, permissionLevels[tool.id])
              : null
          return (
            <div key={tool.id} data-testid={`tool-entry-${tool.id}`} data-available={available}>
              <Item
                disabled={!available}
                onClick={() => onSelect(tool.id)}
                data-testid={`tool-${tool.id}`}
              >
                <ToolIcon toolId={tool.id} />
                <span className="flex items-baseline gap-2">
                  <span data-testid={`tool-label-${tool.id}`}>{tool.label}</span>
                  {level && (
                    // Stays muted while the item is highlighted, so it always reads as
                    // secondary to the tool name.
                    <span
                      className="text-xs text-muted-foreground!"
                      data-testid={`tool-permission-level-${tool.id}`}
                    >
                      {level.label}
                    </span>
                  )}
                </span>
                {!available && (
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    {unknown ? 'Checking…' : 'Not installed'}
                  </span>
                )}
              </Item>
              {!available && !unknown && onInstall && (
                <Item
                  onClick={onInstall}
                  className="pl-7 text-xs text-muted-foreground"
                  data-testid={`install-in-settings-${tool.id}`}
                >
                  Install in Settings…
                </Item>
              )}
              {!available && !unknown && !onInstall && tool.installCommand && (
                <div className="flex items-baseline gap-1.5 pr-2 pb-1.5 pl-7 text-xs text-muted-foreground">
                  <span>Install:</span>
                  <code
                    className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground select-text"
                    data-testid={`install-command-${tool.id}`}
                  >
                    {tool.installCommand}
                  </code>
                </div>
              )}
            </div>
          )
        })}
      </Group>
      <Separator />
      {tools.error && (
        <p className="max-w-72 px-2 py-1 text-xs text-destructive" title={tools.error}>
          Could not read the login shell environment.
        </p>
      )}
      <Item
        closeOnClick={false}
        disabled={tools.detecting}
        onClick={onRedetect}
        data-testid="redetect-tools"
      >
        <RefreshCwIcon className={tools.detecting ? 'animate-spin' : undefined} />
        <span>{tools.detecting ? 'Detecting tools…' : 'Re-detect Tools'}</span>
      </Item>
    </>
  )
}
