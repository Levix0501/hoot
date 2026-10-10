import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

/**
 * Links open nothing in the window: an http or https one opens in the
 * default browser, any other does nothing at all.
 */
const components: Components = {
  a: ({ node: _node, href, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault()
        const link = href === undefined ? null : browserLink(href)
        if (link !== null) api.openExternalLink(link)
      }}
      onAuxClick={(event) => event.preventDefault()}
    />
  ),
}

const plugins = [remarkGfm]

/**
 * An issue's description, rendered as GitHub Flavored Markdown. HTML in it
 * shows as the text it is, and its task list's boxes show whether each item
 * is done without changing when clicked.
 */
export function IssueDescription({ markdown }: { markdown: string }) {
  if (markdown.trim() === '') {
    return (
      <p className="text-sm text-muted-foreground italic" data-testid="issue-description-empty">
        No description provided.
      </p>
    )
  }
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none break-words prose-neutral dark:prose-invert',
        // Code blocks in the interface's colors, as GitHub shows them.
        'prose-pre:bg-muted prose-pre:text-foreground',
        // Task lists show their boxes where other lists show bullets.
        '[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0',
        '[&_.task-list-item_input]:my-0 [&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:align-middle',
      )}
      data-user-text=""
      data-testid="issue-description"
    >
      <Markdown remarkPlugins={plugins} components={components}>
        {markdown}
      </Markdown>
    </div>
  )
}
