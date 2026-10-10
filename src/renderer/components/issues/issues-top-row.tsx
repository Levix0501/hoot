import { ArrowLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { useTopRowInset } from '../window-navigation'

/**
 * An Issues page's title row: the main area's part of the window's top row.
 * Its blank parts drag the window; its buttons and the project's name do
 * not. While the sidebar slides, its left padding changes in step, keeping
 * its content clear of the navigation.
 */
export function IssuesTopRow({ children }: { children: ReactNode }) {
  const inset = useTopRowInset()
  return (
    <header
      className="flex h-11 shrink-0 items-center gap-1.5 px-4 text-sm transition-[padding] duration-200 ease-linear [app-region:drag]"
      style={{ paddingLeft: inset }}
      data-testid="issues-top-row"
    >
      {children}
    </header>
  )
}

/** The name of the project whose Issues page is shown; its path shows on hover. */
export function ProjectName({ projectId }: { projectId: number }) {
  const project = useAppStore((state) => state.projects.find(({ id }) => id === projectId))
  return (
    <>
      <span className="shrink-0 text-muted-foreground" aria-hidden>
        ·
      </span>
      <span
        className="min-w-0 truncate font-medium [app-region:no-drag]"
        title={project?.root}
        data-path=""
        data-testid="issues-project-name"
      >
        {project?.name}
      </span>
    </>
  )
}

/** "← Issues": shows the project's issue list. */
export function BackToIssues({ projectId }: { projectId: number }) {
  const showIssueList = useAppStore((state) => state.showIssueList)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 shrink-0 pr-1.5 [app-region:no-drag]"
      onClick={() => showIssueList(projectId)}
      data-testid="back-to-issues"
    >
      <ArrowLeftIcon />
      Issues
    </Button>
  )
}
