import { EventEmitter } from 'node:events'
import fs, { type FSWatcher } from 'node:fs'
import path from 'node:path'
import {
  compareWorktrees,
  inspectionIsClean,
  type CreateWorktreeRequest,
  type CreateWorktreeResult,
  type DeleteWorktreeResult,
  type InspectWorktreeResult,
  type NewWorktreeOptions,
  type RemoveWorktreeResult,
  type WorktreeInfo,
  type WorktreeInspection,
} from '../../shared/worktrees'
import {
  gitErrorMessage,
  parseWorktreeList,
  runGit,
  shortBranchName,
  type GitResult,
  type WorktreeEntry,
} from '../git/git'
import { InspectionError, inspectMembers, type MemberToCheck } from './inspection'
import type { WorktreeLayout } from './layout'
import {
  findInnerRepositories,
  git,
  hasBranch,
  locateRepository,
  readBranches,
  submodulesAt,
  type GitContext,
  type InnerRepository,
} from './repositories'

/** Creating or removing a worktree runs hooks and touches many files: no short limit. */
const WORKTREE_COMMAND_TIMEOUT = 10 * 60_000
/** Changes to the registrations are read this long after the last one. */
const REFRESH_DELAY_MS = 100
/** Window focus looks for new inner repositories at most this often. */
const REDISCOVERY_INTERVAL_MS = 30_000

export interface WorktreeServiceOptions {
  layout: WorktreeLayout
  /** How to run git, resolved for each operation. */
  gitContext(): Promise<GitContext>
}

interface ProjectState {
  root: string
  name: string
  /** The Git directory shared by the project repository's worktrees. */
  commonDir: string | null
  /** The inner repositories, once they have been looked for. */
  inner: InnerRepository[] | null
  discoveredAt: number
  discovering: Promise<void> | null
  worktrees: WorktreeInfo[]
  refreshing: Promise<void> | null
  refreshAgain: boolean
  timer: NodeJS.Timeout | null
  /** The Git directories watched for this project. */
  watched: Set<string>
  /** Settles once the worktrees have been read for the first time. */
  ready: Promise<void>
  removed: boolean
}

/** A member of a worktree in its repository. */
interface Member {
  /** The repository's working directory in the project. */
  repository: string
  /** The member's directory. */
  path: string
  /** Relative to the worktree root; empty for the outer member. */
  relativePath: string
  label: string
}

/**
 * Whether a file name reported by a watch on a Git directory belongs to the
 * worktree registrations: a worktree's administrative directory, the file
 * that says where it is, its lock, or its HEAD.
 */
export function isRegistrationChange(filename: string): boolean {
  const parts = filename.split(path.sep)
  if (parts[0] !== 'worktrees') return false
  if (parts.length <= 2) return true
  return parts.length === 3 && ['gitdir', 'locked', 'HEAD'].includes(parts[2]!)
}

/** Deeper relative paths first, as worktree members are deleted. */
export function deepestFirst<T extends { relativePath: string }>(members: readonly T[]): T[] {
  const depth = (member: T) => member.relativePath.split('/').length
  return members.toSorted((a, b) => depth(b) - depth(a))
}

async function isDirectory(directory: string): Promise<boolean> {
  return (await fs.promises.stat(directory).catch(() => null))?.isDirectory() ?? false
}

