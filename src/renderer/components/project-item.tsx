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
import { sessionsSummary, sessionState } from '../lib/session-state'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import type { ChatMenuComponents } from './chat-agent-menu'
import { StateLight } from './state-light'
import { CollapsibleTrigger } from './ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton } from './ui/sidebar'

export const dropdownComponents: ChatMenuComponents = { Item: DropdownMenuItem }

export const contextComponents: ChatMenuComponents = { Item: ContextMenuItem }

/**
 * A project's row in the sidebar: click it to expand or collapse the project.
 * It shows the project's name and, while the project is collapsed, at its
 * right end, the light of the state of its sessions that needs the user most,
 * if any does. Pointing at it, or moving the keyboard focus into it, shows its
 * `⋯` and `+` buttons in the light's place, and its context menu: `+` and New
 * Worktree… open the New Worktree dialog, and the context menu also removes
 * the project.
 */
export function ProjectItem({ project, expanded }: { project: Project; expanded: boolean }) {
  const removeProject = useAppStore((state) => state.removeProject)
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  // The states of its sessions, in any of its worktrees.
  const states = useAppStore(
    useShallow((state) =>
      state.sessions
        .filter((session) => session.projectRoot === project.root)
        .map((session) => sessionState(session)),
    ),
  )
  // Its rows show the sessions themselves while it is expanded.
  const summary = expanded ? null : sessionsSummary(states)
  // A project cannot be removed while one of its sessions runs, in any of its worktrees.
  const runningHere = useAppStore((state) =>
    state.sessions.some(
      (session) => session.projectRoot === project.root && isSessionRunning(session),
    ),
  )

  const remove = () => void removeProject(project.root)
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
          <span className="min-w-0 flex-1 truncate" data-testid="project-name">
            {project.name}
          </span>
          {summary && (
            <>
              <StateLight
                state={summary.state}
                // Hidden while the row's buttons show in its place.
                className="group-hover/menu-item:hidden group-has-focus-visible/menu-item:hidden group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:hidden"
                testId="project-light"
              />
              <span className="sr-only">{summary.description}</span>
            </>
          )}
          {/* Room for the row's buttons while they show, taking back the gap before it. */}
          <span
            className="-ml-1.5 w-0 shrink-0 group-hover/menu-item:w-12 group-has-focus-visible/menu-item:w-12 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-12"
            aria-hidden
          />
        </CollapsibleTrigger>

        <SidebarMenuAction
          showOnHover
          className="right-1 hover:bg-sidebar-foreground/10"
          aria-label={`New worktree in ${project.name}`}
          onClick={newWorktree}
          data-testid="new-worktree-button"
        >
          <PlusIcon />
        </SidebarMenuAction>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                className="right-7 hover:bg-sidebar-foreground/10"
                aria-label={`More actions for ${project.name}`}
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
