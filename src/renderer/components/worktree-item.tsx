import {
  CopyIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CodingToolId } from '../../shared/tools'
import { isWithin } from '../../shared/worktrees'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import type { WorktreeRow } from '../store/worktree-rows'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { contextComponents, dropdownComponents } from './project-item'
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
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

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
 * A worktree's row in the sidebar, below its project's sessions: its name over
 * its branch (or abbreviated commit) when Hoot made it with the New Worktree
 * dialog, otherwise the branch alone, and whether it is missing or locked.
 * Pointing at it shows its root's path and its inner members. Its `+` opens
 * the agents to start a session with in the worktree; its `⋯` menu and its
 * context menu reveal it in Finder (File Explorer on Windows), copy its path
 * or delete it, or for a missing worktree remove it. Clicking the row itself
 * does nothing.
 */
export function WorktreeItem({
  projectRoot,
  worktree,
}: {
  projectRoot: string
  worktree: WorktreeRow
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

  const startSession = (toolId: CodingToolId) =>
    void newWorktreeSession(projectRoot, toolId, worktree.path)
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
                className={cn(
                  'cursor-default pl-4 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-14',
                  // A named worktree shows its name above its branch.
                  worktree.name !== null && 'h-auto py-1.5',
                )}
                data-testid="worktree-row"
              />
            }
          >
            {worktree.name === null ? (
              <>
                <GitBranchIcon />
                <span className="min-w-0 truncate" data-user-text="" data-testid="worktree-name">
                  {worktree.displayName}
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
              </>
            ) : (
              // A named worktree: its name alone above the branch icon and
              // the branch, which shows in the monospace font, or the
              // abbreviated commit when detached.
              <span className="grid min-w-0 flex-1 gap-0.5 pl-6 leading-tight">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate" data-user-text="" data-testid="worktree-name">
                    {worktree.name}
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
                </span>
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <GitBranchIcon className="size-3!" />
                  <span
                    className="truncate font-mono text-[11px]"
                    data-user-text=""
                    data-testid="worktree-branch"
                  >
                    {worktree.displayName}
                  </span>
                </span>
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-80">
            <WorktreeTooltip worktree={worktree} />
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={worktree.missing}
            render={
              <SidebarMenuAction
                // The button pointed at stands out on the highlighted row.
                className={cn(
                  'right-7 hover:bg-sidebar-foreground/10 disabled:pointer-events-none disabled:opacity-50',
                  // Level with the name on a named worktree's taller row.
                  worktree.name !== null && 'peer-data-[size=default]/menu-button:top-3',
                )}
                aria-label={`New session in ${worktree.displayName}`}
                title="New Session"
                // Its label names the branch.
                data-user-text=""
                data-testid="worktree-new-session-button"
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
            <ChatAgentMenuEntries
              components={dropdownComponents}
              onSelect={startSession}
              testId="worktree-agent"
              failure="Could not start a session."
            />
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                className={cn(
                  'hover:bg-sidebar-foreground/10',
                  worktree.name !== null && 'peer-data-[size=default]/menu-button:top-3',
                )}
                aria-label={`More actions for ${worktree.displayName}`}
                title="More Actions"
                data-user-text=""
                data-testid="worktree-actions-button"
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
            {worktree.missing ? (
              <>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!removable}
                  onClick={remove}
                  data-testid="worktree-remove"
                >
                  <Trash2Icon />
                  Remove
                </DropdownMenuItem>
                {worktree.locked && <LockNote worktree={worktree} />}
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={reveal} data-testid="worktree-reveal">
                  <FolderOpenIcon />
                  Reveal in {api.fileManager}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyPath} data-testid="worktree-copy-path">
                  <CopyIcon />
                  Copy Path
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!deletable}
                  onClick={requestDelete}
                  data-testid="worktree-delete"
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
                {deleteNote}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        {worktree.missing ? (
          <>
            <ContextMenuItem
              variant="destructive"
              disabled={!removable}
              onClick={remove}
              data-testid="worktree-context-remove"
            >
              <Trash2Icon />
              Remove
            </ContextMenuItem>
            {worktree.locked && <LockNote worktree={worktree} />}
          </>
        ) : (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger data-testid="worktree-context-new-session">
                <PlusIcon />
                New Session
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-auto min-w-56">
                <ChatAgentMenuEntries
                  components={contextComponents}
                  onSelect={startSession}
                  testId="worktree-agent"
                  failure="Could not start a session."
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onClick={reveal} data-testid="worktree-context-reveal">
              <FolderOpenIcon />
              Reveal in {api.fileManager}
            </ContextMenuItem>
            <ContextMenuItem onClick={copyPath} data-testid="worktree-context-copy-path">
              <CopyIcon />
              Copy Path
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!deletable}
              onClick={requestDelete}
              data-testid="worktree-context-delete"
            >
              <Trash2Icon />
              Delete
            </ContextMenuItem>
            {deleteNote}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
