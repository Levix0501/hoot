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
 * Where an Issues page is, as Linear's breadcrumb says it: Issues, and on an
 * issue's page the issue, where Issues shows the issue list.
 */
export function IssuesBreadcrumb({ issue }: { issue?: Issue }) {
  const showIssueList = useAppStore((state) => state.showIssueList)
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap text-foreground">
        <BreadcrumbItem className="shrink-0">
          {issue ? (
            <BreadcrumbLink
              render={<button type="button" />}
              className="[app-region:no-drag]"
              onClick={() => showIssueList()}
              data-testid="issues-breadcrumb-list"
            >
              Issues
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="font-medium" data-testid="issues-title">
              Issues
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {issue && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage
                className="truncate [app-region:no-drag]"
                title={issue.title}
                data-user-text=""
                data-testid="issues-breadcrumb-issue"
              >
                <span className="text-muted-foreground">{issueIdentifier(issue.id)}</span>{' '}
                {issue.title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
