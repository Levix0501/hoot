import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

/**
 * How Markdown shows wherever Hoot shows it, in an issue's description and
 * in the summaries of its steps: as prose, in the interface's colors.
 */
export const MARKDOWN_PROSE = cn(
  'prose prose-sm max-w-none break-words prose-neutral outline-none dark:prose-invert',
  // Code in the interface's colors, inline code without backticks around it.
  'prose-pre:bg-muted prose-pre:text-foreground prose-code:font-normal',
  'prose-code:before:content-none prose-code:after:content-none',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5',
  // Lists as tight as Linear's, though each item is a paragraph.
  'prose-li:my-0.5 [&_li>p]:my-0',
)

/**
 * Opens the link a click is on, if any: an http or https one in the default
 * browser, any other nowhere. The window itself never follows a link.
 */
export function openLink(event: MouseEvent): boolean {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (link === null) return false
  event.preventDefault()
  const target = browserLink(link.getAttribute('href') ?? '')
  if (target !== null) api.openExternalLink(target)
  return true
}
