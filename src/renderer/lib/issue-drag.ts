import { create } from 'zustand'
import { issueIdentifier, issuePasteParts, type Issue } from '../../shared/issues'

/** The type of an issue dragged from the Issues window, whose data is its id. */
export const ISSUE_DRAG_TYPE = 'application/x-hoot-issue'

/**
 * The issue being dragged from the Issues window, if any, which what it is
 * dragged over can name: a drag's data can be read only once it is dropped.
 */
export const useIssueDrag = create<{ issueId: number | null }>(() => ({ issueId: null }))

/**
 * Starts dragging an issue: for Hoot as its id, and for other programs as
 * the text it pastes into an agent. It is copied into an agent's input, or
 * moved into another group of the Issues window. Under the pointer it shows
 * as a small card with its identifier and title.
 */
export function startIssueDrag(event: React.DragEvent, issue: Issue): void {
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(ISSUE_DRAG_TYPE, String(issue.id))
  event.dataTransfer.setData('text/plain', issuePasteParts(issue).join(''))
  // Drawn once, as the drag starts, from where it lies out of sight.
  const card = document.createElement('div')
  card.className =
    'fixed -top-96 left-0 max-w-72 truncate rounded-lg border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground'
  card.textContent = `${issueIdentifier(issue.id)}  ${issue.title}`
  document.body.append(card)
  event.dataTransfer.setDragImage(card, 16, 14)
  setTimeout(() => card.remove())
  useIssueDrag.setState({ issueId: issue.id })
}

/** The issue was dropped, or the drag was given up. */
export function endIssueDrag(): void {
  useIssueDrag.setState({ issueId: null })
}
