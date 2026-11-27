import type { Terminal } from '@xterm/xterm'

/*
 * The Program Status Protocol (OSC 7501), revision 0.4: a program tells the
 * terminal it runs in what it is doing, as Claude Code, Codex, OpenCode and
 * Antigravity CLI do: `ESC ] 7501 ; state=working ESC \`. See
 * https://control-codes.page/proposals/osc-7501/.
 */

/** A state a program reports of one of its records. */
export type ProgramState = 'idle' | 'working' | 'blocked' | 'done' | 'error'

/** What a report says, as Hoot takes it: about which record, and what of it. */
export interface ProgramStatusReport {
  /** The record's id, its segments joined by `/`; `null` for the root record. */
  id: string | null
  /** The record's state, or `clear` for a report that removes it and every record below it. */
  state: ProgramState | 'clear'
}

const REPORTED_STATES = ['idle', 'working', 'blocked', 'done', 'error', 'clear'] as const

/** The most bytes a whole sequence may take, from `ESC ]` to `ESC \`. */
const SEQUENCE_LIMIT = 4096

/** What a sequence takes besides its body: `ESC ] 7501 ;` and `ESC \`. */
const SEQUENCE_FRAME = 9

/** The most bytes a key may take. */
const KEY_LIMIT = 16

/** The most bytes `app` may take. */
const APP_LIMIT = 32

/** The most bytes an id may take. */
const ID_LIMIT = 128

/** The most bytes `title` and `msg` may take, in base64 and decoded. */
const TEXT_LIMITS = {
  title: { encoded: 256, decoded: 192 },
  msg: { encoded: 2732, decoded: 2048 },
} as const

const KEY = /^[a-z]+$/

const VALUE = /^[A-Za-z0-9_.,+/=-]*$/

/** One to eight segments of 1 to 32 letters, digits or `_ . + -`, joined by `/`. */
const ID = /^[A-Za-z0-9_.+-]{1,32}(?:\/[A-Za-z0-9_.+-]{1,32}){0,7}$/

const utf8 = new TextEncoder()

function isReportedState(value: string): value is ProgramStatusReport['state'] {
  return (REPORTED_STATES as readonly string[]).includes(value)
}

/**
 * Whether `title` or `msg` is what a report may carry: base64, padded or
 * not, within its limits, of UTF-8 text without control characters, not
 * even a newline or a tab.
 */
function isText(encoded: string, limits: { encoded: number; decoded: number }): boolean {
  if (encoded.length > limits.encoded) return false
  let decoded: string
  try {
    decoded = atob(encoded)
  } catch {
    return false
  }
  if (decoded.length > limits.decoded) return false
  try {
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return !/\p{Cc}/u.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return false
  }
}

/**
 * The report in the body of an OSC 7501 sequence, what comes after
 * `7501;`: `key=value` pairs, joined by `:`. A pair that is not one is passed
 * over, as is a key Hoot does not know; of a key given twice, the last
 * counts. `null` for a sequence the protocol has a program's terminal
 * ignore: one without a state it knows, with an id that is not one (which,
 * passed over, would make the report one about the root record), over a
 * limit, or with a `title` or `msg` that does not decode to text it may be.
 */
export function parseProgramStatusReport(body: string): ProgramStatusReport | null {
  if (utf8.encode(body).length + SEQUENCE_FRAME > SEQUENCE_LIMIT) return null
  const pairs = new Map<string, string>()
  for (const pair of body.split(':')) {
    const equals = pair.indexOf('=')
    if (equals === -1) continue
    const key = pair.slice(0, equals).trim()
    const value = pair.slice(equals + 1).trim()
    if (!KEY.test(key)) continue
    if (key.length > KEY_LIMIT) return null
    if (key === 'id' || VALUE.test(value)) pairs.set(key, value)
  }
  const state = pairs.get('state')
  if (state === undefined || !isReportedState(state)) return null
  const id = pairs.get('id')
  if (id !== undefined && (id.length > ID_LIMIT || !ID.test(id))) return null
  if ((pairs.get('app')?.length ?? 0) > APP_LIMIT) return null
  for (const key of ['title', 'msg'] as const) {
    const text = pairs.get(key)
    if (text !== undefined && !isText(text, TEXT_LIMITS[key])) return null
  }
  return { id: id ?? null, state }
}

/** The most records a terminal holds. */
const RECORD_LIMIT = 256

/** The key of the root record, which no id can be. */
const ROOT = ''

/**
 * Of records without the root one, the state that shows: work going on
 * first, then how the work ended.
 */
