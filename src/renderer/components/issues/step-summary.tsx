import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { descriptionExtensions } from './description-extensions'
import { MARKDOWN_PROSE, openLink } from './markdown'

/**
 * Markdown shown formatted, and read only, by the rules of an issue's
 * description: GitHub Flavored Markdown, whose HTML makes no elements except
 * formatting such as bold and runs nothing, and whose links open in the
 * default browser when they are http or https ones, and nowhere otherwise.
 */
function MarkdownView({ markdown, testId }: { markdown: string; testId: string }) {
  const editor = useEditor(
    {
      extensions: descriptionExtensions(''),
      content: markdown,
      contentType: 'markdown',
      editable: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: MARKDOWN_PROSE, 'data-testid': testId, 'data-user-text': '' },
        handleDOMEvents: {
          // The window itself never follows a link, also with a middle click.
          click: (_view, event) => openLink(event),
          auxclick: (_view, event) => openLink(event),
        },
      },
    },
    [markdown],
  )
  return <EditorContent editor={editor} className="min-w-0" />
}

/**
 * The summary an agent reported with a step's outcome, under the outcome in
 * an issue's activity. A long one shows only as much as fits a set height,
 * with Show more below it, which shows all of it.
 */
export function StepSummary({ markdown, className }: { markdown: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)

  // Measured whenever the summary's size changes, as when its formatting shows.
  useEffect(() => {
    const shown = frame.current
    const full = content.current
    if (expanded || shown === null || full === null) return
    const observer = new ResizeObserver(() =>
      setOverflowing(full.offsetHeight > shown.clientHeight),
    )
    observer.observe(full)
    observer.observe(shown)
    return () => observer.disconnect()
  }, [expanded])

  const cut = overflowing && !expanded
  return (
    <div
      className={cn('rounded-lg border bg-card px-3 py-2 text-card-foreground', className)}
      data-testid="step-summary"
      data-cut={cut || undefined}
    >
      <div ref={frame} className={cn('relative', !expanded && 'max-h-60 overflow-hidden')}>
        <div ref={content}>
          <MarkdownView markdown={markdown} testId="step-summary-text" />
        </div>
        {cut && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card" />
        )}
      </div>
      {cut && (
        <Button
          variant="link"
          size="xs"
          className="mt-1 px-0 text-muted-foreground"
          onClick={() => setExpanded(true)}
          data-testid="step-summary-more"
        >
          Show more
        </Button>
      )}
    </div>
  )
}
