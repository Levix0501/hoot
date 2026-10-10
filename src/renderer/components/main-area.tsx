import { currentSessionId, useAppStore } from '../store/app-store'
import { IssueListPage } from './issues/issue-list-page'
import { IssuePage } from './issues/issue-page'
import { NewIssuePage } from './issues/new-issue-page'
import { NoSession, SessionPane } from './session-area'

/** What the main area shows: the current page, or the empty page without one. */
export function MainArea() {
  const page = useAppStore((state) => state.currentPage)
  const session = useAppStore((state) => {
    const id = currentSessionId(state)
    return state.sessions.find((candidate) => candidate.id === id)
  })
  switch (page?.kind) {
    case 'session':
      return session ? <SessionPane session={session} /> : <NoSession />
    case 'issue-list':
      return <IssueListPage key={`list-${page.projectId}`} projectId={page.projectId} />
    case 'new-issue':
      return <NewIssuePage key={`new-${page.projectId}`} projectId={page.projectId} />
    case 'issue':
      return <IssuePage key={`issue-${page.issueId}`} issueId={page.issueId} />
    case undefined:
      return <NoSession />
  }
}
