/**
 * The address a link opens in the default browser: an absolute http or https
 * URL. `null` for any other link, such as a relative or `mailto:` one, which
 * opens nothing.
 */
export function browserLink(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}
