import { spawn, type IPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { CONPTY_OPTIONS } from './conpty'
import { endWindowsSession } from './end-windows-session'

const programs: number[] = []

afterEach(() => {
  for (const pid of programs.splice(0)) {
    try {
      process.kill(pid)
    } catch {
      // It has ended.
    }
  }
})

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Starts ping detached, as Claude Code starts the commands of its Bash tool,
 * which leaves ping outside the session's console, and prints its pid.
 */
const START_DETACHED_PING =
  "const ping = require('node:child_process').spawn('ping', ['-n', '600', '127.0.0.1'], { detached: true, stdio: 'ignore', windowsHide: true }); console.log('program ' + ping.pid + '.')"

/** A Node.js program that prints its pid and keeps running. */
const PRINT_PID = "console.log('program ' + process.pid + '.'); setInterval(() => {}, 1000)"

/**
 * Starts {@link PRINT_PID} in the session's console through a cmd that ends
 * at once, which leaves it without a running parent: taskkill /T does not
 * find it under the session's process. Not with Node.js's own spawn, whose
 * programs end together with the process that started them.
 */
const START_ORPHAN = `require('node:child_process').spawn('cmd.exe', ['/d', '/c', 'start "" /b "' + process.execPath + '" -e ' + ${JSON.stringify(JSON.stringify(PRINT_PID))}], { stdio: 'inherit', windowsVerbatimArguments: true })`

/**
 * Starts a session in the ConPTY the pty host starts sessions in, whose
 * process runs `script` to start a program and print its pid, then keeps
 * running.
 */
async function startSession(
  script: string,
): Promise<{ session: IPty; exited: Promise<unknown>; program: number }> {
  const session = spawn(process.execPath, ['-e', `${script}; setInterval(() => {}, 1000)`], {
    cols: 120,
    rows: 24,
    ...CONPTY_OPTIONS,
  })
  const exited = new Promise((resolve) => session.onExit(resolve))
  let output = ''
  session.onData((data) => {
    output += data
    // ConPTY holds the output back until the terminal says what it is, as
    // xterm.js does in Hoot.
    if (data.includes('\x1b[c')) session.write('\x1b[?1;2c')
  })
  const program = (): number => Number(/program (\d+)\./.exec(output)?.[1] ?? 0)
  await expect.poll(program, { timeout: 10_000 }).toBeGreaterThan(0)
  programs.push(program())
  return { session, exited, program: program() }
}

describe.runIf(process.platform === 'win32')('endWindowsSession', () => {
  it('ends the session together with the programs it started, detached ones included', async () => {
    const { session, exited, program } = await startSession(START_DETACHED_PING)
    expect(isRunning(program)).toBe(true)
    await endWindowsSession(session)
    await exited
    expect(isRunning(program)).toBe(false)
  })

  it("ends the programs left in the session's console once what started them has ended", async () => {
    const { session, exited, program } = await startSession(START_ORPHAN)
    expect(isRunning(program)).toBe(true)
    await endWindowsSession(session)
    await exited
    await expect.poll(() => isRunning(program), { timeout: 5_000 }).toBe(false)
  })

  it('may be asked again while the session ends and after it has ended', async () => {
    const { session, exited, program } = await startSession(START_DETACHED_PING)
    await Promise.all([endWindowsSession(session), endWindowsSession(session)])
    await exited
    await endWindowsSession(session)
    expect(isRunning(program)).toBe(false)
  })
})
