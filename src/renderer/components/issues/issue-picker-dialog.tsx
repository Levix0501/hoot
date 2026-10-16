import { CornerLeftUpIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { issueIdentifier, type Issue } from '../../../shared/issues'
import { ancestorsOf, descendantsOf, parentOf } from '../../../shared/sub-issues'
import { focusAfterOverlay, useAppStore, type IssuePicker } from '../../store/app-store'
import { Button } from '../ui/button'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '../ui/combobox'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Kbd } from '../ui/kbd'
import { StatusIcon } from './issue-icons'

/** Whether an issue is found by what is typed in the search field: by its identifier or its title. */
function matches(issue: Issue, query: string): boolean {
  const typed = query.trim().toLowerCase()
  return (
    issueIdentifier(issue.id).toLowerCase().includes(typed) ||
    issue.title.toLowerCase().includes(typed)
  )
}

/**
 * What the picker lists: the issues Hoot shows, newest first, without the
 * issue itself and, picking its parent, without the issues below it, or,
 * picking its sub-issues, without those above it.
 */
function useCandidates(picker: IssuePicker): Issue[] {
  const issues = useAppStore((state) => state.issues)
  const links = useAppStore((state) => state.subIssues.links)
  return useMemo(() => {
    const left =
      picker.kind === 'parent'
        ? descendantsOf(links, picker.issueId)
        : ancestorsOf(links, picker.issueId)
    return issues
      .filter((issue) => issue.id !== picker.issueId && !left.has(issue.id))
      .toSorted((a, b) => b.id - a.id)
  }, [issues, links, picker])
}

/**
 * An issue in the picker's list: its status, its identifier and its title,
 * and at its end, when given, the identifier of its parent.
 */
function Candidate({ issue, parent }: { issue: Issue; parent: string | null }) {
  return (
    <ComboboxItem
      value={issue}
      className="gap-2.5 py-1.5"
      data-testid="issue-picker-item"
      data-issue-id={issue.id}
    >
      <StatusIcon status={issue.status} />
      <span className="w-16 shrink-0 text-muted-foreground tabular-nums">
        {issueIdentifier(issue.id)}
      </span>
      <span className="min-w-0 flex-1 truncate" data-user-text="">
        {issue.title}
      </span>
      {parent !== null && (
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          title={`Sub-issue of ${parent}`}
          data-testid="issue-picker-item-parent"
        >
          <CornerLeftUpIcon className="size-3" />
          {parent}
        </span>
      )}
    </ComboboxItem>
  )
}

/** Sub-issue of…: picks the issue's parent, which it becomes a sub-issue of at once. */
function ParentPicker({ picker, issue }: { picker: IssuePicker; issue: Issue }) {
  const candidates = useCandidates(picker)
  const parentId = useAppStore((state) => parentOf(state.subIssues.links, issue.id))
  const setIssueParents = useAppStore((state) => state.setIssueParents)
  const closeIssuePicker = useAppStore((state) => state.closeIssuePicker)
  const current = candidates.find((candidate) => candidate.id === parentId) ?? null
  const pick = async (parent: Issue) => {
    if (parent.id === parentId) {
      closeIssuePicker()
      return
    }
    const changed = await setIssueParents(
      [{ issueId: issue.id, parentId: parent.id }],
      'Could not set the parent issue.',
    )
    if (changed) closeIssuePicker()
  }
  return (
    <Combobox
      inline
      open
      items={candidates}
      value={current}
      onValueChange={(picked: Issue | null) => {
        if (picked !== null) void pick(picked)
      }}
      filter={matches}
      itemToStringLabel={(candidate: Issue) => candidate.title}
      autoHighlight
    >
      <PickerTitle>Make {issueIdentifier(issue.id)} a sub-issue of…</PickerTitle>
      <PickerList />
    </Combobox>
  )
}

/**
 * Parent of…: picks issues, which become the issue's sub-issues together once
 * confirmed. An issue with a parent says which.
 */
