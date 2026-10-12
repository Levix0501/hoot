import { CircleCheckIcon, CircleDotIcon, PlusIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isIssueOpen, type Issue } from '../../../shared/issues'
import { useAppStore, type IssueListTab } from '../../store/app-store'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { IssuesTopRow, ProjectName } from './issues-top-row'
import { RelativeTime, useNow } from './relative-time'

const STATES: ReadonlyArray<{ state: IssueListTab; label: string }> = [
  { state: 'open', label: 'Open' },
  { state: 'closed', label: 'Closed' },
]

/** An issue in the list: its title, and when an open one was opened. Click it to show its page. */
function IssueRow({ issue, now }: { issue: Issue; now: number }) {
  const showIssue = useAppStore((state) => state.showIssue)
  const open = isIssueOpen(issue)
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={() => showIssue(issue.id)}
        data-testid="issue-row"
        data-issue-id={issue.id}
        data-state={open ? 'open' : 'closed'}
      >
        {open ? (
          <CircleDotIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
        ) : (
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        )}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium break-words" data-user-text="" data-testid="issue-row-title">
            {issue.title}
          </span>
          {open && (
            <span className="text-xs text-muted-foreground">
              opened{' '}
              <RelativeTime time={issue.createdAt} now={now} data-testid="issue-row-created" />
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * A project's issue list: its open or its closed issues, the newest open or
 * the most recently closed first, as the project's list showed last.
 */
export function IssueListPage({ projectId }: { projectId: number }) {
  const shown = useAppStore((state) => state.issueListStates[projectId] ?? 'open')
  const setIssueListState = useAppStore((state) => state.setIssueListState)
  const showNewIssue = useAppStore((state) => state.showNewIssue)
  const issues = useAppStore(
    useShallow((state) => state.issues.filter((issue) => issue.projectId === projectId)),
  )
  const lists = useMemo(
    () => ({
      open: issues.filter(isIssueOpen).toSorted((a, b) => b.createdAt - a.createdAt || b.id - a.id),
      closed: issues
        .filter((issue) => !isIssueOpen(issue))
        .toSorted((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || b.id - a.id),
    }),
    [issues],
  )
  const now = useNow()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      data-testid="issue-list-page"
      data-project-id={projectId}
    >
      <IssuesTopRow>
        <h1 className="shrink-0 font-medium">Issues</h1>
        <ProjectName projectId={projectId} />
        <div className="min-w-2 flex-1" />
        <Button
          size="sm"
          className="shrink-0 [app-region:no-drag]"
          onClick={() => showNewIssue(projectId)}
          data-testid="new-issue-button"
        >
          <PlusIcon />
          New Issue
        </Button>
      </IssuesTopRow>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="issues-scroll">
        <Tabs
          value={shown}
          onValueChange={(value) => setIssueListState(projectId, value as IssueListTab)}
          className="mx-auto w-full max-w-3xl gap-3 px-6 pt-2 pb-6"
        >
          <TabsList aria-label="Issues to show">
            {STATES.map(({ state, label }) => (
              <TabsTrigger
                key={state}
                value={state}
                className="px-3"
                data-testid={`issues-tab-${state}`}
              >
                {label}
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  data-testid="issues-tab-count"
                >
                  {lists[state].length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {STATES.map(({ state }) => (
            <TabsContent key={state} value={state} data-testid={`issues-${state}`}>
              {lists[state].length === 0 ? (
                <p className="rounded-lg border px-3 py-6 text-center text-muted-foreground">
                  {state === 'open' ? 'No open issues.' : 'No closed issues.'}
                </p>
              ) : (
                <ul className="rounded-lg border">
                  {lists[state].map((issue) => (
                    <IssueRow key={issue.id} issue={issue} now={now} />
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}
