import { describe, expect, it } from 'vitest'
import { displayPath } from './paths'

describe('displayPath', () => {
  const home = '/Users/me'

  it('writes the home directory as ~', () => {
    expect(displayPath('/Users/me/Desktop/code/workflow', home)).toBe('~/Desktop/code/workflow')
    expect(displayPath('/Users/me', home)).toBe('~')
  })

  it('writes a path outside the home directory in full', () => {
    expect(displayPath('/Volumes/work/hoot', home)).toBe('/Volumes/work/hoot')
    expect(displayPath('/Users/me-other/hoot', home)).toBe('/Users/me-other/hoot')
    expect(displayPath('/Users', home)).toBe('/Users')
  })
})
