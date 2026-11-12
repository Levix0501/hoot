import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'

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
