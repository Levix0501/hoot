import { describe, expect, it } from 'vitest'
import { browserLink, HOOT_NEW_ISSUE_URL, HOOT_REPOSITORY_URL, releaseNotesUrl } from './links'

describe('browserLink', () => {
  it('opens http and https addresses', () => {
    expect(browserLink('https://example.com/path')).toBe('https://example.com/path')
    expect(browserLink('http://example.com')).toBe('http://example.com/')
    expect(browserLink('HTTPS://Example.com/a b')).toBe('https://example.com/a%20b')
  })

  it('opens nothing for other links', () => {
    const others = [
      'mailto:someone@example.com',
      'docs/readme.md',
      '/etc/hosts',
      '#heading',
      'file:///etc/hosts',
      'javascript:alert(1)',
      'ftp://example.com',
      '',
    ]
    expect(others.map(browserLink)).toEqual(others.map(() => null))
  })
})

describe("Hoot's links", () => {
  it('are addresses the default browser opens', () => {
    for (const link of [
      HOOT_REPOSITORY_URL,
      HOOT_NEW_ISSUE_URL,
      releaseNotesUrl('0.1.0-alpha.2'),
    ]) {
      expect(browserLink(link)).toBe(link)
    }
  })

  it("point at Hoot's repository, its new issue page, and the release of a version", () => {
    expect(HOOT_REPOSITORY_URL).toBe('https://github.com/Levix0501/hoot')
    expect(HOOT_NEW_ISSUE_URL).toBe('https://github.com/Levix0501/hoot/issues/new')
    expect(releaseNotesUrl('0.1.0-alpha.2')).toBe(
      'https://github.com/Levix0501/hoot/releases/tag/v0.1.0-alpha.2',
    )
  })
})
