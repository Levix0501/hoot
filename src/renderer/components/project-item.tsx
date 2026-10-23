import {
  FolderClosedIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import { isIssueOpen } from '../../shared/issues'
import type { ToolId } from '../../shared/tools'
import { api } from '../lib/api'
import { projectSummary, sessionState } from '../lib/session-state'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import { OpenIssueCount } from './open-issue-count'
import { StateLightWithTooltip } from './state-light'
import { CollapsibleTrigger } from './ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton } from './ui/sidebar'
import { ToolMenuEntries, type ToolMenuComponents } from './tool-menu-entries'

export const dropdownComponents: ToolMenuComponents = {
  Group: DropdownMenuGroup,
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Label: DropdownMenuLabel,
}

export const contextComponents: ToolMenuComponents = {
  Group: ContextMenuGroup,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Label: ContextMenuLabel,
}

/**
 * A project's row in the sidebar: click it to expand or collapse the project.
 * It shows the project's name; while the project is collapsed, right of the
 * name, the light of the state of its sessions that needs the user most, if
 * any does, which counts them when pointed at; and how many of its issues
 * are open. Pointing at it, or moving the keyboard focus into it, shows its
 * `+` and `⋯` buttons and its context menu, which start sessions, create
 * worktrees and remove the project.
 */
export function ProjectItem({ project, expanded }: { project: Project; expanded: boolean }) {
  const tools = useAppStore((state) => state.tools)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const newSession = useAppStore((state) => state.newSession)
  const removeProject = useAppStore((state) => state.removeProject)
  const redetectTools = useAppStore((state) => state.redetectTools)
  const showSettings = useAppStore((state) => state.showSettings)
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  const openIssues = useAppStore(
    (state) =>
      state.issues.filter((issue) => issue.projectId === project.id && isIssueOpen(issue)).length,
  )
  // The states of its sessions, in any of its worktrees.
  const states = useAppStore(
    useShallow((state) =>
      state.sessions
        .filter((session) => session.projectRoot === project.root)
        .map((session) => sessionState(session)),
    ),
  )
  // Its rows show the sessions themselves while it is expanded.
  const summary = expanded ? null : projectSummary(states)
  // A project cannot be removed while one of its sessions runs, in any of its worktrees.
  const runningHere = useAppStore((state) =>
    state.sessions.some(
      (session) => session.projectRoot === project.root && isSessionRunning(session),
    ),
  )

  const startSession = (toolId: ToolId) => newSession(project.root, toolId)
  const remove = () => void removeProject(project.root)
  const redetect = () => void redetectTools()
  // On macOS, a tool that is not installed is installed on the Agents page.
  const installInSettings = api.manageAgents ? () => showSettings('agents') : undefined
  const newWorktree = () => openNewWorktreeDialog(project.root)
  const Folder = expanded ? FolderOpenIcon : FolderClosedIcon

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="group/menu-item relative"
        data-testid="project-item"
        data-project-root={project.root}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              // Highlighted also while the pointer is on one of the buttons over it.
              className="cursor-default group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-2"
              data-testid="project-item-button"
            />
          }
        >
          <Folder data-testid="project-folder-icon" />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate" data-testid="project-name">
              {project.name}
            </span>
            {summary && (
              <StateLightWithTooltip
                state={summary.state}
                tooltip={summary.tooltip}
                testId="project-light"
              />
            )}
          </span>
          <OpenIssueCount count={openIssues} testId="project-open-issues" />
          {/* Room for the row's buttons while they show, right of the open issue count. */}
          <span
            className="-ml-2 w-0 shrink-0 group-hover/menu-item:w-12 group-has-focus-visible/menu-item:w-12 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-12"
            aria-hidden
          />
        </CollapsibleTrigger>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                className="right-1 hover:bg-sidebar-foreground/10"
                aria-label={`New session in ${project.name}`}
                title="New Session"
                data-testid="new-session-button"
              />
            }
          >
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-auto min-w-56"
            finalFocus={focusAfterOverlay}
          >
            <ToolMenuEntries
              components={dropdownComponents}
              tools={tools}
              launchSettings={launchSettings}
              onSelect={startSession}
              onRedetect={redetect}
              onInstall={installInSettings}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={newWorktree} data-testid="new-worktree">
              <GitBranchPlusIcon />
              New Worktree…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                className="right-7 hover:bg-sidebar-foreground/10"
                aria-label={`More actions for ${project.name}`}
                title="More Actions"
                data-testid="project-actions-button"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-auto min-w-44"
            finalFocus={focusAfterOverlay}
          >
            <DropdownMenuItem
              variant="destructive"
              disabled={runningHere}
              onClick={remove}
              data-testid="remove-project"
            >
              <Trash2Icon />
              Remove from list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="context-new-session">
            <PlusIcon />
            New Session
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-auto min-w-56">
            <ToolMenuEntries
              components={contextComponents}
              tools={tools}
              launchSettings={launchSettings}
              onSelect={startSession}
              onRedetect={redetect}
              onInstall={installInSettings}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={newWorktree} data-testid="context-new-worktree">
          <GitBranchPlusIcon />
          New Worktree…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={runningHere}
          onClick={remove}
          data-testid="context-remove-project"
        >
          <Trash2Icon />
          Remove from list
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
