import { CircleDotIcon, FolderPlusIcon, PencilSparklesIcon, SettingsIcon } from 'lucide-react'
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import { isIssueOpen } from '../../shared/issues'
import { cn } from '../lib/utils'
import { sessionWorktrees, useAppStore } from '../store/app-store'
import { isIssuesPage } from '../store/page-history'
import { worktreeRows, type WorktreeRow } from '../store/worktree-rows'
import { OpenIssueCount } from './open-issue-count'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { ChatItem } from './chat-item'
import { NewChatItem } from './new-chat-item'
import { contextComponents, ProjectItem } from './project-item'
import { SavedSessionItem } from './saved-session-item'
import { SessionItem } from './session-item'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { UpdateButton } from './update-button'
import { WorktreeItem } from './worktree-item'
import { Collapsible, CollapsibleContent } from './ui/collapsible'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from './ui/context-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar'

/**
 * The rows below a project's or a worktree's row, which slide open and closed
 * as the sidebar itself slides, or show and hide at once when the system
 * reduces motion. Like Issues and New chat, they are 1px apart, and 1px below
 * that row. What reaches more than 2px past them is cut off, so that the
 * focus ring of a row, 2px wide, shows whole, also at their top and bottom.
 * (Chromium keeps such a margin only when the sides are cut off too.)
 */
const SLIDING_ROWS =
  'flex h-(--collapsible-panel-height) min-w-0 flex-col gap-px overflow-clip transition-[height] duration-200 ease-linear [overflow-clip-margin:2px] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:duration-0 [&>:first-child]:mt-px'

/**
 * A group's action, which shows only while the pointer is on the group's title
 * row, or the action has the keyboard focus. The row marks itself `peer/title`.
 */
const GROUP_ACTION_ON_HOVER =
  'opacity-0 peer-hover/title:opacity-100 hover:opacity-100 focus-visible:opacity-100'

/**
 * The line saying a project or a worktree has no sessions, in the place of
 * their rows, as small as a session's name. It keeps its height while the
 * list is measured closed, before it slides open: shrunk to its text there,
 * the list would slide open short and then jump.
 */
function NoSessions({ className, testId }: { className: string; testId: string }) {
  return (
    <li
      className={cn('flex h-7.5 shrink-0 items-center text-xs text-muted-foreground', className)}
      data-testid={testId}
    >
      No sessions
    </li>
  )
}

/**
 * The sessions in a project's main worktree, below its row, in the order they
 * were started, whatever the order of their tabs.
 */
function ProjectSessions({ project }: { project: Project }) {
  const sessions = useAppStore(
    useShallow((state) =>
      state.sessions.filter(
        (session) => session.projectRoot === project.root && session.worktreePath === null,
      ),
    ),
  )
  return sessions
    .toSorted((a, b) => a.createdAt - b.createdAt)
    .map((session) => <SessionItem key={session.id} session={session} />)
}

/**
 * A worktree's sessions, below its row, in the order they were made or split
 * off: its saved sessions, and the sessions started in it that Hoot does not
 * keep, such as those of an issue; or a line saying it has none.
 */
function WorktreeSessions({ projectRoot, path }: { projectRoot: string; path: string }) {
  const sessions = useAppStore(
    useShallow((state) =>
      state.sessions.filter(
        (session) => session.projectRoot === projectRoot && session.worktreePath === path,
      ),
    ),
  )
  const savedSessions = useAppStore(
    useShallow((state) =>
      state.savedSessions.filter(
        (saved) => saved.projectRoot === projectRoot && saved.worktreePath === path,
      ),
    ),
  )
  const rows = [
    ...savedSessions.map((saved) => ({
      at: saved.createdAt,
      key: `saved-${saved.id}`,
      row: <SavedSessionItem saved={saved} />,
    })),
    ...sessions
      .filter((session) => session.savedSessionId === null)
      .map((session) => ({
        at: session.createdAt,
        key: session.id,
        row: <SessionItem session={session} />,
      })),
  ].toSorted((a, b) => a.at - b.at)
  if (rows.length === 0) {
    // Where its sessions' icons would be.
    return <NoSessions className="pl-8" testId="no-worktree-sessions" />
  }
  return rows.map((entry) => <Fragment key={entry.key}>{entry.row}</Fragment>)
}

/**
 * A worktree in the sidebar: its row, with the rows of its sessions below it
 * while it is expanded, or a line saying it has none.
 */
