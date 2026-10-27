import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { sameProjectFolder, type ProjectFolderInfo } from '../../shared/project-folders'
import { shortBranchName } from '../git/git'
import { git, type GitContext } from '../worktrees/repositories'

/** How often every project folder is looked at, in milliseconds. */
const LOOK_INTERVAL_MS = 1_000

/**
 * What the reftable backend of Git keeps in HEAD whatever is checked out:
 * with it, the file tells nothing, and Git is asked every time.
 */
const REFTABLE_HEAD = 'ref: refs/heads/.invalid'

export interface ProjectFolderOptions {
  /** How to run git, resolved for each look that asks it. */
  gitContext(): Promise<GitContext>
  /** How often every project folder is looked at, in milliseconds. */
  intervalMs?: number
}

interface FolderState {
  root: string
  /** What the last look found; `null` until the first one. */
  info: ProjectFolderInfo | null
  /** What the folder's HEAD file said at the last look, which tells when to ask Git again. */
  head: string | null
  looking: Promise<void> | null
  /** Whether another look, which asks Git whatever HEAD says, follows the one under way. */
  again: boolean
  /** Settles once the folder has been looked at for the first time. */
  ready: Promise<void>
  removed: boolean
}

async function isDirectory(directory: string): Promise<boolean> {
  return (await fs.stat(directory).catch(() => null))?.isDirectory() ?? false
}

/**
 * What a repository's HEAD file says, read without Git: in the folder its
 * `.git` names, or in that folder itself. `null` when it cannot be read, as
 * outside a repository.
 */
async function readHead(root: string): Promise<string | null> {
  const dotGit = path.join(root, '.git')
  try {
    let gitDirectory = dotGit
    if ((await fs.stat(dotGit)).isFile()) {
      // A `.git` file says where Git keeps the repository.
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotGit, 'utf8'))
      if (!match) return null
      gitDirectory = path.resolve(root, match[1]!)
    }
    return (await fs.readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim()
  } catch {
    return null
  }
}

/**
 * Follows the own folder of every project in the list, the main worktree of
 * its repository: whether it is there, and the branch checked out in it, or
 * on a HEAD that is on no branch, its commit, abbreviated as a worktree row
 * shows it. It looks at every folder once a second, reading only the HEAD
 * file, and asks Git only when what it says changed, so that a change shows
 * however it was made: by an agent in a session, or outside Hoot. Nothing is
 * watched, which would keep a handle on the folder open, and on Windows keep
 * it from being renamed. `changed` reports a folder once it is first looked
 * at, and then whenever what was found changes.
 */
export class ProjectFolders extends EventEmitter<{
  changed: [projectRoot: string, folder: ProjectFolderInfo]
}> {
  private readonly folders = new Map<string, FolderState>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly options: ProjectFolderOptions) {
    super()
    this.timer = setInterval(() => {
      for (const state of this.folders.values()) void this.look(state, false)
    }, options.intervalMs ?? LOOK_INTERVAL_MS)
    // It never keeps Hoot running by itself.
    this.timer.unref?.()
  }

  /** Follows the project list: starts on new projects and stops on removed ones. */
  setProjects(roots: readonly string[]): void {
    const wanted = new Set(roots)
    for (const root of this.folders.keys()) if (!wanted.has(root)) this.removeProject(root)
    for (const root of roots) this.addProject(root)
  }

  addProject(root: string): void {
    if (this.folders.has(root)) return
    const state: FolderState = {
      root,
      info: null,
      head: null,
      looking: null,
      again: false,
      ready: Promise.resolve(),
      removed: false,
    }
    this.folders.set(root, state)
    state.ready = this.look(state, true)
  }

  removeProject(root: string): void {
    const state = this.folders.get(root)
    if (!state) return
    state.removed = true
    this.folders.delete(root)
  }

  /** Stops looking at the folders, as Hoot quits. */
  dispose(): void {
    clearInterval(this.timer)
    for (const root of this.folders.keys()) this.removeProject(root)
  }

  /** Every project's folder, once it has been looked at. */
  async list(): Promise<Record<string, ProjectFolderInfo>> {
    const states = [...this.folders.values()]
    await Promise.all(states.map((state) => state.ready))
    return Object.fromEntries(
      states.flatMap((state) => (state.info === null ? [] : [[state.root, state.info]])),
    )
  }

  /**
   * Looks at a project's folder now, which `changed` then reports if it
   * changed, and returns what it found, as before a session starts in it;
   * `null` when the project is not in the list.
   */
  async current(projectRoot: string): Promise<ProjectFolderInfo | null> {
    const state = this.folders.get(projectRoot)
    if (!state) return null
    await this.look(state, true)
    return state.info
  }

  /** Looks at every project's folder again, asking Git, as when the window gets the focus. */
  refreshAll(): void {
    for (const state of this.folders.values()) void this.look(state, true)
  }

  /**
   * Looks at a folder, unless a look is under way: `force` then has another
   * follow it, and asks Git whatever HEAD says, as the first look does.
   */
  private look(state: FolderState, force: boolean): Promise<void> {
    if (state.looking) {
      if (force) state.again = true
      return state.looking
    }
    state.looking = (async () => {
      let ask = force
      do {
        state.again = false
        await this.lookOnce(state, ask)
        ask = true
      } while (state.again && !state.removed)
    })()
      .catch((error: unknown) => console.error('Could not look at the folder', state.root, error))
      .finally(() => {
        state.looking = null
      })
    return state.looking
  }

  private async lookOnce(state: FolderState, force: boolean): Promise<void> {
    let info: ProjectFolderInfo
    if (!(await isDirectory(state.root))) {
      // What was checked out shows again once it is back, and is read again then.
      state.head = null
      info = {
        missing: true,
        branch: state.info?.branch ?? null,
        displayName: state.info?.displayName ?? '',
      }
    } else {
      const head = await readHead(state.root)
      const unchanged =
        state.info !== null && !state.info.missing && head === state.head && head !== REFTABLE_HEAD
      if (unchanged && !force) return
      state.head = head
      info = { missing: false, ...(await this.checkedOut(state.root)) }
    }
    if (state.removed || sameProjectFolder(state.info, info)) return
    state.info = info
    this.emit('changed', state.root, info)
  }

  /**
   * The branch checked out in a folder, as Git tells it, or on a HEAD that is
   * on no branch, the abbreviated commit, as `git rev-parse --short HEAD`
   * gives it for a worktree row there.
   */
  private async checkedOut(root: string): Promise<Omit<ProjectFolderInfo, 'missing'>> {
    let context: GitContext
    try {
      context = await this.options.gitContext()
    } catch {
      return { branch: null, displayName: '' }
    }
    const symbolic = await git(context, ['-C', root, 'symbolic-ref', '-q', 'HEAD'])
    if (symbolic.code === 0 && symbolic.stdout.trim() !== '') {
      const branch = shortBranchName(symbolic.stdout.trim())
      return { branch, displayName: branch }
    }
    const commit = await git(context, ['-C', root, 'rev-parse', '--short', 'HEAD'])
    return { branch: null, displayName: commit.code === 0 ? commit.stdout.trim() : '' }
  }
}
