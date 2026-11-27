import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import {
  parseProgramStatusReport,
  PROGRAM_STATUS_REPLY,
  ProgramStatusRecords,
  watchProgramStatus,
  type ProgramState,
} from './program-status'

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

/** Records that took the reports in these bodies, as parsed. */
function recordsOf(...bodies: string[]): ProgramStatusRecords {
  const records = new ProgramStatusRecords()
  for (const body of bodies) {
    const report = parseProgramStatusReport(body)
    if (report !== null) records.apply(report)
  }
  return records
}

/** A report body of `bytes` bytes, padded with a key Hoot does not know. */
const bodyOf = (bytes: number) => `state=idle:pad=${'x'.repeat(bytes - 15)}`

/** Takes in reports of 255 records, none blocked. */
function fill(records: ProgramStatusRecords): void {
  for (let n = 1; n < 256; n++) records.apply({ id: `n${n}`, state: 'done' })
}

/** A terminal, what it answers, and what its light changes to. */
function watched() {
  const terminal = new Terminal({ allowProposedApi: true })
  const answers: string[] = []
  terminal.onData((data) => answers.push(data))
  const changes: Array<ProgramState | null> = []
  const watch = watchProgramStatus(terminal, (status) => changes.push(status))
  const write = (data: string) => new Promise<void>((resolve) => terminal.write(data, resolve))
  return { answers, changes, watch, write }
}

describe('parseProgramStatusReport', () => {
  it('reads the state and the id of a report, past the keys Hoot does not use', () => {
    for (const state of ['idle', 'working', 'blocked', 'done', 'error', 'clear'] as const) {
      expect(parseProgramStatusReport(`state=${state}`)).toEqual({ id: null, state })
    }
    // As Claude Code reports a dialog, and OpenCode the work of one of its sessions.
    const approve = base64('approve Bash: echo probe > probe.txt')
    expect(
      parseProgramStatusReport(`state=blocked:app=claude-code:kind=permission:msg=${approve}`),
    ).toEqual({ id: null, state: 'blocked' })
    expect(
      parseProgramStatusReport(
        `state=working:id=ses_de37e2257ffef3KPU00A6QVL6G:app=opencode:title=${base64('Probe title')}`,
      ),
    ).toEqual({ id: 'ses_de37e2257ffef3KPU00A6QVL6G', state: 'working' })
    expect(parseProgramStatusReport('state=clear:id=build/test')).toEqual({
      id: 'build/test',
      state: 'clear',
    })
  })

  it('removes the spaces around keys and values, and takes the last of a key given twice', () => {
    expect(parseProgramStatusReport(' state = idle : id = a ')).toEqual({ id: 'a', state: 'idle' })
    expect(parseProgramStatusReport('state=working:state=done')).toEqual({
      id: null,
      state: 'done',
    })
  })

  it('passes over a pair that is not one, and a key it does not know', () => {
    expect(
      parseProgramStatusReport('state=done:nothing:=x:Key=x:progress=1 0:later=v2:progress=40'),
    ).toEqual({ id: null, state: 'done' })
    expect(parseProgramStatusReport('state=working:state=wörking')).toEqual({
      id: null,
      state: 'working',
    })
  })

  it('ignores a report without a state it knows', () => {
    for (const body of ['', '?x', 'kind=permission', 'state=paused', 'state=Working', 'state=']) {
      expect(parseProgramStatusReport(body)).toBeNull()
    }
  })

  it('ignores a report with an id that is not one, which would otherwise be about the root record', () => {
    const tooDeep = Array.from({ length: 9 }, () => 'a').join('/')
    for (const id of ['', 'a//b', '/a', 'a/', 'a b', 'a,b', 'a=b', 'ä', 'x'.repeat(33), tooDeep]) {
      expect(parseProgramStatusReport(`state=clear:id=${id}`)).toBeNull()
    }
    const deepest = Array.from({ length: 8 }, () => 'a'.repeat(15)).join('/')
    expect(parseProgramStatusReport(`state=idle:id=${deepest}`)).toEqual({
      id: deepest,
      state: 'idle',
    })
    const tooLong = Array.from({ length: 8 }, () => 'a'.repeat(16)).join('/')
    expect(parseProgramStatusReport(`state=idle:id=${tooLong}`)).toBeNull()
  })

  it('discards a report over a limit', () => {
    // 4096 bytes for the whole sequence, with `ESC ] 7501 ;` and `ESC \`.
    expect(parseProgramStatusReport(bodyOf(4087))).toEqual({ id: null, state: 'idle' })
    expect(parseProgramStatusReport(bodyOf(4088))).toBeNull()
    expect(parseProgramStatusReport(`state=idle:${'k'.repeat(16)}=v`)).not.toBeNull()
    expect(parseProgramStatusReport(`state=idle:${'k'.repeat(17)}=v`)).toBeNull()
    expect(parseProgramStatusReport(`state=idle:app=${'a'.repeat(32)}`)).not.toBeNull()
    expect(parseProgramStatusReport(`state=idle:app=${'a'.repeat(33)}`)).toBeNull()
    expect(parseProgramStatusReport(`state=idle:title=${base64('t'.repeat(192))}`)).not.toBeNull()
    expect(parseProgramStatusReport(`state=idle:title=${base64('t'.repeat(193))}`)).toBeNull()
    expect(parseProgramStatusReport(`state=idle:msg=${base64('m'.repeat(2048))}`)).not.toBeNull()
    expect(parseProgramStatusReport(`state=idle:msg=${base64('m'.repeat(2049))}`)).toBeNull()
  })

  it('discards a report whose title or msg is no base64 of one line of text', () => {
    expect(parseProgramStatusReport(`state=done:msg=${base64('Fixed — 3 files')}`)).not.toBeNull()
    // Padding is up to the program.
    expect(parseProgramStatusReport('state=done:msg=RG9uZQ')).not.toBeNull()
    for (const encoded of ['-_-_', 'a', 'RG9uZQ=', base64('two\nlines'), base64('a\ttab')]) {
      expect(parseProgramStatusReport(`state=done:title=${encoded}`)).toBeNull()
    }
    for (const text of ['\u0007', '\u001b[31m', '\u007f', '\u009b31m']) {
      expect(parseProgramStatusReport(`state=done:msg=${base64(text)}`)).toBeNull()
    }
    const notUtf8 = btoa(String.fromCharCode(0x66, 0xff, 0xfe))
    expect(parseProgramStatusReport(`state=done:msg=${notUtf8}`)).toBeNull()
  })
})

