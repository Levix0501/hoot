import type { ReactNode } from 'react'
import { issueIdentifier, type Issue } from '../../../shared/issues'
import { useAppStore } from '../../store/app-store'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui/breadcrumb'
import { useTopRowInset } from '../window-navigation'

/**
 * An Issues page's title row: the main area's part of the window's top row.
 * Its blank parts drag the window; its buttons and the names with a tooltip
 * do not. While the sidebar slides, its left padding changes in step,
 * keeping its content clear of the navigation. At its right end it leaves
 * room for the window's buttons on Windows.
 */
export function IssuesTopRow({ children }: { children: ReactNode }) {
  const inset = useTopRowInset()
  return (
    <header
      className="flex h-11 shrink-0 items-center gap-2 pr-[calc(--spacing(4)+var(--window-controls-width))] pl-4 text-sm transition-[padding] duration-200 ease-linear [app-region:drag]"
      style={{ paddingLeft: inset }}
      data-testid="issues-top-row"
    >
      {children}
    </header>
  )
}

/**
 * Where an Issues page is, as Linear's breadcrumb says it: the project (its
 * path shows on hover), its issues, and on an issue's page the issue. On an
 * issue's page, Issues shows the project's list.
 */
export function IssuesBreadcrumb({ projectId, issue }: { projectId: number; issue?: Issue }) {
  const project = useAppStore((state) => state.projects.find(({ id }) => id === projectId))
  const showIssueList = useAppStore((state) => state.showIssueList)
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap text-foreground">
        <BreadcrumbItem className="shrink-0">
          <span
            className="font-medium [app-region:no-drag]"
            title={project?.root}
            data-path=""
            data-testid="issues-project-name"
          >
            {project?.name}
          </span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="shrink-0">
          {issue ? (
            <BreadcrumbLink
              render={<button type="button" />}
              className="[app-region:no-drag]"
              onClick={() => showIssueList(projectId)}
              data-testid="issues-breadcrumb-list"
            >
              Issues
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Issues</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {issue && project && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage
                className="truncate [app-region:no-drag]"
                title={issue.title}
                data-user-text=""
                data-testid="issues-breadcrumb-issue"
              >
                <span className="text-muted-foreground">
                  {issueIdentifier(project.name, issue.number)}
                </span>{' '}
                {issue.title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
