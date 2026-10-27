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
import type { CodingToolId } from '../../shared/tools'
import { sessionsSummary, sessionState } from '../lib/session-state'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import { ChatAgentMenuEntries, type ChatMenuComponents } from './chat-agent-menu'
import { contextMenuParts, dropdownMenuParts, type MenuParts } from './menu-parts'
import { StateLight } from './state-light'
import { CollapsibleTrigger } from './ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
 * What a project's `⋯` menu and its context menu hold, the same in both: the
 * agents to start a session with in the project's own folder, as a
 * worktree's New Session ▸ lists them; New Worktree…, which opens the New
 * Worktree dialog; and Remove from list, which cannot be chosen while one of
 * the project's sessions runs, in its folder or any of its worktrees.
 */
function ProjectMenuEntries({
  components,
  project,
  testId,
}: {
  components: MenuParts
  project: Project
  /** The prefix of the items' test ids, which tells the `⋯` menu from the context menu. */
  testId: string
}) {
  const removeProject = useAppStore((state) => state.removeProject)
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const runningHere = useAppStore((state) =>
    state.sessions.some(
      (session) => session.projectRoot === project.root && isSessionRunning(session),
    ),
  )
  const { Item, Separator, Sub, SubTrigger, SubContent } = components

  const startLocalSession = (toolId: CodingToolId) =>
    void newWorktreeSession(project.root, null, toolId)

  return (
    <>
      <Sub>
        <SubTrigger data-testid={`${testId}-new-local-session`}>
          <PlusIcon />
          New Local Session
        </SubTrigger>
        <SubContent className="w-auto min-w-56">
          <ChatAgentMenuEntries
            components={components}
            onSelect={startLocalSession}
            testId="project-agent"
            failure="Could not start a session."
          />
        </SubContent>
      </Sub>
      <Item
        onClick={() => openNewWorktreeDialog(project.root)}
        data-testid={`${testId}-new-worktree`}
      >
        <GitBranchPlusIcon />
        New Worktree…
      </Item>
      <Separator />
      <Item
        variant="destructive"
        disabled={runningHere}
        onClick={() => void removeProject(project.root)}
        data-testid={`${testId}-remove-project`}
      >
        <Trash2Icon />
        Remove from list
      </Item>
    </>
  )
}

/**
 * A project's row in the sidebar: click it to expand or collapse the project.
 * It shows the project's name and, while the project is collapsed, at its
 * right end, the light of the state of its sessions that needs the user most,
 * if any does. Pointing at it, or moving the keyboard focus into it, shows its
 * `⋯` and `+` buttons in the light's place: `+` opens the New Worktree
 * dialog, and `⋯` the same menu as a right click.
 */
export function ProjectItem({ project, expanded }: { project: Project; expanded: boolean }) {
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  // The states of its sessions, in its own folder and any of its worktrees.
  const states = useAppStore(
    useShallow((state) =>
      state.sessions
        .filter((session) => session.projectRoot === project.root)
        .map((session) => sessionState(session)),
    ),
  )
  // Its rows show the sessions themselves while it is expanded.
  const summary = expanded ? null : sessionsSummary(states)

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
            className="w-auto min-w-48"
            finalFocus={focusAfterOverlay}
          >
            <ProjectMenuEntries
              components={dropdownMenuParts}
              project={project}
              testId="project-actions"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <ProjectMenuEntries components={contextMenuParts} project={project} testId="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
