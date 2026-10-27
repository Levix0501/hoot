import {
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CodingToolId } from '../../shared/tools'
import { isWithin } from '../../shared/worktrees'
import { api } from '../lib/api'
import { sessionsSummary, sessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import type { WorktreeRow } from '../store/worktree-rows'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { StateLight } from './state-light'
import { Badge } from './ui/badge'
import { CollapsibleTrigger } from './ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton } from './ui/sidebar'

/** The parts a worktree's menus are made of: its `⋯` menu's, or its context menu's. */
interface WorktreeMenuComponents {
  Item: ComponentType<{
    children?: ReactNode
    variant?: 'default' | 'destructive'
    disabled?: boolean
    onClick?: () => void
    'data-testid'?: string
  }>
  Separator: ComponentType
  Sub: ComponentType<{ children?: ReactNode }>
  SubTrigger: ComponentType<{ children?: ReactNode; 'data-testid'?: string }>
  SubContent: ComponentType<{ children?: ReactNode; className?: string }>
}

const dropdownMenuComponents: WorktreeMenuComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}

const contextMenuComponents: WorktreeMenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
}

/** Below a menu item: why Delete is unavailable, or the lock that Remove overrides. */
function Note({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p className="max-w-64 px-1.5 pt-0.5 pb-1 text-xs text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  )
}

/** What the menus say about a locked worktree. */
function LockNote({ worktree }: { worktree: WorktreeRow }) {
  return (
    <Note testId="worktree-lock-note">
      This worktree is locked
      {worktree.lockReason ? (
        <>
          : <span data-user-text="">{worktree.lockReason}</span>
        </>
      ) : (
        '.'
      )}
    </Note>
  )
}

/**
 * What a worktree's `⋯` menu and its context menu hold, the same in both: the
 * agents to start a session with in the worktree, Reveal in Finder (File
 * Explorer on Windows), Copy Path and Delete; for a missing worktree, Remove.
 */
function WorktreeMenuEntries({
  components,
  projectRoot,
  worktree,
  testId,
}: {
  components: WorktreeMenuComponents
  projectRoot: string
  worktree: WorktreeRow
  /** The prefix of the items' test ids, which tells the `⋯` menu from the context menu. */
  testId: string
}) {
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const requestDeleteWorktree = useAppStore((state) => state.requestDeleteWorktree)
  const removeMissingWorktree = useAppStore((state) => state.removeMissingWorktree)
  // A worktree cannot be deleted while a session runs in it (or in a worktree inside it).
  const runningHere = useAppStore((state) =>
    state.sessions.some(
      (session) =>
        isSessionRunning(session) &&
        session.chatId === null &&
        isWithin(session.worktreePath ?? session.projectRoot, worktree.path),
    ),
  )
  const { Item, Separator, Sub, SubTrigger, SubContent } = components

  const startSession = (toolId: CodingToolId) =>
    void newWorktreeSession(projectRoot, worktree.path, toolId)
  const reveal = () => api.revealWorktree(projectRoot, worktree.path)
  const copyPath = () => api.copyWorktreePath(projectRoot, worktree.path)
  const remove = () => void removeMissingWorktree(projectRoot, worktree.path)
  const requestDelete = () => requestDeleteWorktree(projectRoot, worktree.path)
  const deletable = !worktree.locked && !runningHere
  // A missing worktree can always be removed, also a locked one: its lock note
  // shows below Remove.
  const removable = worktree.registered
  const deleteNote = worktree.locked ? (
    <LockNote worktree={worktree} />
  ) : runningHere ? (
    <Note testId="worktree-running-note">
      End the running sessions in this worktree before deleting it.
    </Note>
  ) : null

  if (worktree.missing) {
    return (
      <>
        <Item
          variant="destructive"
          disabled={!removable}
          onClick={remove}
          data-testid={`${testId}-remove`}
        >
          <Trash2Icon />
          Remove
        </Item>
        {worktree.locked && <LockNote worktree={worktree} />}
      </>
    )
  }

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
            testId="worktree-agent"
            failure="Could not start a session."
          />
        </SubContent>
      </Sub>
      <Item onClick={reveal} data-testid={`${testId}-reveal`}>
        <FolderOpenIcon />
        Reveal in {api.fileManager}
      </Item>
      <Item onClick={copyPath} data-testid={`${testId}-copy-path`}>
        <CopyIcon />
        Copy Path
      </Item>
      <Separator />
      <Item
        variant="destructive"
        disabled={!deletable}
        onClick={requestDelete}
        data-testid={`${testId}-delete`}
      >
        <Trash2Icon />
        Delete
      </Item>
      {deleteNote}
    </>
  )
}