function SubIssuesPicker({ picker, issue }: { picker: IssuePicker; issue: Issue }) {
  const candidates = useCandidates(picker)
  const links = useAppStore((state) => state.subIssues.links)
  const shown = useAppStore((state) => state.issues)
  const setIssueParents = useAppStore((state) => state.setIssueParents)
  const closeIssuePicker = useAppStore((state) => state.closeIssuePicker)
  const [checked, setChecked] = useState<Issue[]>([])
  const [busy, setBusy] = useState(false)
  /** The identifier of an issue's parent, if it has one Hoot shows. */
  const parentLabel = (candidate: Issue) => {
    const parentId = parentOf(links, candidate.id)
    return parentId !== null && shown.some((entry) => entry.id === parentId)
      ? issueIdentifier(parentId)
      : null
  }
  const confirm = async () => {
    if (checked.length === 0 || busy) return
    setBusy(true)
    try {
      const changed = await setIssueParents(
        checked.map((subIssue) => ({ issueId: subIssue.id, parentId: issue.id })),
        checked.length === 1 ? 'Could not add the sub-issue.' : 'Could not add the sub-issues.',
      )
      if (changed) closeIssuePicker()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="grid"
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          void confirm()
        }
      }}
    >
      <Combobox
        inline
        open
        multiple
        items={candidates}
        value={checked}
        onValueChange={(next: Issue[]) => setChecked(next)}
        onInputValueChange={(_value, details) => {
          // Checking an issue keeps what is typed, for checking another found by it.
          if (details.isItemPress) details.cancel()
        }}
        filter={matches}
        itemToStringLabel={(candidate: Issue) => candidate.title}
        autoHighlight
      >
        <PickerTitle>Make {issueIdentifier(issue.id)} the parent of…</PickerTitle>
        <PickerList parentLabel={parentLabel} />
      </Combobox>
      <div className="flex items-center justify-end gap-3 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground" data-testid="issue-picker-checked">
          {checked.length === 0 ? 'Check the issues to add' : `${checked.length} checked`}
        </span>
        <Button
          size="sm"
          disabled={checked.length === 0 || busy}
          onClick={() => void confirm()}
          data-testid="issue-picker-confirm"
        >
          {checked.length === 1 ? 'Add sub-issue' : 'Add sub-issues'}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">⌘ Enter</Kbd>
        </Button>
      </div>
    </div>
  )
}

function PickerTitle({ children }: { children: ReactNode }) {
  return (
    <DialogTitle
      className="px-4 pt-3 pb-2 text-sm font-normal text-muted-foreground"
      data-testid="issue-picker-title"
    >
      {children}
    </DialogTitle>
  )
}

/**
 * The search field over the issues found, each with the identifier of its
 * parent when `parentLabel` gives one.
 */
function PickerList({ parentLabel }: { parentLabel?(issue: Issue): string | null }) {
  return (
    <>
      <ComboboxInput
        showTrigger={false}
        placeholder="Search by identifier or title…"
        aria-label="Search issues"
        className="mx-3 mb-1"
        data-testid="issue-picker-search"
      />
      <ComboboxEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
        No issues found.
      </ComboboxEmpty>
      <ComboboxList className="max-h-[min(24rem,50vh)] px-2 pb-2" data-testid="issue-picker-list">
        {(issue: Issue) => (
          <Candidate key={issue.id} issue={issue} parent={parentLabel?.(issue) ?? null} />
        )}
      </ComboboxList>
    </>
  )
}

/**
 * The picker of Sub-issue of… and Parent of…, as Linear's: a search field
 * over the issues Hoot shows, found by identifier or title. Sub-issue of…
 * makes the issue a sub-issue of the one picked; Parent of… makes the issues
 * checked its sub-issues. Each lists only the issues that can be picked
 * without putting an issue below itself.
 */
export function IssuePickerDialog() {
  const picker = useAppStore((state) => state.issuePicker)
  const issue = useAppStore((state) =>
    state.issues.find((candidate) => candidate.id === state.issuePicker?.issueId),
  )
  const closeIssuePicker = useAppStore((state) => state.closeIssuePicker)
  const open = picker !== null && issue !== undefined
  // Kept while the dialog fades out after it closes.
  const [shown, setShown] = useState<{ picker: IssuePicker; issue: Issue } | null>(null)
  if (open && (shown?.picker !== picker || shown.issue !== issue)) setShown({ picker, issue })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeIssuePicker()
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={focusAfterOverlay}
        className="top-[max(3.5rem,12vh)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        data-testid="issue-picker"
        data-kind={shown?.picker.kind}
      >
        {shown &&
          (shown.picker.kind === 'parent' ? (
            <ParentPicker
              key={`${shown.picker.kind}-${shown.picker.issueId}`}
              picker={shown.picker}
              issue={shown.issue}
            />
          ) : (
            <SubIssuesPicker
              key={`${shown.picker.kind}-${shown.picker.issueId}`}
              picker={shown.picker}
              issue={shown.issue}
            />
          ))}
      </DialogContent>
    </Dialog>
  )
}
