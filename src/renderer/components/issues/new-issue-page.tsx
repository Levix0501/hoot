import { useState } from 'react'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  issueTitle,
} from '../../../shared/issues'
import { emptyDraft, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { BackToIssues, IssuesTopRow, ProjectName } from './issues-top-row'

/**
 * A project's new issue page: a title and a Markdown description, kept as
 * they are while other pages are shown, until Create or Cancel.
 */
export function NewIssuePage({ projectId }: { projectId: number }) {
  const draft = useAppStore((state) => state.newIssueDrafts[projectId] ?? emptyDraft)
  const updateNewIssueDraft = useAppStore((state) => state.updateNewIssueDraft)
  const createIssue = useAppStore((state) => state.createIssue)
  const cancelNewIssue = useAppStore((state) => state.cancelNewIssue)
  const [creating, setCreating] = useState(false)
  const canCreate = issueTitle(draft.title) !== '' && !creating

  const create = async () => {
    setCreating(true)
    try {
      await createIssue(projectId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      data-testid="new-issue-page"
      data-project-id={projectId}
    >
      <IssuesTopRow>
        <BackToIssues projectId={projectId} />
        <ProjectName projectId={projectId} />
      </IssuesTopRow>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-2 pb-6">
          <h1 className="text-lg font-semibold">New Issue</h1>
          <div className="grid gap-2">
            <Label htmlFor="new-issue-title">Title</Label>
            <Input
              id="new-issue-title"
              value={draft.title}
              maxLength={ISSUE_TITLE_MAX_LENGTH}
              onChange={(event) =>
                updateNewIssueDraft(projectId, { ...draft, title: event.target.value })
              }
              placeholder="Title"
              spellCheck={false}
              autoFocus
              data-testid="new-issue-title"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-issue-description">Description</Label>
            <Textarea
              id="new-issue-description"
              value={draft.description}
              maxLength={ISSUE_DESCRIPTION_MAX_LENGTH}
              onChange={(event) =>
                updateNewIssueDraft(projectId, { ...draft, description: event.target.value })
              }
              placeholder="Add a description. Markdown is supported."
              className="max-h-[calc(100svh-10rem)] min-h-48"
              spellCheck={false}
              data-testid="new-issue-description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => cancelNewIssue(projectId)}
              data-testid="new-issue-cancel"
            >
              Cancel
            </Button>
            {/* While it cannot create, it is still what the pointer is on, like any other button. */}
            <Button
              className="disabled:pointer-events-auto"
              disabled={!canCreate}
              onClick={() => void create()}
              data-testid="new-issue-create"
            >
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
