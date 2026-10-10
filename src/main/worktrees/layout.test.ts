import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_MARKER, WorktreeLayout, safeName } from './layout'
import { makeSandbox } from './test-support'

describe('safeName', () => {
  it('keeps letters of any script, digits, dots, underscores and hyphens', () => {
    expect(safeName('feat/login')).toBe('feat-login')
    expect(safeName('fix#12')).toBe('fix-12')
    expect(safeName('功能/登录')).toBe('功能-登录')
    expect(safeName('My App')).toBe('My-App')
    expect(safeName('v1.2_rc-3')).toBe('v1.2_rc-3')
    expect(safeName('a b/c:d')).toBe('a-b-c-d')
    // Every character that is replaced becomes one hyphen.
    expect(safeName('x🙂y')).toBe('x-y')
  })
})

describe('WorktreeLayout', () => {
  let root: string
  let home: string
  let layout: WorktreeLayout
  let directory: string

  beforeEach(() => {
    ;({ root, home } = makeSandbox('hoot-layout-'))
    directory = path.join(home, '.hoot', 'worktrees')
    layout = new WorktreeLayout(directory, home)
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('shows the home directory as ~', () => {
    expect(layout.displayPath(path.join(directory, 'G', 'feat-login'))).toBe(
      '~/.hoot/worktrees/G/feat-login',
    )
    expect(layout.displayPath(home)).toBe('~')
    expect(layout.displayPath(`${home}-other/x`)).toBe(`${home}-other/x`)
  })

  it('gives each project one folder, named after it, with a suffix for another project of the same name', async () => {
    const app1 = path.join(root, 'one', 'app')
    const app2 = path.join(root, 'two', 'app')
    // Without `create`, nothing is made.
    expect(await layout.projectFolder(app1, { create: false })).toEqual({
      folder: path.join(directory, 'app'),
      created: false,
    })
    expect(fs.existsSync(directory)).toBe(false)

    expect(await layout.projectFolder(app1, { create: true })).toEqual({
      folder: path.join(directory, 'app'),
      created: true,
    })
    expect(await layout.projectFolder(app2, { create: true })).toEqual({
      folder: path.join(directory, 'app-2'),
      created: true,
    })
    expect(await layout.projectFolder(app1, { create: true })).toEqual({
      folder: path.join(directory, 'app'),
      created: false,
    })
    expect(await layout.projectFolder(app2, { create: false })).toEqual({
      folder: path.join(directory, 'app-2'),
      created: false,
    })
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, 'app-2', PROJECT_MARKER), 'utf8')),
    ).toEqual({ root: app2 })

    // Another layout over the same directory (another user data directory) agrees.
    const other = new WorktreeLayout(directory, home)
    expect((await other.projectFolder(app2, { create: true })).folder).toBe(
      path.join(directory, 'app-2'),
    )
  })

  it('takes over a folder without a marker, and skips a file of that name', async () => {
    fs.mkdirSync(path.join(directory, 'G', 'fix-1'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'My-App'), 'not a folder')
    const G = path.join(root, 'G')
    expect(await layout.projectFolder(G, { create: true })).toEqual({
      folder: path.join(directory, 'G'),
      created: false,
    })
    expect(fs.existsSync(path.join(directory, 'G', PROJECT_MARKER))).toBe(true)
    expect((await layout.projectFolder(path.join(root, 'My App'), { create: true })).folder).toBe(
      path.join(directory, 'My-App-2'),
    )
  })

  it('names a worktree folder after the branch, with -2, -3, … when taken', async () => {
    const folder = path.join(directory, 'G')
    fs.mkdirSync(path.join(folder, 'fix-1'), { recursive: true })
    expect(await layout.worktreeRoot(folder, 'fix/1')).toBe(path.join(folder, 'fix-1-2'))
    fs.writeFileSync(path.join(folder, 'fix-1-2'), '')
    expect(await layout.worktreeRoot(folder, 'fix/1')).toBe(path.join(folder, 'fix-1-3'))
    expect(await layout.worktreeRoot(folder, '功能/登录')).toBe(path.join(folder, '功能-登录'))
  })

  it('removes a project folder that holds nothing but its marker', async () => {
    const { folder } = await layout.projectFolder(path.join(root, 'G'), { create: true })
    fs.mkdirSync(path.join(folder, 'kept'))
    await layout.removeIfEmpty(folder)
    expect(fs.existsSync(folder)).toBe(true)
    fs.rmdirSync(path.join(folder, 'kept'))
    await layout.removeIfEmpty(folder)
    expect(fs.existsSync(folder)).toBe(false)
  })
})