/**
 * A worktree's row in the sidebar, below its project's sessions: click it to
 * expand or collapse the worktree. It shows a chevron, 12px further in than
 * the project's icon, which points right while the worktree is collapsed and
 * turns down as it expands; the worktree's name when Hoot made it with the New
 * Worktree dialog, otherwise its branch (or abbreviated commit); whether it
 * is missing or locked; and, while it is collapsed, at its right end, the
 * light of the state of its sessions that needs the user most, if any does.
 * Pointing at it, or moving the keyboard focus into it, shows its `⋯` button
 * in the light's place, which opens the same menu as a right click, and right
 * of it, unless the worktree is missing, its `+`, which starts a session in
 * the worktree with the agent a new chat would start with.
 */
export function WorktreeItem({
  projectRoot,
  worktree,
  expanded,
}: {
  projectRoot: string
  worktree: WorktreeRow
  expanded: boolean
}) {
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const states = useAppStore(
    useShallow((state) =>
      state.sessions
        .filter(
          (session) =>
            session.projectRoot === projectRoot && session.worktreePath === worktree.path,
        )
        .map((session) => sessionState(session)),
    ),
  )
  // Its rows show the sessions themselves while it is expanded.
  const summary = expanded ? null : sessionsSummary(states)
  const title = worktree.name ?? worktree.displayName
  // While they show, its buttons take the room of two, or of `⋯` alone for a missing worktree.
  const buttonsRoom = worktree.missing
    ? 'group-hover/menu-item:w-6 group-has-focus-visible/menu-item:w-6 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-6'
    : 'group-hover/menu-item:w-12 group-has-focus-visible/menu-item:w-12 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-12'

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="group/menu-item relative"
        data-testid="worktree-item"
        data-project-root={projectRoot}
        data-worktree-path={worktree.path}
        data-missing={worktree.missing}
        data-locked={worktree.locked}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              // Highlighted also while the pointer is on one of the buttons over it.
              className="cursor-default pl-5 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-2"
              data-testid="worktree-row"
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
            data-testid="worktree-chevron"
          >
            <ChevronRightIcon />
          </span>
          <span className="min-w-0 truncate" data-user-text="" data-testid="worktree-name">
            {title}
          </span>
          {worktree.missing && (
            <Badge variant="outline" className="shrink-0" data-testid="worktree-missing">
              Missing
            </Badge>
          )}
          {worktree.locked && (
            <Badge variant="secondary" className="shrink-0" data-testid="worktree-locked">
              Locked
            </Badge>
          )}
          {summary && (
            <>
              <StateLight
                state={summary.state}
                // At the row's right end, hidden while the row's buttons show in its place.
                className="ml-auto group-hover/menu-item:hidden group-has-focus-visible/menu-item:hidden group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:hidden"
                testId="worktree-light"
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
                className={cn('hover:bg-sidebar-foreground/10', !worktree.missing && 'right-7')}
                aria-label={`More actions for ${title}`}
                // Its label names the worktree.
                data-user-text=""
                data-testid="worktree-actions-button"
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
            <WorktreeMenuEntries
              components={dropdownMenuComponents}
              projectRoot={projectRoot}
              worktree={worktree}
              testId="worktree"
            />
          </DropdownMenuContent>
        </DropdownMenu>

        {!worktree.missing && (
          <SidebarMenuAction
            showOnHover
            className="hover:bg-sidebar-foreground/10"
            aria-label={`New session in ${title}`}
            data-user-text=""
            onClick={() => void newWorktreeSession(projectRoot, worktree.path)}
            data-testid="worktree-new-session-button"
          >
            <PlusIcon />
          </SidebarMenuAction>
        )}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <WorktreeMenuEntries
          components={contextMenuComponents}
          projectRoot={projectRoot}
          worktree={worktree}
          testId="worktree-context"
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