function sameWorktrees(a: readonly WorktreeInfo[], b: readonly WorktreeInfo[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Lists, watches, creates and deletes the worktrees of the projects in the
 * list. A project's worktrees are read from its repository's registrations,
 * so that worktrees made outside Hoot are listed too, and are read again
 * whenever the registrations of the project repository or of its inner
 * repositories change. `changed` reports a project's worktrees whenever they
 * change.
 */
export class WorktreeService extends EventEmitter<{
  changed: [projectRoot: string, worktrees: WorktreeInfo[]]
}> {
  private readonly projects = new Map<string, ProjectState>()
  private readonly watchers = new Map<string, { watcher: FSWatcher; projects: Set<string> }>()

  constructor(private readonly options: WorktreeServiceOptions) {
    super()
  }

  /** Follows the project list: starts on new projects and stops on removed ones. */
  setProjects(roots: readonly string[]): void {
    const wanted = new Set(roots)
    for (const root of this.projects.keys()) if (!wanted.has(root)) this.removeProject(root)
    for (const root of roots) this.addProject(root)
  }

  addProject(root: string): void {
    if (this.projects.has(root)) return
    const state: ProjectState = {
      root,
      name: path.basename(root) || root,
      commonDir: null,
      inner: null,
      discoveredAt: 0,
      discovering: null,
      worktrees: [],
      refreshing: null,
      refreshAgain: false,
      timer: null,
      watched: new Set(),
      ready: Promise.resolve(),
      removed: false,
    }
    this.projects.set(root, state)
    state.ready = (async () => {
      const context = await this.options.gitContext()
      state.commonDir = (await locateRepository(context, root))?.commonDir ?? null
      if (state.removed) return
      if (state.commonDir) this.watch(state, state.commonDir)
      await this.refresh(state)
    })().catch((error: unknown) => console.error('Could not list the worktrees of', root, error))
    void state.ready.then(() => this.discover(state))
  }

  removeProject(root: string): void {
    const state = this.projects.get(root)
    if (!state) return
    state.removed = true
    if (state.timer) clearTimeout(state.timer)
    this.unwatch(state, new Set())
    this.projects.delete(root)
  }

  /** Stops every watch. */
  dispose(): void {
    // Deleting the entry being visited does not disturb the iteration.
    for (const root of this.projects.keys()) this.removeProject(root)
  }

  /** Every project's worktrees, once they have been read. */
  async listAll(): Promise<Record<string, WorktreeInfo[]>> {
    const states = [...this.projects.values()]
    await Promise.all(states.map((state) => state.ready))
    return Object.fromEntries(states.map((state) => [state.root, state.worktrees]))
  }

  /**
   * Reads every project's worktrees again, as when the window gets the focus:
   * a worktree whose directory was deleted is then shown as missing. Inner
   * repositories are looked for again when they have not been for a while.
   */
  refreshAll(): void {
    for (const state of this.projects.values()) {
      if (Date.now() - state.discoveredAt >= REDISCOVERY_INTERVAL_MS) void this.discover(state)
      else void this.refresh(state)
    }
  }

  /** Whether a directory is the root of one of the project's worktrees that exists. */
  async isWorktreeOf(projectRoot: string, directory: string): Promise<boolean> {
    const state = this.projects.get(projectRoot)
    if (!state) return false
    const context = await this.options.gitContext()
    const entries = await this.readEntries(context, state)
    const entry = entries.find((candidate) => candidate.path === directory)
    return entry !== undefined && (await isDirectory(directory))
  }

  /** What the new worktree dialog offers, after looking for inner repositories again. */
  async newWorktreeOptions(projectRoot: string): Promise<NewWorktreeOptions | null> {
    const state = this.projects.get(projectRoot)
    if (!state) return null
    await this.discover(state)
    const context = await this.options.gitContext()
    const [project, nested] = await Promise.all([
      readBranches(context, projectRoot),
      Promise.all(
        (state.inner ?? []).map(async (repository) => ({
          relativePath: repository.relativePath,
          ...(await readBranches(context, repository.path)),
        })),
      ),
    ])
    return { branches: project.branches, current: project.current, nested }
  }

  /** Whether Git accepts a name as a new branch's name. */
  async isValidBranchName(name: string): Promise<boolean> {
    if (name === '') return false
    const context = await this.options.gitContext()
    // Outside any repository, so that `@{-1}` and the like do not refer to a branch.
    const result = await runGit(
      context.git,
      ['-C', '/', 'check-ref-format', '--branch', name],
      context.env,
    )
    return result.code === 0 && result.stdout.trim() === name
  }

  /** Where a new worktree of the branch would be created, without creating anything. */
  async previewPath(
    projectRoot: string,
    branch: string,
  ): Promise<{ path: string; displayPath: string } | null> {
    if (!this.projects.has(projectRoot) || branch === '') return null
    const { layout } = this.options
    const { folder } = await layout.projectFolder(projectRoot, { create: false })
    const root = await layout.worktreeRoot(folder, branch)
    return { path: root, displayPath: layout.displayPath(root) }
  }

  /**
   * The submodules in the base branches' commits of the repositories that
   * would take part, relative to the project root.
   */
  async submodules(
    projectRoot: string,
    participants: ReadonlyArray<{ relativePath: string; base: string }>,
  ): Promise<string[]> {
    const state = this.projects.get(projectRoot)
    if (!state) return []
    const context = await this.options.gitContext()
    const lists = await Promise.all(
      participants.map(async ({ relativePath, base }) => {
        const repository =
          relativePath === ''
            ? projectRoot
            : state.inner?.find((candidate) => candidate.relativePath === relativePath)?.path
        if (!repository || !(await hasBranch(context, repository, base))) return []
        const paths = await submodulesAt(context, repository, `refs/heads/${base}`)
        return paths.map((entry) => (relativePath === '' ? entry : `${relativePath}/${entry}`))
      }),
    )
    return lists.flat().toSorted()
  }

  /**
   * Creates a worktree: a new branch in the project repository and in each
   * included inner repository, from each one's base branch, checked out in
   * linked worktrees at the root and at the inner repositories' relative paths
   * inside it. When a member cannot be created, the members and branches
   * created so far are removed again.
   */
  async create(request: CreateWorktreeRequest): Promise<CreateWorktreeResult> {
    const state = this.projects.get(request.projectRoot)
    if (!state) return { ok: false, reason: 'invalid', message: 'The project is not in the list.' }
    if (!(await this.isValidBranchName(request.branch))) {
      return { ok: false, reason: 'invalid', message: 'The name is not a valid branch name.' }
    }
    const context = await this.options.gitContext()
    if (request.nested.length > 0 && state.inner === null) await this.discover(state)

    const repositories: Array<{ repository: string; relativePath: string; base: string }> = [
      { repository: state.root, relativePath: '', base: request.base },
    ]
    const included = new Set<string>()
    for (const entry of request.nested) {
      const inner = state.inner?.find((candidate) => candidate.relativePath === entry.relativePath)
      if (!inner || included.has(entry.relativePath)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `${entry.relativePath} is not an inner repository of ${state.name}.`,
        }
      }
      included.add(entry.relativePath)
      repositories.push({
        repository: inner.path,
        relativePath: inner.relativePath,
        base: entry.base,
      })
    }
    // Parents before the repositories inside them.
    repositories.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
    const label = (relativePath: string) => (relativePath === '' ? state.name : relativePath)

    for (const { repository, relativePath, base } of repositories) {
      if (!(await hasBranch(context, repository, base))) {
        return {
          ok: false,
          reason: 'invalid',
          message: `${label(relativePath)} has no local branch named ${base}.`,
        }
      }
    }
    const existing: string[] = []
    for (const { repository, relativePath } of repositories) {
      if (await hasBranch(context, repository, request.branch)) existing.push(label(relativePath))
    }
    if (existing.length > 0) {
      return {
        ok: false,
        reason: 'branch-exists',
        message: `A branch named ${request.branch} already exists in ${existing.join(', ')}.`,
      }
    }

    const { layout } = this.options
    let projectFolder: { folder: string; created: boolean }
    let root: string
    try {
      projectFolder = await layout.projectFolder(state.root, { create: true })
      root = await layout.worktreeRoot(projectFolder.folder, request.branch)
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        message: `Could not create the folder for the worktree: ${(error as Error).message}`,
      }
    }

    const created: Member[] = []
    const branched: Member[] = []
    const warnings: string[] = []
    for (const { repository, relativePath, base } of repositories) {
      const member: Member = {
        repository,
        path: relativePath === '' ? root : path.join(root, relativePath),
        relativePath,
        label: label(relativePath),
      }
      const result = await runGit(
        context.git,
        [
          '-C',
          repository,
          'worktree',
          'add',
          '-q',
          '-b',
          request.branch,
          member.path,
          `refs/heads/${base}`,
        ],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      const registered = (await this.registeredPaths(context, repository)).includes(member.path)
      if (registered && (await isDirectory(member.path))) {
        created.push(member)
        branched.push(member)
        // Created, but Git reported a problem, such as a failing post-checkout hook.
        if (result.code !== 0) warnings.push(describeOutput(member.label, result))
        continue
      }
      // Whatever the failed attempt left, a registration or the branch, is undone too.
      if (registered) created.push(member)
      if (await hasBranch(context, repository, request.branch)) branched.push(member)
      const undone = await this.undo(context, created, branched, request.branch)
      if (projectFolder.created) await layout.removeIfEmpty(projectFolder.folder)
      await this.refresh(state)
      return {
        ok: false,
        reason: 'failed',
        message: [gitErrorMessage(result), ...undone].join('\n\n'),
      }
    }
    await this.refresh(state)
    return { ok: true, path: root, warning: warnings.length > 0 ? warnings.join('\n\n') : null }
  }

  /** Checks what deleting a worktree would delete and lose. */
  async inspect(projectRoot: string, worktreePath: string): Promise<InspectWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'The project is not in the list.' }
    const context = await this.options.gitContext()
    const entry = (await this.readEntries(context, state)).find(
      (candidate) => candidate.path === worktreePath,
    )
    if (!entry) return { ok: false, message: 'The worktree no longer exists.' }
    try {
      return { ok: true, inspection: await this.inspectEntry(context, state, entry) }
    } catch (error) {
      if (error instanceof InspectionError) return { ok: false, message: error.message }
      throw error
    }
  }

  /**
   * Deletes a worktree: its inner members, deeper ones first, then its outer
   * member, with everything in its root. Branches are kept. Unless `discard`
   * is set, a worktree with anything to lose is not deleted, and neither is
   * one where `hasRunningSessions` reports running sessions.
   */
  async delete(
    projectRoot: string,
    worktreePath: string,
    discard: boolean,
    hasRunningSessions: () => boolean = () => false,
  ): Promise<DeleteWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state)
      return { ok: false, reason: 'not-found', message: 'The project is not in the list.' }
    const context = await this.options.gitContext()
    const entry = (await this.readEntries(context, state)).find(
      (candidate) => candidate.path === worktreePath,
    )
    if (!entry) return { ok: false, reason: 'not-found', message: 'The worktree no longer exists.' }
    if (entry.locked) {
      return { ok: false, reason: 'locked', message: 'The worktree is locked.' }
    }
    if (!(await isDirectory(entry.path))) {
      return { ok: false, reason: 'missing', message: 'The folder of the worktree is missing.' }
    }
    // Without leave to discard anything, check again: something may have changed
    // since the user was asked.
    if (!discard) {
      let inspection: WorktreeInspection
      try {
        inspection = await this.inspectEntry(context, state, entry)
      } catch (error) {
        if (error instanceof InspectionError) {
          return { ok: false, reason: 'failed', message: error.message }
        }
        throw error
      }
      if (!inspectionIsClean(inspection)) {
        return {
          ok: false,
          reason: 'changed',
          message: 'The worktree has changes that would be lost.',
          inspection,
        }
      }
    }
    // A session may have started while the worktree was checked.
    if (hasRunningSessions()) {
      return {
        ok: false,
        reason: 'running',
        message: 'End the running sessions in this worktree before deleting it.',
      }
    }
    const members = await this.membersOf(context, state, entry.path)
    for (const member of [...deepestFirst(members.inner), members.outer]) {
      const result = await runGit(
        context.git,
        ['-C', member.repository, 'worktree', 'remove', '--force', member.path],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      if (result.code !== 0) {
        await this.refresh(state)
        return {
          ok: false,
          reason: 'failed',
          message: `Could not delete ${member.path}: ${gitErrorMessage(result)}`,
        }
      }
    }
    await this.refresh(state)
    return { ok: true }
  }

  /**
   * Removes the registrations of a worktree whose root is missing, in the
   * project repository and the inner repositories, keeping every branch.
   */
  async removeMissing(projectRoot: string, worktreePath: string): Promise<RemoveWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'The project is not in the list.' }
    const context = await this.options.gitContext()
    const entry = (await this.readEntries(context, state)).find(
      (candidate) => candidate.path === worktreePath,
    )
    if (!entry) {
      await this.refresh(state)
      return { ok: true }
    }
    if (await isDirectory(entry.path)) {
      return {
        ok: false,
        message: 'The folder of the worktree exists; delete the worktree instead.',
      }
    }
    if (entry.locked) return { ok: false, message: 'The worktree is locked.' }
    const members = await this.membersOf(context, state, entry.path)
    for (const member of [...deepestFirst(members.inner), members.outer]) {
      const result = await git(context, [
        '-C',
        member.repository,
        'worktree',
        'remove',
        member.path,
      ])
      if (result.code !== 0) {
        await this.refresh(state)
        return {
          ok: false,
          message: `Could not remove ${member.path}: ${gitErrorMessage(result)}`,
        }
      }
    }
    await this.refresh(state)
    return { ok: true }
  }

  /** The project repository's linked worktrees, as Git lists them now. */
  private async readEntries(context: GitContext, state: ProjectState): Promise<WorktreeEntry[]> {
    const result = await git(context, ['-C', state.root, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return []
    return parseWorktreeList(result.stdout)
      .slice(1)
      .filter((entry) => !entry.bare)
  }

  /** The paths of a repository's linked worktrees. */
  private async registeredPaths(context: GitContext, repository: string): Promise<string[]> {
    const result = await git(context, ['-C', repository, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return []
    return parseWorktreeList(result.stdout)
      .slice(1)
      .map((entry) => entry.path)
  }

  /** The members of the worktree at a root: its outer member and its inner members. */
  private async membersOf(
    context: GitContext,
    state: ProjectState,
    root: string,
  ): Promise<{ outer: Member; inner: Member[] }> {
    const inner: Member[] = []
    for (const repository of state.inner ?? []) {
      const memberPath = path.join(root, repository.relativePath)
      if ((await this.registeredPaths(context, repository.path)).includes(memberPath)) {
        inner.push({
          repository: repository.path,
          path: memberPath,
          relativePath: repository.relativePath,
          label: repository.relativePath,
        })
      }
    }
    return {
      outer: { repository: state.root, path: root, relativePath: '', label: state.name },
      inner,
    }
  }

  private async inspectEntry(
    context: GitContext,
    state: ProjectState,
    entry: WorktreeEntry,
  ): Promise<WorktreeInspection> {
    const members = await this.membersOf(context, state, entry.path)
    const toCheck: MemberToCheck[] = [members.outer, ...members.inner]
    const { changes, foreignRepositories } = await inspectMembers(context, entry.path, toCheck)
    return {
      root: entry.path,
      innerMembers: members.inner.map((member) => member.path),
      branch: entry.branch ? shortBranchName(entry.branch) : null,
      changes,
      foreignRepositories,
    }
  }

  /**
   * Removes what a failed creation made, inner members (deeper ones first)
   * before the outer member, and then the new branches. Returns messages
   * about anything that could not be removed.
   */
  private async undo(
    context: GitContext,
    created: readonly Member[],
    branched: readonly Member[],
    branch: string,
  ): Promise<string[]> {
    const problems: string[] = []
    const inner = created.filter((member) => member.relativePath !== '')
    const outer = created.filter((member) => member.relativePath === '')
    for (const member of [...deepestFirst(inner), ...outer]) {
      const result = await runGit(
        context.git,
        ['-C', member.repository, 'worktree', 'remove', '--force', '--force', member.path],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      if (result.code !== 0) {
        problems.push(`Could not remove ${member.path}: ${gitErrorMessage(result)}`)
      }
    }
    for (const member of branched) {
      const result = await git(context, ['-C', member.repository, 'branch', '-D', branch])
      if (result.code !== 0) {
        problems.push(
          `Could not delete the branch ${branch} in ${member.label}: ${gitErrorMessage(result)}`,
        )
      }
    }
    return problems
  }

  /** Reads the project's worktrees and reports them if they changed. */
  private refresh(state: ProjectState): Promise<void> {
    if (state.refreshing) {
      state.refreshAgain = true
      return state.refreshing
    }
    state.refreshing = (async () => {
      do {
        state.refreshAgain = false
        const worktrees = await this.readWorktrees(state)
        if (state.removed) return
        if (!sameWorktrees(worktrees, state.worktrees)) {
          state.worktrees = worktrees
          this.emit('changed', state.root, worktrees)
        }
      } while (state.refreshAgain)
    })()
      .catch((error: unknown) =>
        console.error('Could not list the worktrees of', state.root, error),
      )
      .finally(() => {
        state.refreshing = null
      })
    return state.refreshing
  }

  private schedule(state: ProjectState): void {
    if (state.removed) return
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      void this.refresh(state)
    }, REFRESH_DELAY_MS)
  }

  private async readWorktrees(state: ProjectState): Promise<WorktreeInfo[]> {
    const context = await this.options.gitContext()
    const entries = await this.readEntries(context, state)
    const inner = state.inner ?? []
    const innerRegistrations = await Promise.all(
      inner.map((repository) => this.registeredPaths(context, repository.path)),
    )
    const worktrees = await Promise.all(
      entries.map(async (entry): Promise<WorktreeInfo> => {
        const missing = !(await isDirectory(entry.path))
        return {
          path: entry.path,
          branch: entry.branch ? shortBranchName(entry.branch) : null,
          displayName: entry.branch
            ? shortBranchName(entry.branch)
            : await this.shortCommit(context, state, entry, missing),
          missing,
          locked: entry.locked,
          lockReason: entry.lockReason,
          innerMembers: inner
            .filter((repository, index) =>
              innerRegistrations[index]!.includes(path.join(entry.path, repository.relativePath)),
            )
            .map((repository) => repository.relativePath),
        }
      }),
    )
    return worktrees.toSorted(compareWorktrees)
  }

  /** The abbreviated commit of a detached HEAD, as `git rev-parse --short HEAD` gives it there. */
  private async shortCommit(
    context: GitContext,
    state: ProjectState,
    entry: WorktreeEntry,
    missing: boolean,
  ): Promise<string> {
    const result = missing
      ? await git(context, ['-C', state.root, 'rev-parse', '--short', entry.head ?? 'HEAD'])
      : await git(context, ['-C', entry.path, 'rev-parse', '--short', 'HEAD'])
    return result.code === 0 ? result.stdout.trim() : (entry.head ?? '').slice(0, 7)
  }

  /** Looks for the project's inner repositories, watches their registrations, and lists again. */
  private discover(state: ProjectState): Promise<void> {
    if (state.discovering) return state.discovering
    state.discovering = (async () => {
      await state.ready
      const context = await this.options.gitContext()
      const inner = await findInnerRepositories(context, state.root)
      if (state.removed) return
      state.inner = inner
      state.discoveredAt = Date.now()
      const wanted = new Set(inner.map((repository) => repository.commonDir))
      if (state.commonDir) wanted.add(state.commonDir)
      this.unwatch(state, wanted)
      for (const directory of wanted) this.watch(state, directory)
      await this.refresh(state)
    })()
      .catch((error: unknown) =>
        console.error('Could not look for the inner repositories of', state.root, error),
      )
      .finally(() => {
        state.discovering = null
      })
    return state.discovering
  }

  private watch(state: ProjectState, directory: string): void {
    if (state.watched.has(directory)) return
    let entry = this.watchers.get(directory)
    if (!entry) {
      const projects = new Set<string>()
      let watcher: FSWatcher
      try {
        watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
          if (filename !== null && !isRegistrationChange(filename)) return
          for (const root of projects) {
            const project = this.projects.get(root)
            if (project) this.schedule(project)
          }
        })
      } catch (error) {
        console.error('Could not watch', directory, error)
        return
      }
      watcher.on('error', (error) => console.error('Stopped watching', directory, error))
      entry = { watcher, projects }
      this.watchers.set(directory, entry)
    }
    entry.projects.add(state.root)
    state.watched.add(directory)
  }

  /** Stops watching the directories of a project that are not in `keep`. */
  private unwatch(state: ProjectState, keep: ReadonlySet<string>): void {
    for (const directory of state.watched) {
      if (keep.has(directory)) continue
      state.watched.delete(directory)
      const entry = this.watchers.get(directory)
      if (!entry) continue
      entry.projects.delete(state.root)
      if (entry.projects.size === 0) {
        entry.watcher.close()
        this.watchers.delete(directory)
      }
    }
  }
}

/** Git's output for a member, introduced by its name. */
function describeOutput(label: string, result: GitResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  return `${label}: git exited with code ${result.code}.${output ? `\n${output}` : ''}`
}
