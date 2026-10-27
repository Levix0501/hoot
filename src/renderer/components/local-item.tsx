import {
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import type { CodingToolId } from '../../shared/tools'
import { api } from '../lib/api'
import { sessionsSummary, sessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { contextMenuParts, dropdownMenuParts, type MenuParts } from './menu-parts'
import { NewWorktreeSessionButton } from './new-worktree-session-button'
import { StateLight } from './state-light'
import { Badge } from './ui/badge'
import { CollapsibleTrigger } from './ui/collapsible'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from './ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton } from './ui/sidebar'

/**
 * What a project's Local row's `⋯` menu and its context menu hold, the same
 * in both: the agents to start a session with in the project's own folder,
 * Reveal in Finder (File Explorer on Windows) and Copy Path, as a
 * worktree's menus hold them. There is no Delete: the folder is the
 * project's, and the row goes once its sessions do.
 */
function LocalMenuEntries({
  components,
  project,
  testId,
}: {
  components: MenuParts
  project: Project
  /** The prefix of the items' test ids, which tells the `⋯` menu from the context menu. */
  testId: string
}) {
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const missing = useAppStore((state) => state.projectFolders[project.root]?.missing === true)
  const { Item, Sub, SubTrigger, SubContent } = components

  const startSession = (toolId: CodingToolId) => void newWorktreeSession(project.root, null, toolId)
  const reveal = () => api.revealProjectFolder(project.root)
  const copyPath = () => api.copyProjectFolderPath(project.root)

  return (
    <>
      <Sub>
        <SubTrigger data-testid={`${testId}-new-session`}>
          <PlusIcon />
          New Session
        </SubTrigger>
        <SubContent className="w-auto min-w-56">
          <ChatAgentMenuEntries
            components={components}
            onSelect={startSession}
            testId="local-agent"
            failure="Could not start a session."
          />
        </SubContent>
      </Sub>
      <Item disabled={missing} onClick={reveal} data-testid={`${testId}-reveal`}>
        <FolderOpenIcon />
        Reveal in {api.fileManager}
      </Item>
      <Item onClick={copyPath} data-testid={`${testId}-copy-path`}>
        <CopyIcon />
        Copy Path
      </Item>
    </>
  )
}

/**
 * A project's Local row in the sidebar, for the sessions in the project's
 * own folder, first below the project's row: click it to expand or collapse
 * them. It shows what a worktree row shows: a chevron that turns as they
 * slide; "Local", and after it, lighter, the branch checked out in the
 * folder, or the abbreviated commit while HEAD is on no branch; whether the
 * folder is missing; and, while it is collapsed, at its right end, the light
 * of the state of its sessions that needs the user most, if any does.
 * Pointing at it, or moving the keyboard focus into it, shows its `⋯` button
 * in the light's place, which opens the same menu as a right click, and
 * right of it, unless the folder is missing, its `+`, which starts a session
 * in the folder as a worktree's `+` does in the worktree.
 */
export function LocalItem({ project, expanded }: { project: Project; expanded: boolean }) {
  const states = useAppStore(
    useShallow((state) =>
      state.sessions
        .filter(
          (session) =>
            session.chatId === null &&
            session.projectRoot === project.root &&
            session.worktreePath === null,
        )
        .map((session) => sessionState(session)),
    ),
  )
  const folder = useAppStore((state) => state.projectFolders[project.root])
  const missing = folder?.missing === true
  // Its rows show the sessions themselves while it is expanded.
  const summary = expanded ? null : sessionsSummary(states)
  // While they show, its buttons take the room of two, or of `⋯` alone while the folder is missing.
  const buttonsRoom = missing
    ? 'group-hover/menu-item:w-6 group-has-focus-visible/menu-item:w-6 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-6'
    : 'group-hover/menu-item:w-12 group-has-focus-visible/menu-item:w-12 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-12'

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="group/menu-item relative"
        data-testid="local-item"
        data-project-root={project.root}
        data-missing={missing}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              // Highlighted also while the pointer is on one of the buttons over it.
              className="cursor-default pl-5 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-2"
              data-testid="local-row"
            />
          }
        >
          {/*
            It turns as the rows below slide. Its box turns rather than the
            icon itself, which Chromium would turn without the GPU.
          */}
          <span
            className={cn(
              'flex shrink-0 transition-[rotate] duration-200 ease-linear motion-reduce:duration-0',
              expanded && 'rotate-90',
            )}
            data-testid="local-chevron"
          >
            <ChevronRightIcon />
          </span>
          <span className="shrink-0" data-testid="local-name">
            Local
          </span>
          {folder !== undefined && folder.displayName !== '' && (
            <span
              className="min-w-0 truncate text-muted-foreground"
              data-user-text=""
              data-testid="local-branch"
            >
              {folder.displayName}
            </span>
          )}
          {missing && (
            <Badge variant="outline" className="shrink-0" data-testid="local-missing">
              Missing
            </Badge>
          )}
          {summary && (
            <>
              <StateLight
                state={summary.state}
                // At the row's right end, hidden while the row's buttons show in its place.
                className="ml-auto group-hover/menu-item:hidden group-has-focus-visible/menu-item:hidden group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:hidden"
                testId="local-light"
              />
              <span className="sr-only">{summary.description}</span>
            </>
          )}
          {/* Room for the row's buttons while they show, taking back the gap before it. */}
          <span className={cn('-ml-1.5 w-0 shrink-0', buttonsRoom)} aria-hidden />
        </CollapsibleTrigger>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                // The button pointed at stands out on the highlighted row.
                className={cn('hover:bg-sidebar-foreground/10', !missing && 'right-7')}
                aria-label={`More actions for Local in ${project.name}`}
                data-testid="local-actions-button"
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
            <LocalMenuEntries components={dropdownMenuParts} project={project} testId="local" />
          </DropdownMenuContent>
        </DropdownMenu>

        {!missing && (
          <NewWorktreeSessionButton
            projectRoot={project.root}
            worktreePath={null}
            testId="local-new-session-agent"
            render={
              <SidebarMenuAction
                showOnHover
                className="hover:bg-sidebar-foreground/10"
                aria-label={`New session in Local of ${project.name}`}
                data-testid="local-new-session-button"
              />
            }
          >
            <PlusIcon />
          </NewWorktreeSessionButton>
        )}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <LocalMenuEntries components={contextMenuParts} project={project} testId="local-context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
