import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSystemTerminal, systemTerminalLaunch } from './system-terminal'

const zsh = { file: '/bin/zsh', args: ['-l'] }
const pwsh = { file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'] }

let root: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-terminal-')))
  fs.writeFileSync(path.join(root, 'file.txt'), '')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('systemTerminalLaunch', () => {
  it('opens Terminal in the folder on macOS', () => {
    expect(systemTerminalLaunch('/work/my app', zsh, {}, 'darwin')).toEqual({
      file: '/usr/bin/open',
      args: ['-b', 'com.apple.Terminal', '/work/my app'],
      cwd: '/work/my app',
    })
  })

  it('starts the session shell in a console of its own on Windows, from cmd run in the folder', () => {
    expect(
      systemTerminalLaunch(
        'C:\\work\\my app',
        pwsh,
        { ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe' },
        'win32',
      ),
    ).toEqual({
      file: 'C:\\WINDOWS\\system32\\cmd.exe',
      args: ['/d', '/c', 'start', '', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoLogo'],
      cwd: 'C:\\work\\my app',
    })
  })

  it("takes Windows's own cmd when ComSpec names none", () => {
    expect(
      systemTerminalLaunch('C:\\work', pwsh, { SYSTEMROOT: 'D:\\Windows' }, 'win32')?.file,
    ).toBe('D:\\Windows\\System32\\cmd.exe')
    expect(systemTerminalLaunch('C:\\work', pwsh, {}, 'win32')?.file).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    )
  })

  it('has no terminal to open elsewhere', () => {
    expect(systemTerminalLaunch('/work', zsh, {}, 'linux')).toBeNull()
  })
})

describe('openSystemTerminal', () => {
  it('opens nothing in a folder that is not there', async () => {
    const missing = path.join(root, 'missing')
    await expect(openSystemTerminal(missing, zsh, {}, 'darwin')).rejects.toThrow(
      `The folder is missing: ${missing}`,
    )
    const file = path.join(root, 'file.txt')
    await expect(openSystemTerminal(file, zsh, {}, 'darwin')).rejects.toThrow(
      `The folder is missing: ${file}`,
    )
  })

  it('says so where it cannot open a terminal', async () => {
    await expect(openSystemTerminal(root, zsh, {}, 'linux')).rejects.toThrow(
      'Hoot cannot open a terminal on this system.',
    )
  })
})
