import { CircleDotIcon, FolderPlusIcon, SettingsIcon } from 'lucide-react'
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import { isIssueOpen } from '../../shared/issues'
import { sessionWorktrees, useAppStore } from '../store/app-store'
import { isIssuesPage } from '../store/page-history'
import { worktreeRows } from '../store/worktree-rows'
import { OpenIssueCount } from './open-issue-count'
import { ProjectItem } from './project-item'
import { SessionItem } from './session-item'
import { WorktreeItem } from './worktree-item'
import { Collapsible, CollapsibleContent } from './ui/collapsible'
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
  SidebarMenuSub,
} from './ui/sidebar'

/**
 * The sessions in a project's main worktree, below its row, in the order they
 * were started.
 */
function ProjectSessions({ project }: { project: Project }) {
  const sessions = useAppStore(
    useShallow((state) =>
      state.sessions.filter(
        (session) => session.projectRoot === project.root && session.worktreePath === null,
      ),
    ),
  )
  if (sessions.length === 0) return null
  return (
    <SidebarMenuItem data-testid="session-list" data-project-root={project.root}>
      <SidebarMenuSub className="mr-0 pr-0">
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  )
}

/** The sessions in a worktree, below its row, in the order they were started. */
function WorktreeSessions({ projectRoot, path }: { projectRoot: string; path: string }) {
  const sessions = useAppStore(
    useShallow((state) =>
      state.sessions.filter(
        (session) => session.projectRoot === projectRoot && session.worktreePath === path,
      ),
    ),
  )
  if (sessions.length === 0) return null
  return (
    <SidebarMenuItem data-testid="worktree-session-list" data-worktree-path={path}>
      <SidebarMenuSub className="mr-0 ml-7 pr-0">
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  )
}

/**
 * A project's worktrees, after the sessions of its main worktree, by display
 * name; each with its sessions below it.
 */
function ProjectWorktrees({ project }: { project: Project }) {
  const listed = useAppStore((state) => state.worktrees[project.root])
  const known = useAppStore((state) => state.knownWorktrees)
  const withSessions = useAppStore(
    useShallow((state) => sessionWorktrees(state.sessions, project.root)),
  )
  const rows = useMemo(
    () => worktreeRows(listed, withSessions, known),
    [listed, withSessions, known],
  )
  return rows.map((worktree) => (
    <Fragment key={worktree.path}>
      <WorktreeItem projectRoot={project.root} worktree={worktree} />
      <WorktreeSessions projectRoot={project.root} path={worktree.path} />
    </Fragment>
  ))
}

/**
 * A project in the sidebar: its row, with the rows of its sessions and
 * worktrees below it while it is expanded, or a line saying it has none. They
 * slide open and closed as the sidebar itself slides, or show and hide at once
 * when the system reduces motion.
 */
function ProjectEntry({ project }: { project: Project }) {
  const expanded = useAppStore((state) => !state.collapsedProjects.has(project.id))
  const setProjectExpanded = useAppStore((state) => state.setProjectExpanded)
  // Whether nothing is listed below its row: known once its worktrees have been read.
  const empty = useAppStore(
    (state) =>
      state.worktrees[project.root]?.length === 0 &&
      !state.sessions.some((session) => session.projectRoot === project.root),
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
      {/*
        Cut off only above and below, where the rows slide: at the sides
        they show whole, as the focus rings of a session's row and of its
        close button, which reach past the right side, do.
      */}
      <CollapsibleContent
        render={<ul />}
        className="flex h-(--collapsible-panel-height) min-w-0 flex-col overflow-y-clip transition-[height] duration-200 ease-linear data-ending-style:h-0 data-starting-style:h-0 motion-reduce:duration-0"
        data-testid="project-rows"
      >
        {empty ? (
          <li
            // Lined up with the project's name. It keeps its height while the
            // list is measured closed, before it slides open: shrunk to its
            // text there, the list would slide open short and then jump.
            className="flex h-8 shrink-0 items-center pl-8 text-sm text-muted-foreground"
            data-testid="no-sessions"
          >
            No sessions
          </li>
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
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={selected}
          onClick={() => showIssueList()}
          data-testid="sidebar-issues"
        >
          <CircleDotIcon className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">Issues</span>
          <OpenIssueCount count={openIssues} testId="sidebar-open-issues" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** How far the project list was scrolled when the sidebar last left the window. */
let listScrollTop = 0

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
          <IssuesItem />
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction
            title="Add Project"
            onClick={() => void addProject()}
            data-testid="add-project"
          >
            <FolderPlusIcon />
            <span className="sr-only">Add Project</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            {projects.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="no-projects">
                No projects yet. Add a local Git repository to get started.
              </p>
            ) : (
              <SidebarMenu data-testid="project-list">
                {projects.map((project) => (
                  <ProjectEntry key={project.root} project={project} />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={showSettings} data-testid="sidebar-settings">
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
