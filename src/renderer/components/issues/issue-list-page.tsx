import { SquarePenIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  issueGroups,
  issueIdentifier,
  type IssueStatus,
  type IssueView,
} from '../../../shared/issues'
import { VIEW_OPTIONS } from '../../lib/issue-properties'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty'
import { Kbd } from '../ui/kbd'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { IssueGroup } from './issue-group'
import { IssuesBreadcrumb, IssuesTopRow } from './issues-top-row'
import { PriorityPicker, StatusPicker } from './property-picker'
import { useNow } from './relative-time'
import { useIssueShortcuts } from './use-issue-shortcuts'

const NO_GROUPS: readonly IssueStatus[] = []

const EMPTY_VIEW: Record<IssueView, string> = {
  all: 'No issues yet.',
  active: 'No issues to do or in progress.',
  backlog: 'No issues in the backlog.',
}

/** The row of an issue in a list, by the issue's id. */
function rowOf(list: HTMLElement | null, issueId: number): HTMLElement | null {
  return list?.querySelector(`[data-testid="issue-row"][data-issue-id="${issueId}"]`) ?? null
}

/** The issue of a list's row, by its id. */
function issueIdOf(row: Element): number {
  return Number(row.getAttribute('data-issue-id'))
}

/**
 * A project's issues as Linear lists them: one of its views (all, active or
 * backlog), grouped by status, the closest to done first. J and K (or the
 * arrow keys) move through the issues, Enter shows one, S and P change the
 * status and the priority of the one with the focus or the pointer, and C
 * creates an issue.
 */
