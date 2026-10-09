import { FolderPlusIcon, RefreshCwIcon } from 'lucide-react'
import { Fragment } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../../shared/ipc'
import { useAppStore } from '../store/app-store'
import { ProjectItem } from './project-item'
import { SessionItem } from './session-item'
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

/** The sessions of a project, below its row, in the order they were started. */
function ProjectSessions({ project }: { project: Project }) {
  const sessions = useAppStore(
    useShallow((state) => state.sessions.filter((session) => session.projectRoot === project.root)),
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
        The traffic lights and the navigation sit on it.
      */}
      <SidebarHeader className="h-11 shrink-0 [app-region:drag]" />
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