describe('ProgramStatusRecords', () => {
  it("shows the root record's state, which each report about it replaces", () => {
    expect(recordsOf().status).toBeNull()
    expect(recordsOf('state=idle').status).toBe('idle')
    expect(recordsOf('state=idle', 'state=working').status).toBe('working')
    expect(recordsOf('state=working', 'state=done').status).toBe('done')
  })

  it('is blocked while any record is, and otherwise shows the root record over those below it', () => {
    // OpenCode reports the work of its session in a record of its own too.
    expect(recordsOf('state=working', 'state=working:id=ses_1').status).toBe('working')
    expect(recordsOf('state=blocked', 'state=blocked:id=ses_1').status).toBe('blocked')
    expect(recordsOf('state=idle', 'state=blocked:id=agents/a1').status).toBe('blocked')
    // A command Claude Code runs in the background can go on after its turn.
    expect(recordsOf('state=working', 'state=working:id=bash_1', 'state=done').status).toBe('done')
    expect(recordsOf('state=idle', 'state=error:id=bash_1').status).toBe('idle')
  })

  it('without a root record, works while a record below it does, and otherwise shows how they ended', () => {
    expect(recordsOf('state=done:id=a', 'state=working:id=b').status).toBe('working')
    expect(recordsOf('state=done:id=a', 'state=error:id=b').status).toBe('error')
    expect(recordsOf('state=idle:id=a', 'state=done:id=b').status).toBe('done')
    expect(recordsOf('state=idle:id=a').status).toBe('idle')
  })

  it('clears a record with those below it, or, without an id, every record', () => {
    // As OpenCode ends a turn.
    expect(
      recordsOf('state=working', 'state=working:id=ses_1', 'state=clear:id=ses_1', 'state=idle')
        .status,
    ).toBe('idle')
    const records = recordsOf(
      'state=idle',
      'state=blocked:id=build/test',
      'state=blocked:id=build/test/unit',
      'state=blocked:id=buildx',
    )
    records.apply({ id: 'build', state: 'clear' })
    expect(records.status).toBe('blocked')
    records.apply({ id: 'buildx', state: 'clear' })
    expect(records.status).toBe('idle')
    records.apply({ id: null, state: 'clear' })
    expect(records.status).toBeNull()
  })

  it('drops what a program that ended was doing, waiting for or idle at, keeping what it finished or failed at', () => {
    for (const state of ['working', 'blocked', 'idle']) {
      const records = recordsOf(`state=${state}`, `state=${state}:id=a`)
      records.dropUnfinished()
      expect(records.status).toBeNull()
    }
    const records = recordsOf('state=done', 'state=working:id=a', 'state=blocked:id=b')
    records.dropUnfinished()
    expect(records.status).toBe('done')
    const failed = recordsOf('state=working', 'state=error:id=a')
    failed.dropUnfinished()
    expect(failed.status).toBe('error')
  })

  it('holds 256 records: one more takes the place of the one reported longest ago', () => {
    const records = new ProgramStatusRecords()
    records.apply({ id: 'first', state: 'blocked' })
    fill(records)
    expect(records.status).toBe('blocked')
    records.apply({ id: 'one-more', state: 'done' })
    expect(records.status).toBe('done')
    // Reported again, it is the latest.
    const again = new ProgramStatusRecords()
    again.apply({ id: 'first', state: 'blocked' })
    fill(again)
    again.apply({ id: 'first', state: 'blocked' })
    again.apply({ id: 'one-more', state: 'done' })
    expect(again.status).toBe('blocked')
  })
})

