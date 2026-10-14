import { describe, expect, it } from 'vitest'
import { releaseNotes } from './release-notes'

const CHANGELOG = `# hoot

## 0.1.0-alpha.1

### Patch Changes

- abc1234: Fix the second thing.

## 0.1.0-alpha.0

### Minor Changes

- def5678: Add the first thing.
  It takes two lines.
`

describe('releaseNotes', () => {
  it("takes the version's section of the changelog, without its heading or the other versions", () => {
    const notes = releaseNotes(CHANGELOG, '0.1.0-alpha.0')
    expect(
      notes.startsWith(
        '### Minor Changes\n\n- def5678: Add the first thing.\n  It takes two lines.\n\n',
      ),
    ).toBe(true)
    expect(notes).not.toContain('0.1.0-alpha.1')
    expect(notes).not.toContain('Fix the second thing')

    const latest = releaseNotes(CHANGELOG, '0.1.0-alpha.1')
    expect(latest.startsWith('### Patch Changes\n\n- abc1234: Fix the second thing.\n\n')).toBe(
      true,
    )
    expect(latest).not.toContain('Add the first thing')
  })

  it('ends with how to install Hoot on a Mac and on Windows', () => {
    const notes = releaseNotes(CHANGELOG, '0.1.0-alpha.0')
    const installing = notes.slice(notes.indexOf('## Installing'))
    expect(installing).toContain('`arm64` for Apple Silicon or `x64` for Intel')
    expect(installing).toContain('Hoot for Windows is a preview')
    expect(installing).toContain('adding projects works, with Git on `PATH`')
    expect(installing).toContain('starting sessions does not yet')
    expect(installing).toContain('SmartScreen may say "Windows protected your PC"')
    expect(installing).toContain('**More info**, then **Run anyway**')
    expect(installing).toContain('Smart App Control')
  })

  it('fails for a version the changelog does not have', () => {
    expect(() => releaseNotes(CHANGELOG, '0.2.0')).toThrow('CHANGELOG.md has no section for 0.2.0.')
  })
})
