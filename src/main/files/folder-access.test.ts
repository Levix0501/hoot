import { describe, expect, it } from 'vitest'
import { FolderAccess } from './folder-access'

/** A FolderAccess of the project `/p`, whose worktrees are `worktrees`, on a clock of its own. */
function setup(worktrees: string[]) {
  let now = 0
  let asked = 0
  const access = new FolderAccess({
    isProject: (root) => root === '/p',
    isWorktreeOf: async (root, worktreePath) => {
      asked++
      return root === '/p' && worktrees.includes(worktreePath)
    },
    now: () => now,
  })
  return {
    access,
    asked: () => asked,
    wait: (ms: number) => {
      now += ms
    },
  }
}

describe('FolderAccess', () => {
  it("gives a project's own folder, and its worktrees", async () => {
    const { access } = setup(['/w'])
    expect(await access.folder('/p', null)).toBe('/p')
    expect(await access.folder('/p', '/w')).toBe('/w')
  })

  it('gives no folder of a project not in the list, nor a folder that is no worktree', async () => {
    const { access } = setup(['/w'])
    expect(await access.folder('/other', null)).toBeNull()
    expect(await access.folder('/other', '/w')).toBeNull()
    expect(await access.folder('/p', '/elsewhere')).toBeNull()
  })

  it('asks Git about a worktree again only after a while', async () => {
    const { access, asked, wait } = setup(['/w'])
    await access.folder('/p', '/w')
    await access.folder('/p', '/w')
    expect(asked()).toBe(1)
    wait(10_000)
    await access.folder('/p', '/w')
    expect(asked()).toBe(2)
  })

  it('asks again at once about a folder that was no worktree', async () => {
    const worktrees: string[] = []
    const { access, asked } = setup(worktrees)
    expect(await access.folder('/p', '/w')).toBeNull()
    worktrees.push('/w')
    expect(await access.folder('/p', '/w')).toBe('/w')
    expect(asked()).toBe(2)
  })
})
