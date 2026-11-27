import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { removeTestFolder } from './test-support'

const windows = process.platform === 'win32'

function makeFolder(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-test-support-')))
}

describe('removeTestFolder', () => {
  it('removes a folder with everything in it', async () => {
    const folder = makeFolder()
    fs.mkdirSync(path.join(folder, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'a', 'b', 'c.txt'), 'c')
    await removeTestFolder(folder)
    expect(fs.existsSync(folder)).toBe(false)
  })

  // Windows has no permissions on folders that keep the user from removing files.
  it.skipIf(windows)('fails outside Windows when the folder cannot be removed', async () => {
    const folder = makeFolder()
    const locked = path.join(folder, 'locked')
    fs.mkdirSync(locked)
    fs.writeFileSync(path.join(locked, 'file.txt'), '')
    fs.chmodSync(locked, 0o555)
    try {
      await expect(removeTestFolder(folder)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      fs.chmodSync(locked, 0o755)
      await removeTestFolder(folder)
    }
  })

  it.runIf(windows)(
    'leaves a folder in use on Windows behind, saying what runs in it',
    async () => {
      const folder = makeFolder()
      const script = path.join(folder, 'hold.cjs')
      fs.writeFileSync(script, "process.stdout.write('ready')\nsetInterval(() => {}, 1000)\n")
      // A process's working folder, which Windows keeps from being removed while it runs.
      const child = spawn(process.execPath, [script], {
        cwd: folder,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await once(child.stdout, 'data')
        await removeTestFolder(folder, 500)
        expect(fs.existsSync(folder)).toBe(true)
        expect(warn).toHaveBeenCalledOnce()
        const text = String(warn.mock.calls[0]?.[0])
        expect(text).toContain(`Left ${folder} behind`)
        expect(text).toContain(`${child.pid}, started by ${process.pid}: `)
      } finally {
        warn.mockRestore()
        child.kill()
        if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
        await removeTestFolder(folder)
      }
    },
  )
})