const CHILD_STATES: readonly ProgramState[] = ['working', 'error', 'done', 'idle']

/**
 * What the programs in a terminal report of their status: a record for each
 * id, with the state of the last report about it, until a report clears it
 * or the terminal drops it.
 */
export class ProgramStatusRecords {
  /** In the order they were last reported, the oldest first. */
  private readonly states = new Map<string, ProgramState>()

  /**
   * Takes a report: it replaces its record, which past the limit takes the
   * place of the one reported longest ago, or clears it and the records
   * below it; one that clears the root record clears every record.
   */
  apply(report: ProgramStatusReport): void {
    if (report.state === 'clear') {
      const cleared = report.id
      if (cleared === null) this.states.clear()
      else {
        for (const id of this.states.keys()) {
          if (id === cleared || id.startsWith(`${cleared}/`)) this.states.delete(id)
        }
      }
      return
    }
    const key = report.id ?? ROOT
    if (!this.states.delete(key) && this.states.size >= RECORD_LIMIT) {
      const oldest = this.states.keys().next()
      if (!oldest.done) this.states.delete(oldest.value)
    }
    this.states.set(key, report.state)
  }

  /**
   * Drops what a program that ended was doing, waiting for or idle at, as
   * when its shell shows the prompt again; what it finished or failed at
   * stays.
   */
  dropUnfinished(): void {
    for (const [id, state] of this.states) {
      if (state === 'working' || state === 'blocked' || state === 'idle') this.states.delete(id)
    }
  }

  /** Drops every record, as a full reset of the terminal does. */
  clear(): void {
    this.states.clear()
  }

  /**
   * The one state a session's light shows of the records: blocked while any
   * record is, such as a subagent's; otherwise the root record's, which says
   * what the program as a whole does, whatever the records below it say, such
   * as those of commands Claude Code runs in the background, which can go on
   * for as long as it runs. Without a root record, the records below tell:
   * working while one is, otherwise how they ended. `null` without records.
   */
  get status(): ProgramState | null {
    const states = [...this.states.values()]
    if (states.includes('blocked')) return 'blocked'
    const root = this.states.get(ROOT)
    if (root !== undefined) return root
    return CHILD_STATES.find((state) => states.includes(state)) ?? null
  }
}

/**
 * What Hoot answers a program that asks whether the terminal takes its
 * reports: it does, with every state and every kind of revision 0.4.
 */
export const PROGRAM_STATUS_REPLY = '\x1b]7501;?\x1b\\'

/** Follows what the programs in a terminal report of their status; see `watchProgramStatus`. */
export interface ProgramStatusWatch {
  /**
   * Takes in which program has the terminal's foreground now. The first one
   * is the terminal's own, its shell: node-pty names the file it started
   * until the terminal has a foreground process. When the shell has the
   * foreground back, the program that had it has ended, or stopped, and the
   * shell shows its prompt again: what that program was doing, waiting for
   * or idle at is over.
   */
  foregroundChanged(program: string): void
}

/**
 * Follows what the programs in `terminal` report of their status: answers a
 * program asking whether the terminal takes its reports, as the terminal
 * answers its other questions, before the device attributes it asks for
 * next; keeps the records of the reports, which a full reset of the terminal
 * (RIS) removes; and calls `changed` with what the light shows of them
 * whenever that changes.
 */
export function watchProgramStatus(
  terminal: Pick<Terminal, 'input'> & {
    parser: Pick<Terminal['parser'], 'registerOscHandler' | 'registerEscHandler'>
  },
  changed: (status: ProgramState | null) => void,
): ProgramStatusWatch {
  const records = new ProgramStatusRecords()
  let status: ProgramState | null = null
  let shell: string | null = null
  const update = () => {
    const next = records.status
    if (next === status) return
    status = next
    changed(next)
  }
  terminal.parser.registerOscHandler(7501, (body) => {
    if (body.startsWith('?')) {
      terminal.input(PROGRAM_STATUS_REPLY, false)
      return true
    }
    const report = parseProgramStatusReport(body)
    if (report !== null) {
      records.apply(report)
      update()
    }
    return true
  })
  // Left to the terminal's own handler too, which resets everything else.
  terminal.parser.registerEscHandler({ final: 'c' }, () => {
    records.clear()
    update()
    return false
  })
  return {
    foregroundChanged(program) {
      if (shell === null) shell = program
      else if (program === shell) {
        records.dropUnfinished()
        update()
      }
    },
  }
}
