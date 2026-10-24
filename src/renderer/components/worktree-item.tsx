import {
  CopyIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { CodingToolId } from '../../shared/tools'
import { isWithin } from '../../shared/worktrees'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import type { WorktreeRow } from '../store/worktree-rows'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { Badge } from './ui/badge'
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
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

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

/** The path of the worktree's root, and the relative paths of its inner members. */
function WorktreeTooltip({ worktree }: { worktree: WorktreeRow }) {
  return (
    <div className="grid gap-1 text-left" data-testid="worktree-tooltip">
      <span className="font-mono break-all" data-path="" data-testid="worktree-tooltip-path">
        {worktree.path}
      </span>
      {worktree.innerMembers.length > 0 && (
        <div className="grid gap-0.5">
          <span className="opacity-70">Includes</span>
          <ul className="grid gap-0.5">
            {worktree.innerMembers.map((member) => (
              <li
                key={member}
                className="font-mono break-all"
                data-path=""
                data-testid="worktree-tooltip-member"
              >
                {member}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
 * A worktree's row in the sidebar, below its project's sessions: a package
 * icon, its name when Hoot made it with the New Worktree dialog, otherwise
 * its branch (or abbreviated commit), and whether it is missing or locked.
 * Pointing at it for a moment shows its root's path and its inner members.
 * Pointing at it, or moving the keyboard focus into it, shows its `⋯` button,
 * which opens the same menu as a right click, and right of it, unless the
 * worktree is missing, its `+`, which starts a session in the worktree with
 * the agent a new chat would start with. Clicking the row itself does
 * nothing.
 */
export function WorktreeItem({
  projectRoot,
  worktree,
}: {
  projectRoot: string
  worktree: WorktreeRow
}) {
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const title = worktree.name ?? worktree.displayName

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        data-testid="worktree-item"
        data-project-root={projectRoot}
        data-worktree-path={worktree.path}
        data-missing={worktree.missing}
        data-locked={worktree.locked}
      >
        <Tooltip>
          <TooltipTrigger
            // Unlike the toolbar's buttons, a row shows its details only when pointed at for a moment.
            delay={400}
            render={
              <SidebarMenuButton
                render={<div />}
                // Highlighted also while the pointer is on one of the buttons over it.
                className="cursor-default pl-4 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-2"
                data-testid="worktree-row"
              />
            }
          >
            <PackageIcon />
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
            {/* Room for the row's buttons while they show. */}
            <span
              className={cn(
                '-ml-2 w-0 shrink-0',
                worktree.missing
                  ? 'group-hover/menu-item:w-6 group-has-focus-visible/menu-item:w-6 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-6'
                  : 'group-hover/menu-item:w-12 group-has-focus-visible/menu-item:w-12 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-12',
              )}
              aria-hidden
            />
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-80">
            <WorktreeTooltip worktree={worktree} />
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                // The button pointed at stands out on the highlighted row.
                className={cn('hover:bg-sidebar-foreground/10', !worktree.missing && 'right-7')}
                aria-label={`More actions for ${title}`}
                title="More Actions"
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
            title="New Session"
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