describe('watchProgramStatus', () => {
  it('answers a program asking whether it takes reports, before the device attributes asked next', async () => {
    const { answers, write } = watched()
    // As Claude Code, OpenCode and Antigravity CLI ask.
    await write('\x1b]7501;?\x1b\\\x1b[c')
    expect(answers).toHaveLength(2)
    expect(answers[0]).toBe(PROGRAM_STATUS_REPLY)
    expect(answers[1]?.startsWith('\x1b[?')).toBe(true)
    await write('\x1b]7501;?\x07')
    expect(answers[2]).toBe(PROGRAM_STATUS_REPLY)
  })

  it('follows the reports, and tells only of what changes the light', async () => {
    const { answers, changes, write } = watched()
    await write('\x1b]7501;state=idle:app=claude-code\x1b\\')
    await write('\x1b]7501;state=working:app=claude-code\x07')
    await write(`\x1b]7501;state=working:app=claude-code:msg=${base64('Writing a file')}\x1b\\`)
    await write('\x1b]7501;state=paused:app=claude-code\x1b\\')
    await write('\x1b]7501;state=done:app=claude-code\x1b\\')
    await write('\x1b]7501;state=clear\x1b\\')
    expect(changes).toEqual(['idle', 'working', 'done', null])
    expect(answers).toEqual([])
  })

  it('drops every record at a full reset', async () => {
    const { changes, write } = watched()
    await write('\x1b]7501;state=done\x1b\\')
    await write('\x1bc')
    expect(changes).toEqual(['done', null])
  })

  it('drops what the program was doing, waiting for or idle at, once its shell has the foreground back', async () => {
    const { changes, watch, write } = watched()
    watch.foregroundChanged('zsh')
    // A program can report before the terminal tells that it has the foreground.
    await write('\x1b]7501;state=blocked\x1b\\')
    watch.foregroundChanged('claude')
    expect(changes).toEqual(['blocked'])
    // It ended without clearing what it reported.
    watch.foregroundChanged('zsh')
    expect(changes).toEqual(['blocked', null])
    // A command that reports what it finished before it ends.
    watch.foregroundChanged('make')
    await write('\x1b]7501;state=working\x1b\\')
    await write('\x1b]7501;state=done\x1b\\')
    watch.foregroundChanged('zsh')
    expect(changes).toEqual(['blocked', null, 'working', 'done'])
  })
})
