import { spawn, type IPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
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
 * Starts a session whose process starts ping detached, as Claude Code starts
 * the commands of its Bash tool, which leaves ping outside the session's
 * console.
 */
async function startSession(): Promise<{ session: IPty; exited: Promise<unknown>; ping: number }> {
  const script =
    "const ping = require('node:child_process').spawn('ping', ['-n', '600', '127.0.0.1'], { detached: true, stdio: 'ignore', windowsHide: true }); console.log('ping ' + ping.pid + '.'); setInterval(() => {}, 1000)"
  const session = spawn(process.execPath, ['-e', script], { cols: 120, rows: 24 })
  const exited = new Promise((resolve) => session.onExit(resolve))
  let output = ''
  session.onData((data) => {
    output += data
  })
  const ping = (): number => Number(/ping (\d+)\./.exec(output)?.[1] ?? 0)
  await expect.poll(ping, { timeout: 10_000 }).toBeGreaterThan(0)
  programs.push(ping())
  return { session, exited, ping: ping() }
}

describe.runIf(process.platform === 'win32')('endWindowsSession', () => {
  it('ends the session together with the programs it started, detached ones included', async () => {
    const { session, exited, ping } = await startSession()
    expect(isRunning(ping)).toBe(true)
    await endWindowsSession(session)
    await exited
    expect(isRunning(ping)).toBe(false)
  })

  it('may be asked again while the session ends and after it has ended', async () => {
    const { session, exited, ping } = await startSession()
    await Promise.all([endWindowsSession(session), endWindowsSession(session)])
    await exited
    await endWindowsSession(session)
    expect(isRunning(ping)).toBe(false)
  })
})
