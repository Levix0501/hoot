import { describe, expect, it } from 'vitest'
import { browserLink } from './links'

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
