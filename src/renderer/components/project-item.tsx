import {
  CircleDotIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { Project } from '../../shared/ipc'
import { isIssueOpen } from '../../shared/issues'
import { displayPath } from '../../shared/paths'
import type { ToolId } from '../../shared/tools'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
import { isIssuesPage } from '../store/page-history'
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'
import { Separator } from './ui/separator'
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

/** How long the pointer rests on a project's row before its card shows, in milliseconds. */
const CARD_DELAY = 600

/** The card beside a project's row: the project's name, then its folder. */
function ProjectCard({ project }: { project: Project }) {
  const homeDirectory = useAppStore((state) => state.homeDirectory)
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2 font-medium">
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" data-user-text="" data-testid="project-card-name">
          {project.name}
        </span>
      </div>
      <Separator />
      <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
        <FolderIcon className="size-4 shrink-0" />
        <span className="min-w-0 break-all" data-path="" data-testid="project-card-path">
          {displayPath(project.root, homeDirectory)}
        </span>
      </div>
    </div>
  )
}

/**
 * A project's row in the sidebar: click it to expand or collapse the project.
 * It shows the project's name, and how many of its issues are open; it is
 * selected while one of its Issues pages is shown. Pointing at it, or moving
 * the keyboard focus into it, shows its buttons: Issues shows the project's
 * issue list, and `+`, `⋯` and its context menu start sessions, create
 * worktrees and remove the project. Resting the pointer on it shows its card.
 */
export function ProjectItem({ project, expanded }: { project: Project; expanded: boolean }) {
  const tools = useAppStore((state) => state.tools)
  const permissionLevels = useAppStore((state) => state.permissionLevels)
  const newSession = useAppStore((state) => state.newSession)
  const removeProject = useAppStore((state) => state.removeProject)
  const redetectTools = useAppStore((state) => state.redetectTools)
  const openNewWorktreeDialog = useAppStore((state) => state.openNewWorktreeDialog)
  const showIssueList = useAppStore((state) => state.showIssueList)
  const openIssues = useAppStore(
    (state) =>
      state.issues.filter((issue) => issue.projectId === project.id && isIssueOpen(issue)).length,
  )
  const selected = useAppStore(
    (state) => isIssuesPage(state.currentPage) && state.currentPage.projectId === project.id,
  )
  // A project cannot be removed while one of its sessions runs, in any of its worktrees.
  const runningHere = useAppStore((state) =>
    state.sessions.some(
      (session) => session.projectRoot === project.root && isSessionRunning(session),
    ),
  )

  const startSession = (toolId: ToolId) => newSession(project.root, toolId)
  const remove = () => void removeProject(project.root)
  const redetect = () => void redetectTools()
  const newWorktree = () => openNewWorktreeDialog(project.root)
  const Folder = expanded ? FolderOpenIcon : FolderIcon

  return (
    <HoverCard
      onOpenChange={(open, details) => {
        // Only the pointer resting on the row shows the card, not the keyboard focus.
        if (open && details.reason === 'trigger-focus') details.cancel()
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={<HoverCardTrigger delay={CARD_DELAY} render={<div />} />}
          className="group/menu-item relative"
          data-testid="project-item"
          data-project-root={project.root}
        >
          <CollapsibleTrigger
            render={
              <SidebarMenuButton
                isActive={selected}
                className="cursor-default group-has-data-[sidebar=menu-action]/menu-item:pr-2"
                data-testid="project-item-button"
              />
            }
          >
            <Folder className="text-muted-foreground" data-testid="project-folder-icon" />
            <span className="min-w-0 flex-1 truncate font-medium" data-testid="project-name">
              {project.name}
            </span>
            {openIssues > 0 && (
              <span
                className="shrink-0 rounded-full bg-sidebar-foreground/10 px-1.5 text-xs font-medium tabular-nums"
                title={openIssues === 1 ? '1 open issue' : `${openIssues} open issues`}
                data-testid="project-open-issues"
              >
                {openIssues}
              </span>
            )}
            {/* Room for the row's buttons while they show, right of the open issue count. */}
            <span
              className="-ml-2 w-0 shrink-0 group-focus-within/menu-item:w-18 group-hover/menu-item:w-18 group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:w-18"
              aria-hidden
            />
          </CollapsibleTrigger>

          <SidebarMenuAction
            showOnHover
            className="right-13"
            onClick={() => showIssueList(project.id)}
            aria-label={`Issues of ${project.name}`}
            title="Issues"
            data-testid="project-issues-button"
          >
            <CircleDotIcon />
          </SidebarMenuAction>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuAction
                  showOnHover
                  className="right-7"
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
                permissionLevels={permissionLevels}
                onSelect={startSession}
                onRedetect={redetect}
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
                permissionLevels={permissionLevels}
                onSelect={startSession}
                onRedetect={redetect}
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

      {/* It shows at once when it opens, so that it shows when the delay has passed. */}
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={12}
        alignOffset={0}
        className="w-auto max-w-80 data-open:animate-none"
        data-testid="project-card"
      >
        <ProjectCard project={project} />
      </HoverCardContent>
    </HoverCard>
  )
}
