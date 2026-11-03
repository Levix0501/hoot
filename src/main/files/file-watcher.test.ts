import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileWatcher } from './file-watcher'

describe('FileWatcher', () => {
  let root: string
  let watcher: FileWatcher
  /** What `changed` reported, in order. */
  let reported: Array<[string, string]>

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-file-watcher-')))
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'one')
    reported = []
    watcher = new FileWatcher(20)
    watcher.on('changed', (folder, entry) => reported.push([folder, entry]))
  })

  afterEach(async () => {
    watcher.dispose()
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  /** Waits until `changed` reported `entry`, failing after a while. */
  const reportedEntry = async (entry: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (reported.some(([, changed]) => changed === entry)) return
      await delay(10)
    }
    expect(reported).toContainEqual([root, entry])
  }

  it('reports a watched file once it changes, and once it goes away', async () => {
    watcher.watch(root, ['src/a.ts'])
    await delay(60)
    expect(reported).toEqual([])
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'two, longer')
    await reportedEntry('src/a.ts')
    reported = []
    fs.rmSync(path.join(root, 'src', 'a.ts'))
    await reportedEntry('src/a.ts')
  })

  it('reports a watched folder once an entry is added to it', async () => {
    watcher.watch(root, ['src/'])
    await delay(60)
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), '')
    await reportedEntry('src/')
    expect(reported).toContainEqual([root, 'src/'])
  })

  it('stops reporting what it no longer watches', async () => {
    watcher.watch(root, ['src/a.ts'])
    watcher.watch(root, [])
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'two, longer')
    await delay(120)
    expect(reported).toEqual([])
  })
})
