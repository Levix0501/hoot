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
      path.join('~', '.hoot', 'worktrees', 'G', 'feat-login'),
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

  it('counts a link to a folder as the folder, and skips a link that leads nowhere', async () => {
    const G = path.join(root, 'G')
    const { folder } = await layout.projectFolder(G, { create: true })
    // The project folder moves to another disk, and a link to it takes its place.
    const disk = path.join(root, 'disk')
    fs.mkdirSync(disk)
    fs.renameSync(folder, path.join(disk, 'G'))
    fs.symlinkSync(path.join(disk, 'G'), folder)
    expect(await layout.existingProjectFolder(G)).toBe(folder)
    expect(await layout.projectFolder(G, { create: true })).toEqual({ folder, created: false })
    expect(fs.readdirSync(directory)).toEqual(['G'])

    // A link to a folder without a marker is taken over, as the folder would be.
    fs.mkdirSync(path.join(disk, 'App'))
    fs.symlinkSync(path.join(disk, 'App'), path.join(directory, 'App'))
    expect(await layout.projectFolder(path.join(root, 'App'), { create: true })).toEqual({
      folder: path.join(directory, 'App'),
      created: false,
    })
    expect(fs.existsSync(path.join(disk, 'App', PROJECT_MARKER))).toBe(true)

    // A link to a disk that is not there is no project's folder.
    fs.symlinkSync(path.join(root, 'gone'), path.join(directory, 'H'))
    expect((await layout.projectFolder(path.join(root, 'H'), { create: true })).folder).toBe(
      path.join(directory, 'H-2'),
    )
  })

  it('tells the links among the project folders that lead nowhere, and where they lead', async () => {
    expect(await layout.danglingFolders()).toEqual([])
    const disk = path.join(root, 'disk')
    fs.mkdirSync(path.join(disk, 'there'), { recursive: true })
    fs.mkdirSync(path.join(directory, 'folder'), { recursive: true })
    fs.symlinkSync(path.join(disk, 'there'), path.join(directory, 'linked'))
    fs.symlinkSync(path.join(disk, 'away'), path.join(directory, 'unplugged'))
    // A link to a link that leads nowhere, written relative to its folder.
    fs.symlinkSync(path.join('..', '..', '..', 'disk', 'hop'), path.join(directory, 'chained'))
    fs.symlinkSync(path.join(disk, 'gone'), path.join(disk, 'hop'))
    fs.writeFileSync(path.join(directory, 'file'), '')
    expect(await layout.danglingFolders()).toEqual([
      { folder: path.join(directory, 'chained'), target: path.join(disk, 'gone') },
      { folder: path.join(directory, 'unplugged'), target: path.join(disk, 'away') },
    ])
  })

  it('tells every folder of a project, as one is made while the first leads nowhere', async () => {
    const G = path.join(root, 'G')
    expect(await layout.projectFolders(G)).toEqual([])
    const { folder } = await layout.projectFolder(G, { create: true })
    await layout.projectFolder(path.join(root, 'other', 'G'), { create: true })
    // Moved to a disk that is then not connected, with a link to it in its place.
    const disk = path.join(root, 'disk')
    fs.mkdirSync(disk)
    fs.renameSync(folder, path.join(disk, 'G'))
    fs.symlinkSync(path.join(disk, 'G'), folder)
    fs.renameSync(path.join(disk, 'G'), path.join(disk, 'G-away'))
    expect((await layout.projectFolder(G, { create: true })).folder).toBe(
      path.join(directory, 'G-3'),
    )
    expect(await layout.projectFolders(G)).toEqual([path.join(directory, 'G-3')])

    // Connected again: the first one is where new worktrees go.
    fs.renameSync(path.join(disk, 'G-away'), path.join(disk, 'G'))
    expect(await layout.projectFolders(G)).toEqual([folder, path.join(directory, 'G-3')])
    expect(await layout.existingProjectFolder(G)).toBe(folder)
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