function WorktreeEntry({ project, worktree }: { project: Project; worktree: WorktreeRow }) {
  const expanded = useAppStore((state) => !state.collapsedWorktrees.has(worktree.path))
  const setWorktreeExpanded = useAppStore((state) => state.setWorktreeExpanded)
  return (
    <Collapsible
      render={<li />}
      open={expanded}
      onOpenChange={(open) => setWorktreeExpanded(project.root, worktree.path, open)}
      data-testid="worktree"
      data-worktree-path={worktree.path}
    >
      <WorktreeItem projectRoot={project.root} worktree={worktree} expanded={expanded} />
      <CollapsibleContent render={<ul />} className={SLIDING_ROWS} data-testid="worktree-rows">
        <WorktreeSessions projectRoot={project.root} path={worktree.path} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * A project's worktrees, after the sessions of its main worktree, newest
 * first by when they were made; each with its sessions below it.
 */
function ProjectWorktrees({ project }: { project: Project }) {
  const listed = useAppStore((state) => state.worktrees[project.root])
  const known = useAppStore((state) => state.knownWorktrees)
  const withSessions = useAppStore(
    useShallow((state) => sessionWorktrees(state.sessions, project.root, state.savedSessions)),
  )
  const rows = useMemo(
    () => worktreeRows(listed, withSessions, known),
    [listed, withSessions, known],
  )
  return rows.map((worktree) => (
    <WorktreeEntry key={worktree.path} project={project} worktree={worktree} />
  ))
}

/**
 * A project in the sidebar: its row, with the rows of its sessions and
 * worktrees below it while it is expanded, or a line saying it has none.
 */
function ProjectEntry({ project }: { project: Project }) {
  const expanded = useAppStore((state) => !state.collapsedProjects.has(project.id))
  const setProjectExpanded = useAppStore((state) => state.setProjectExpanded)
  // Whether nothing is listed below its row: known once its worktrees have been read.
  const empty = useAppStore(
    (state) =>
      state.worktrees[project.root]?.length === 0 &&
      !state.sessions.some((session) => session.projectRoot === project.root) &&
      !state.savedSessions.some((saved) => saved.projectRoot === project.root),
  )
  return (
    <Collapsible
      render={<li />}
      open={expanded}
      onOpenChange={(open) => setProjectExpanded(project.id, open)}
      data-testid="project"
      data-project-root={project.root}
    >
      <ProjectItem project={project} expanded={expanded} />
      <CollapsibleContent render={<ul />} className={SLIDING_ROWS} data-testid="project-rows">
        {empty ? (
          // Where its worktrees' icons would be.
          <NoSessions className="pl-5" testId="no-sessions" />
        ) : (
          <>
            <ProjectSessions project={project} />
            <ProjectWorktrees project={project} />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The sidebar's Issues row, above the projects: it shows the issue list, with
 * what is checked in its Project filter as it is, and how many of the issues
 * the window shows are open. It is selected while an Issues page is shown.
 */
function IssuesItem() {
  const showIssueList = useAppStore((state) => state.showIssueList)
  const openIssues = useAppStore((state) => state.issues.filter(isIssueOpen).length)
  const selected = useAppStore((state) => isIssuesPage(state.currentPage))
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selected}
        onClick={() => showIssueList()}
        data-testid="sidebar-issues"
      >
        <CircleDotIcon />
        <span className="min-w-0 flex-1 truncate">Issues</span>
        <OpenIssueCount count={openIssues} testId="sidebar-open-issues" />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** How far the project list was scrolled when the sidebar last left the window. */
let listScrollTop = 0

/**
 * The sidebar's Chats group, below the projects: its title, which starts a
 * chat with the agent chosen from its right-click menu, and whose button does
 * so with the default agent; then each chat, newest first.
 */
function ChatsGroup() {
  const chats = useAppStore((state) => state.chats)
  const newChat = useAppStore((state) => state.newChat)
  return (
    <SidebarGroup>
      <ContextMenu>
        <ContextMenuTrigger
          render={<SidebarGroupLabel className="peer/title" />}
          data-testid="chats-label"
        >
          Chats
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto min-w-48">
          <ChatAgentMenuEntries
            components={contextComponents}
            onSelect={(toolId) => void newChat(toolId)}
            testId="chats-agent"
          />
        </ContextMenuContent>
      </ContextMenu>
      <SidebarGroupAction
        className={GROUP_ACTION_ON_HOVER}
        aria-label="New chat"
        onClick={() => void newChat()}
        data-testid="new-chat-group-action"
      >
        <PencilSparklesIcon />
      </SidebarGroupAction>
      <SidebarGroupContent>
        {chats.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="no-chats">
            No chats
          </p>
        ) : (
          <SidebarMenu className="gap-px" data-testid="chat-list">
            {chats.map((chat) => (
              <ChatItem key={chat.id} chat={chat} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function ProjectSidebar() {
  const projects = useAppStore((state) => state.projects)
  const addProject = useAppStore((state) => state.addProject)
  const showSettings = useAppStore((state) => state.showSettings)

  // The sidebar leaves the window while the settings take its place; its
  // list comes back scrolled as it was, before the window paints it.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = listScrollTop
    // Read before React takes the list out of the window.
    return () => {
      listScrollTop = list.scrollTop
    }
  }, [])

  return (
    // Slides out of the window when collapsed, and back in when expanded.
    <Sidebar aria-label="Projects">
      {/*
        The sidebar's part of the window's top row, which drags the window.
        The traffic lights and the navigation sit on it. It reaches over the
        sidebar's right border, so that the line drags the window too.
      */}
      <SidebarHeader className="-mr-px h-11 shrink-0 [app-region:drag]" />
      <SidebarContent ref={listRef}>
        <SidebarGroup className="pb-0">
          <SidebarMenu className="gap-px">
            <IssuesItem />
            <NewChatItem />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="peer/title">Projects</SidebarGroupLabel>
          <SidebarGroupAction
            className={GROUP_ACTION_ON_HOVER}
            onClick={() => void addProject()}
            data-testid="add-project"
          >
            <FolderPlusIcon />
            <span className="sr-only">Add Project</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            {projects.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="no-projects">
                No projects
              </p>
            ) : (
              <SidebarMenu className="gap-px" data-testid="project-list">
                {projects.map((project) => (
                  <ProjectEntry key={project.root} project={project} />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        <ChatsGroup />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {/*
            While a newer version of Hoot is out, its button stands at the
            right of Settings, as far from the row's right end as from its
            top and bottom.
          */}
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton onClick={() => showSettings()} data-testid="sidebar-settings">
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
            <UpdateButton className="mr-1.5" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizeHandle />
    </Sidebar>
  )
}
