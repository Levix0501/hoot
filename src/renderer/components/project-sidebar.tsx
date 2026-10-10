import { FolderPlusIcon, RefreshCwIcon } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import { sessionWorktrees, useAppStore } from '../store/app-store'
import { worktreeRows } from '../store/worktree-rows'
import { ProjectItem } from './project-item'
import { SessionItem } from './session-item'
import { WorktreeItem } from './worktree-item'
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

export function ProjectSidebar() {
  const projects = useAppStore((state) => state.projects)
  const detecting = useAppStore((state) => state.tools.detecting)
  const addProject = useAppStore((state) => state.addProject)
  const redetectTools = useAppStore((state) => state.redetectTools)

  return (
    // Slides out of the window when collapsed, and back in when expanded.
    <Sidebar aria-label="Projects">
      {/*
        The sidebar's part of the window's top row, which drags the window.
        The traffic lights and the navigation sit on it. It reaches over the
        sidebar's right border, so that the line drags the window too.
      */}
      <SidebarHeader className="-mr-px h-11 shrink-0 [app-region:drag]" />
      <SidebarContent>
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
                  <Fragment key={project.root}>
                    <ProjectItem project={project} />
                    <ProjectSessions project={project} />
                    <ProjectWorktrees project={project} />
                  </Fragment>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={detecting}
              onClick={() => void redetectTools()}
              data-testid="sidebar-redetect-tools"
            >
              <RefreshCwIcon className={detecting ? 'animate-spin' : undefined} />
              <span>{detecting ? 'Detecting tools…' : 'Re-detect Tools'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
