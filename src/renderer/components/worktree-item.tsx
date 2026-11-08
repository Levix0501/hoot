import {
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  GitMergeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { CodingToolId } from '../../shared/tools'
import { api } from '../lib/api'
import { sessionsSummary, sessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
import type { WorktreeRow } from '../store/worktree-rows'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { contextMenuParts, dropdownMenuParts, type MenuParts } from './menu-parts'
import { NewSessionMenuEntries } from './new-session-menu-entries'
import { NewWorktreeSessionButton } from './new-worktree-session-button'
import { StateLight } from './state-light'
import { Badge } from './ui/badge'
import { CollapsibleTrigger } from './ui/collapsible'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from './ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton } from './ui/sidebar'

/**
 * What the menus say about a locked worktree, below Delete or Remove, which
 * the lock does not stop: the agent chosen to delete it judges what to do.
 */
function LockNote({ worktree }: { worktree: WorktreeRow }) {
  return (
    <p
      className="max-w-64 px-1.5 pt-0.5 pb-1 text-xs text-muted-foreground"
      data-testid="worktree-lock-note"
    >
      This worktree is locked
      {worktree.lockReason ? (
        <>
          : <span data-user-text="">{worktree.lockReason}</span>
        </>
      ) : (
        '.'
      )}
    </p>
  )
}

/**
 * What a worktree's `⋯` menu and its context menu hold, the same in both: the
 * agents to start a session with in the worktree, and Terminal, which starts
 * a Terminal session in it; New Worktree…, which opens the New Worktree
 * dialog for a worktree made from this one; the agents to merge it with into
 * the branch checked out in the project folder, which the item names (only
 * "Merge" while the folder is on no branch); Reveal in Finder (File Explorer
 * on Windows) and Copy Path; and the agents to delete it with, together with
 * its branch. Merge and Delete are always available, as the agent chosen
 * judges what to do about anything in the way. A missing worktree's menus
 * hold only Remove.
 */
function WorktreeMenuEntries({
  components,
  projectRoot,
  worktree,
  testId,
}: {
  components: MenuParts
  projectRoot: string
  worktree: WorktreeRow
  /** The prefix of the items' test ids, which tells the `⋯` menu from the context menu. */
  testId: string
}) {
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  const mergeWorktree = useAppStore((state) => state.mergeWorktree)
  const into = useAppStore((state) => state.projectFolders[projectRoot]?.branch ?? null)
  const deleteWorktree = useAppStore((state) => state.deleteWorktree)
  const removeMissingWorktree = useAppStore((state) => state.removeMissingWorktree)
  const { Item, Separator, Sub, SubTrigger, SubContent } = components

  const newWorktree = () =>
    openNewWorktreeDialog(projectRoot, {
      path: worktree.path,
      name: worktree.name ?? worktree.displayName,
    })
  const merge = (toolId: CodingToolId) => void mergeWorktree(projectRoot, worktree.path, toolId)
  const reveal = () => api.revealWorktree(projectRoot, worktree.path)
  const copyPath = () => api.copyWorktreePath(projectRoot, worktree.path)
  const remove = () => void removeMissingWorktree(projectRoot, worktree.path)
  const deleteWith = (toolId: CodingToolId) =>
    void deleteWorktree(projectRoot, worktree.path, toolId)

  // A missing worktree can always be removed: also a locked one, whose lock
  // note shows below Remove, one Git no longer lists, and one with open
  // sessions, which Hoot asks to close first.
  if (worktree.missing) {
    return (
      <>
        <Item variant="destructive" onClick={remove} data-testid={`${testId}-remove`}>
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
          <NewSessionMenuEntries
            components={components}
            projectRoot={projectRoot}
            worktreePath={worktree.path}
            testId="worktree-agent"
          />
        </SubContent>
      </Sub>
      <Item onClick={newWorktree} data-testid={`${testId}-new-worktree`}>
        <GitBranchPlusIcon />
        New Worktree…
      </Item>
      <Sub>
        <SubTrigger data-testid={`${testId}-merge`}>
          <GitMergeIcon />
          {into === null ? (
            'Merge'
          ) : (
            // A long branch name widens the menu only so far.
            <span className="max-w-80 min-w-0 truncate">
              Merge into <span data-user-text="">{into}</span>
            </span>
          )}
        </SubTrigger>
        <SubContent className="w-auto min-w-56">
          <ChatAgentMenuEntries
            components={components}
            onSelect={merge}
            testId="worktree-merge-agent"
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
      <Sub>
        <SubTrigger
          // Red like a destructive item, its icons too: marked as one, the
          // trigger no longer gives them the highlight's color.
          className="text-destructive focus:bg-destructive/10 focus:text-destructive data-open:bg-destructive/10 data-open:text-destructive data-popup-open:bg-destructive/10 data-popup-open:text-destructive dark:focus:bg-destructive/20 dark:data-open:bg-destructive/20 dark:data-popup-open:bg-destructive/20"
          data-variant="destructive"
          data-testid={`${testId}-delete`}
        >
          <Trash2Icon />
          Delete
        </SubTrigger>
        <SubContent className="w-auto min-w-56">
          <ChatAgentMenuEntries
            components={components}
            onSelect={deleteWith}
            testId="worktree-delete-agent"
            failure="Could not start a session."
          />
        </SubContent>
      </Sub>
      {worktree.locked && <LockNote worktree={worktree} />}
    </>
  )
}

/**
 * A worktree's row in the sidebar, below its project's Local row, if it has
 * one: click it to expand or collapse the worktree. It shows a chevron, 12px
 * further in than the project's icon, which points right while the worktree
 * is collapsed and turns down as it expands; the worktree's name when Hoot
 * made it with the New Worktree dialog, otherwise its branch (or abbreviated
 * commit); whether it is missing or locked; and, while it is collapsed and
 * has sessions, at its right end, the light of their most pressing state: one
 * that needs the user before one at work, and one at work before an idle or
 * running one.
 * Pointing at it, or moving the keyboard focus into it, shows its `⋯` button
 * in the light's place, which opens the same menu as a right click, and right
 * of it, unless the worktree is missing, its `+`, whose menu starts a session
 * in the worktree with the agent chosen, or a Terminal session.
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
              components={dropdownMenuParts}
              projectRoot={projectRoot}
              worktree={worktree}
              testId="worktree"
            />
          </DropdownMenuContent>
        </DropdownMenu>

        {!worktree.missing && (
          <NewWorktreeSessionButton
            projectRoot={projectRoot}
            worktreePath={worktree.path}
            testId="worktree-new-session-agent"
            render={
              <SidebarMenuAction
                showOnHover
                className="hover:bg-sidebar-foreground/10"
                aria-label={`New session in ${title}`}
                data-user-text=""
                data-testid="worktree-new-session-button"
              />
            }
          >
            <PlusIcon />
          </NewWorktreeSessionButton>
        )}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <WorktreeMenuEntries
          components={contextMenuParts}
          projectRoot={projectRoot}
          worktree={worktree}
          testId="worktree-context"
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
