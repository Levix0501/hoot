import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultShell } from './default-shell'

let root: string
/** A shell that SHELL can name. */
let fish: string
/** The folder that PowerShell 7 is installed in. */
let powerShell7: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-shell-')))
  fish = path.join(root, 'bin', 'fish')
  powerShell7 = path.join(root, 'PowerShell', '7')
  for (const file of [fish, path.join(powerShell7, 'pwsh.exe')]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '', { mode: 0o755 })
  }
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('defaultShell', () => {
  it('runs the shell SHELL names, as a login shell, outside Windows', () => {
    expect(defaultShell({ SHELL: fish }, 'darwin')).toEqual({ file: fish, args: ['-l'] })
  })

  it('runs the first PowerShell 7 on Path on Windows, whatever SHELL names, without its banner', () => {
    const env = { Path: [path.join(root, 'bin'), powerShell7].join(';'), SHELL: fish }
    expect(defaultShell(env, 'win32')).toEqual({
      file: path.join(powerShell7, 'pwsh.exe'),
      args: ['-NoLogo'],
    })
  })

  it('runs the Windows PowerShell that comes with Windows when Path has no PowerShell 7', () => {
    const env = { Path: path.join(root, 'bin'), SYSTEMROOT: 'D:\\Windows', SHELL: fish }
    expect(defaultShell(env, 'win32')).toEqual({
      file: 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoLogo'],
    })
    expect(defaultShell({}, 'win32').file).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })
})