export function IssueListPage({ projectId }: { projectId: number }) {
  const project = useAppStore((state) => state.projects.find(({ id }) => id === projectId))
  const view = useAppStore((state) => state.issueViews[projectId] ?? 'all')
  const collapsed = useAppStore((state) => state.collapsedIssueGroups[projectId] ?? NO_GROUPS)
  const issues = useAppStore(
    useShallow((state) => state.issues.filter((issue) => issue.projectId === projectId)),
  )
  const setIssueView = useAppStore((state) => state.setIssueView)
  const openNewIssue = useAppStore((state) => state.openNewIssue)
  const updateIssue = useAppStore((state) => state.updateIssue)
  const requestDeleteIssue = useAppStore((state) => state.requestDeleteIssue)
  const groups = useMemo(() => issueGroups(issues, view), [issues, view])
  const identifierWidth = useMemo(() => {
    const longest = Math.max(0, ...issues.map((issue) => String(issue.number).length))
    const keyLength = project ? issueIdentifier(project.name, 0).length - 1 : 3
    // Capitals are wider than digits, which `ch` measures.
    return Math.ceil((keyLength + 1 + longest) * 1.2)
  }, [issues, project])
  const now = useNow()
  const listRef = useRef<HTMLDivElement>(null)
  const hovered = useRef<number | null>(null)
  /** The picker S or P opened last, kept while it closes so that it can give the focus back. */
  const [picker, setPicker] = useState<{
    kind: 'status' | 'priority'
    issueId: number
    open: boolean
  } | null>(null)
  const pickedIssue = issues.find((issue) => issue.id === picker?.issueId)

  /** The row that keys act on: the one with the focus, or else the one under the pointer. */
  const currentRow = (): HTMLElement | null => {
    const focused = document.activeElement?.closest<HTMLElement>('[data-testid="issue-row"]')
    if (focused && listRef.current?.contains(focused)) return focused
    return hovered.current === null ? null : rowOf(listRef.current, hovered.current)
  }

  const moveFocus = (offset: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-testid="issue-row"]') ?? [],
    )
    if (rows.length === 0) return
    const current = currentRow()
    const index = current === null ? -1 : rows.indexOf(current)
    const next =
      index === -1
        ? rows[offset === 1 ? 0 : rows.length - 1]!
        : rows[Math.min(rows.length - 1, Math.max(0, index + offset))]!
    next.focus()
  }

  useIssueShortcuts('list', (shortcut) => {
    switch (shortcut.kind) {
      case 'new-issue':
        openNewIssue(projectId)
        return true
      case 'move':
        moveFocus(shortcut.offset)
        return true
      case 'status':
      case 'priority': {
        const row = currentRow()
        if (row === null) return false
        setPicker({ kind: shortcut.kind, issueId: issueIdOf(row), open: true })
        return true
      }
      case 'delete': {
        const row = currentRow()
        if (row === null) return false
        requestDeleteIssue(issueIdOf(row))
        return true
      }
      case 'back-to-list':
        return false
    }
  })

  /** The status or priority icon of the row the picker opened for, which it opens next to. */
  const pickerAnchor = () =>
    (picker &&
      rowOf(listRef.current, picker.issueId)?.querySelector(
        picker.kind === 'status' ? '[data-slot="status-icon"]' : '[data-slot="priority-icon"]',
      )) ??
    null
  /** Back to the row the picker opened for, wherever its new status put it. */
  const pickerFinalFocus = () => (picker && rowOf(listRef.current, picker.issueId)) ?? true
  const closePicker = (open: boolean) => {
    if (!open) setPicker((current) => current && { ...current, open: false })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      data-testid="issue-list-page"
      data-project-id={projectId}
    >
      <IssuesTopRow>
        <IssuesBreadcrumb projectId={projectId} />
        <div className="min-w-2 flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 [app-region:no-drag]"
                aria-label="New issue"
                onClick={() => openNewIssue(projectId)}
                data-testid="new-issue-button"
              />
            }
          >
            <SquarePenIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            New issue
            <Kbd>C</Kbd>
          </TooltipContent>
        </Tooltip>
      </IssuesTopRow>
      <Tabs
        value={view}
        onValueChange={(value) => setIssueView(projectId, value as IssueView)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex shrink-0 items-center px-3 pb-2">
          <TabsList aria-label="Issues to show">
            {VIEW_OPTIONS.map((option) => (
              <TabsTrigger
                key={option.value}
                value={option.value}
                className="px-3"
                data-testid={`issues-view-${option.value}`}
              >
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="issues-scroll">
          {VIEW_OPTIONS.map((option) => (
            <TabsContent
              key={option.value}
              value={option.value}
              className="grid gap-1 px-2 pb-6"
              data-testid={`issues-${option.value}`}
            >
              {option.value !== view ? null : groups.length === 0 ? (
                <Empty data-testid="issues-empty">
                  <EmptyHeader>
                    <EmptyTitle>{EMPTY_VIEW[view]}</EmptyTitle>
                    <EmptyDescription>
                      Note what to do or what went wrong, and come back to it later.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openNewIssue(projectId)}
                      data-testid="issues-empty-create"
                    >
                      Create issue
                      <Kbd>C</Kbd>
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                groups.map((group) => (
                  <IssueGroup
                    key={group.status}
                    projectId={projectId}
                    group={group}
                    collapsed={collapsed.includes(group.status)}
                    identifierWidth={identifierWidth}
                    now={now}
                    onHover={(issueId) => {
                      hovered.current = issueId
                    }}
                  />
                ))
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
      {pickedIssue && picker?.kind === 'status' && (
        <StatusPicker
          value={pickedIssue.status}
          onChange={(status) => updateIssue(pickedIssue.id, { status })}
          anchor={pickerAnchor}
          open={picker.open}
          onOpenChange={closePicker}
          finalFocus={pickerFinalFocus}
        />
      )}
      {pickedIssue && picker?.kind === 'priority' && (
        <PriorityPicker
          value={pickedIssue.priority}
          onChange={(priority) => updateIssue(pickedIssue.id, { priority })}
          anchor={pickerAnchor}
          open={picker.open}
          onOpenChange={closePicker}
          finalFocus={pickerFinalFocus}
        />
      )}
    </div>
  )
}
