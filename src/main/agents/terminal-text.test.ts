import { afterEach, describe, expect, it } from 'vitest'
import { TerminalText, terminalText } from './terminal-text'

let terminal: TerminalText | null = null

afterEach(() => {
  terminal?.dispose()
  terminal = null
})

describe('TerminalText', () => {
  it('drops colors and other control sequences', async () => {
    expect(
      await terminalText('\u001b[32madded\u001b[0m 2 packages\n\u001b]0;title\u0007done\n'),
    ).toBe('added 2 packages\ndone')
  })

  it('keeps only the last frame of what a command redraws with carriage returns', async () => {
    expect(await terminalText('Upgrading ⠋\rUpgrading ⠙\rUpgrading ⠹\n')).toBe('Upgrading ⠹')
    // A shorter frame leaves what the line had after it, unless the line is erased.
    expect(await terminalText('long line\rshort\n')).toBe('shortline')
    expect(await terminalText('long line\r\u001b[Kshort\n')).toBe('short')
    expect(await terminalText('long line\r\u001b[2Kshort')).toBe('short')
  })

  it('starts a new line at each \\n, and joins the lines it wraps', async () => {
    const long = 'x'.repeat(400)
    expect(await terminalText(`one\ntwo\n${long}\nthree\n\n\n`)).toBe(`one\ntwo\n${long}\nthree`)
  })

  it('tells the last line with text while text arrives', async () => {
    terminal = new TerminalText()
    expect(terminal.lastLine()).toBe('')
    await terminal.write('first\n')
    expect(terminal.lastLine()).toBe('first')
    void terminal.write('second ⠋')
    void terminal.write('\rsecond ⠙')
    await terminal.settled()
    expect(terminal.lastLine()).toBe('second ⠙')
    expect(terminal.lines()).toEqual(['first', 'second ⠙'])
  })
})
