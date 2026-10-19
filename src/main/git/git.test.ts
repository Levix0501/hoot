import { describe, expect, it } from 'vitest'
import { gitEnvironment, parseWorktreeList, runGit, shortBranchName } from './git'

describe('parseWorktreeList', () => {
  it('reads paths and the bare flag', () => {
    expect(
      parseWorktreeList(
        'worktree /r/bare.git\0bare\0\0worktree /r/linked\0HEAD 0123\0branch refs/heads/main\0\0',
        'darwin',
      ).map(({ path, bare }) => ({ path, bare })),
    ).toEqual([
      { path: '/r/bare.git', bare: true },
      { path: '/r/linked', bare: false },
    ])
  })

  it('gives the paths with \\ on Windows, where Git writes them with /', () => {
    const output =
      'worktree C:/Users/me/r\0HEAD aaa\0branch refs/heads/main\0\0' +
      'worktree //server/share/r/feat\0HEAD bbb\0branch refs/heads/feat\0\0'
    expect(parseWorktreeList(output, 'win32').map(({ path }) => path)).toEqual([
      'C:\\Users\\me\\r',
      '\\\\server\\share\\r\\feat',
    ])
  })

  it('reads the branch, a detached HEAD, locks with and without a reason, and prunable entries', () => {
    const output = [
      'worktree /r/main\0HEAD aaa\0branch refs/heads/main\0',
      'worktree /r/with space\0HEAD bbb\0detached\0locked\0',
      'worktree /r/usb\0HEAD ccc\0branch refs/heads/feat/x\0locked on usb\nstick\0',
      'worktree /r/gone\0HEAD ddd\0branch refs/heads/gone\0prunable gitdir file points to non-existent location\0',
    ].join('\0')
    expect(parseWorktreeList(`${output}\0`, 'darwin')).toEqual([
      {
        path: '/r/main',
        bare: false,
        head: 'aaa',
        branch: 'refs/heads/main',
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
      },
      {
        path: '/r/with space',
        bare: false,
        head: 'bbb',
        branch: null,
        detached: true,
        locked: true,
        lockReason: null,
        prunable: false,
      },
      {
        path: '/r/usb',
        bare: false,
        head: 'ccc',
        branch: 'refs/heads/feat/x',
        detached: false,
        locked: true,
        lockReason: 'on usb\nstick',
        prunable: false,
      },
      {
        path: '/r/gone',
        bare: false,
        head: 'ddd',
        branch: 'refs/heads/gone',
        detached: false,
        locked: false,
        lockReason: null,
        prunable: true,
      },
    ])
  })
})

describe('shortBranchName', () => {
  it('drops refs/heads/ only', () => {
    expect(shortBranchName('refs/heads/feat/login')).toBe('feat/login')
    expect(shortBranchName('refs/remotes/origin/main')).toBe('refs/remotes/origin/main')
  })
})

describe('gitEnvironment', () => {
  it('removes repository overrides and asks for untranslated messages', () => {
    const result = gitEnvironment({
      PATH: '/bin',
      GIT_DIR: '/x',
      GIT_WORK_TREE: '/y',
      LANG: 'zh_CN.UTF-8',
    })
    expect(result).toMatchObject({ PATH: '/bin', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' })
    expect(result).not.toHaveProperty('GIT_DIR')
    expect(result).not.toHaveProperty('GIT_WORK_TREE')
  })
})

describe('runGit', () => {
  it('reports the exit code and output, and a missing executable as -1', async () => {
    const env = gitEnvironment({ PATH: process.env.PATH ?? '/usr/bin:/bin' })
    const ok = await runGit('git', ['--version'], env)
    expect(ok.code).toBe(0)
    expect(ok.stdout).toMatch(/^git version/)
    const failed = await runGit('git', ['no-such-command'], env)
    expect(failed.code).not.toBe(0)
    const missing = await runGit('/no/such/git', ['--version'], env)
    expect(missing.code).toBe(-1)
  })
})
