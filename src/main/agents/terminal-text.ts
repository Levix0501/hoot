import { Terminal } from '@xterm/headless'

/** Wide enough for most lines; longer ones wrap, and are joined again when read. */
const COLUMNS = 160
const ROWS = 40
/** The most lines kept: the first ones go when a command writes more. */
const SCROLLBACK = 5_000

/**
 * What a command writes, as a terminal shows it: without colors and other
 * control sequences, and without what the command wrote over on a line, such
 * as the earlier frames of a spinner it redraws with carriage returns. Each
 * `\n` starts a new line, as a terminal does when it gets the output of a
 * pipe.
 */
export class TerminalText {
  private readonly terminal = new Terminal({
    cols: COLUMNS,
    rows: ROWS,
    scrollback: SCROLLBACK,
    convertEol: true,
    allowProposedApi: true,
  })
  private written: Promise<void> = Promise.resolve()

  /** Writes text; settles once the terminal has taken it in, and everything written before it. */
  write(text: string): Promise<void> {
    this.written = new Promise((resolve) => this.terminal.write(text, resolve))
    return this.written
  }

  /** Settles once everything written so far has been taken in. */
  settled(): Promise<void> {
    return this.written
  }

  /**
   * The lines the terminal shows, with those it wrapped joined again, without
   * the spaces at their ends, and without the empty lines after the last
   * one with text.
   */
  lines(): string[] {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) {
        lines[lines.length - 1] = `${lines.at(-1)}${text}`
      } else {
        lines.push(text)
      }
    }
    const trimmed = lines.map((line) => line.trimEnd())
    while (trimmed.length > 0 && trimmed.at(-1) === '') trimmed.pop()
    return trimmed
  }

  /** The last line with text, or an empty string before there is one. */
  lastLine(): string {
    return this.lines().at(-1) ?? ''
  }

  dispose(): void {
    this.terminal.dispose()
  }
}

/** Text as a terminal shows it once it has taken it all in. */
export async function terminalText(text: string): Promise<string> {
  const terminal = new TerminalText()
  try {
    await terminal.write(text)
    return terminal.lines().join('\n')
  } finally {
    terminal.dispose()
  }
}
