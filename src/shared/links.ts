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

/** Hoot's repository on GitHub. */
export const HOOT_REPOSITORY_URL = 'https://github.com/Levix0501/hoot'

/** Where a bug in Hoot, or an idea for it, is reported. */
export const HOOT_NEW_ISSUE_URL = `${HOOT_REPOSITORY_URL}/issues/new`

/** The page of Hoot's release of a version, which tells what it changed. */
export function releaseNotesUrl(version: string): string {
  return `${HOOT_REPOSITORY_URL}/releases/tag/v${encodeURIComponent(version)}`
}
