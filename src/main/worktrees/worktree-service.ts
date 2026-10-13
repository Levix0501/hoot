import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import {
  compareWorktrees,
  inspectionIsClean,
  isWithin,
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
  readBranches,
  submodulesAt,
  type GitContext,
  type InnerRepository,
} from './repositories'

/** Creating or removing a worktree runs hooks and touches many files: no short limit. */
const WORKTREE_COMMAND_TIMEOUT = 10 * 60_000

export interface WorktreeServiceOptions {
  layout: WorktreeLayout
  /** How to run git, resolved for each operation. */
  gitContext(): Promise<GitContext>
}

interface ProjectState {
  root: string
  name: string
  /** The inner repositories found by the last search, once there was one. */
  inner: InnerRepository[] | null
  discovering: Promise<void> | null
  /** The worktrees as they were last read. */
  worktrees: WorktreeInfo[]
  /** Whether `changed` has reported them, as it does once they are first read. */
  reported: boolean
  refreshing: Promise<void> | null
  refreshAgain: boolean
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

/** Deeper relative paths first, as worktree members are deleted. */
export function deepestFirst<T extends { relativePath: string }>(members: readonly T[]): T[] {
  const depth = (member: T) => member.relativePath.split('/').length
  return members.toSorted((a, b) => depth(b) - depth(a))
}

async function isDirectory(directory: string): Promise<boolean> {
  return (await fs.promises.stat(directory).catch(() => null))?.isDirectory() ?? false
}

/** The real path of a file that may not exist: its nearest existing ancestor's, with the rest. */
async function realPath(file: string): Promise<string> {
  try {
    return await fs.promises.realpath(file)
  } catch {
    const parent = path.dirname(file)
    return parent === file ? file : path.join(await realPath(parent), path.basename(file))
  }
}

function sameWorktrees(a: readonly WorktreeInfo[], b: readonly WorktreeInfo[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Lists, creates and deletes the worktrees of the projects in the list. A
 * project's worktrees are the linked worktrees of its repository directly in
 * its project folder, where Hoot creates them; they are told apart by where
 * they are, so that the worktrees made by any Hoot are listed. Nothing is
 * watched: the worktrees are read from Git when a project is added, when
 * `refreshAll` is called (as the window gets the focus), after Hoot creates
 * or deletes one, and before a session starts in one or one is deleted or
 * removed. Inner repositories are looked for when a project is added, when
 * the new worktree dialog opens, and before a worktree is checked, deleted
 * or removed. `changed` reports a project's worktrees once they are first
 * read, also when there are none, and then whenever they change.
 */
export class WorktreeService extends EventEmitter<{
  changed: [projectRoot: string, worktrees: WorktreeInfo[]]
}> {
  private readonly projects = new Map<string, ProjectState>()

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
      inner: null,
      discovering: null,
      worktrees: [],
      reported: false,
      refreshing: null,
      refreshAgain: false,
      ready: Promise.resolve(),
      removed: false,
    }
    this.projects.set(root, state)
    state.ready = this.refresh(state)
    void state.ready.then(() => this.discover(state))
  }

  removeProject(root: string): void {
    const state = this.projects.get(root)
    if (!state) return
    state.removed = true
    this.projects.delete(root)
  }

  /** Forgets every project, as Hoot quits. */
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
   * Reads every project's worktrees again, as when the window gets the focus,
   * with the inner repositories of the last search: what changed outside
   * Hoot, such as a worktree whose directory was deleted, shows then.
   */
  refreshAll(): void {
    for (const state of this.projects.values()) void this.refresh(state)
  }

  /**
   * Reads the project's worktrees again, which `changed` then reports, and
   * returns the worktree at a root as it is now, or `null` when there is no
   * such worktree: before a session starts in it, or before it is deleted or
   * removed, which may no longer be possible.
   */
  async currentWorktree(projectRoot: string, worktreePath: string): Promise<WorktreeInfo | null> {
    const state = this.projects.get(projectRoot)
    if (!state) return null
    await this.refresh(state)
    return state.worktrees.find((worktree) => worktree.path === worktreePath) ?? null
  }

  /**
   * Whether a directory is the root of one of the project's worktrees that
   * exists, as Git lists them now, without showing what changed.
   */
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
      // Git registers a worktree by its real path, which a symbolic link on the
      // way (to move ~/.hoot to another disk, say) changes: the root is the real
      // path too, so that the members can be found among the registrations.
      const folder = await fs.promises.realpath(projectFolder.folder)
      root = await layout.worktreeRoot(folder, request.branch)
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
      // A registration already at the path, of a worktree whose folder is
      // missing, is another worktree's: Git refuses to replace it, and it stays.
      const registeredBefore = (await this.registeredPaths(context, repository)).includes(
        member.path,
      )
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
      const registered =
        !registeredBefore && (await this.registeredPaths(context, repository)).includes(member.path)
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
    // Its inner members are the worktrees of the inner repositories there are
    // now, which may not have been looked for yet: right after Hoot starts, say,
    // or since one was made.
    await this.discover(state)
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
   * member, with everything in its root, and then the registrations of other
   * linked worktrees that were inside the root. Branches are kept. Unless
   * `discard` is set, a worktree with anything to lose is not deleted, and
   * neither is one where `hasRunningSessions` reports running sessions.
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
    // Its inner members are found as when checking it.
    await this.discover(state)
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
      // Only the outer member's lock, checked above, makes the worktree
      // locked: forcing twice removes an inner member that is locked too.
      const force = member.relativePath === '' ? ['--force'] : ['--force', '--force']
      const result = await runGit(
        context.git,
        ['-C', member.repository, 'worktree', 'remove', ...force, member.path],
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
    await this.clearRegistrationsWithin(context, state, entry.path)
    await this.refresh(state)
    return { ok: true }
  }

  /**
   * Removes the registrations of a worktree whose root is missing, in the
   * project repository and the inner repositories, keeping every branch.
   * A lock does not stop it: the user asks for the registrations to go.
   * The worktrees are read again first, and nothing is removed unless the
   * worktree is still there and still missing.
   */
  async removeMissing(projectRoot: string, worktreePath: string): Promise<RemoveWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'The project is not in the list.' }
    const worktree = await this.currentWorktree(projectRoot, worktreePath)
    if (!worktree) return { ok: false, message: 'The worktree no longer exists.' }
    if (!worktree.missing) {
      return {
        ok: false,
        message: 'The folder of the worktree exists; delete the worktree instead.',
      }
    }
    // Its inner members are found as when checking a worktree.
    await this.discover(state)
    const context = await this.options.gitContext()
    const members = await this.membersOf(context, state, worktree.path)
    for (const member of [...deepestFirst(members.inner), members.outer]) {
      // The folder is gone, so forcing twice only overrides a lock.
      const result = await git(context, [
        '-C',
        member.repository,
        'worktree',
        'remove',
        '--force',
        '--force',
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

  /**
   * The project's worktrees as Git lists them now: the project repository's
   * linked worktrees directly in the project folder. Its other linked
   * worktrees, such as those coding agents make elsewhere, are not Hoot's.
   */
  private async readEntries(context: GitContext, state: ProjectState): Promise<WorktreeEntry[]> {
    const result = await git(context, ['-C', state.root, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return []
    // Git lists a worktree by the real path it had when it was made, which a
    // symbolic link added on the way since (to move ~/.hoot to another disk,
    // say) no longer is: folders are compared by their real paths now. The
    // folder may be gone, with its worktrees missing.
    const { folder } = await this.options.layout.projectFolder(state.root, { create: false })
    const realFolder = await realPath(folder)
    const entries = parseWorktreeList(result.stdout)
      .slice(1)
      .filter((entry) => !entry.bare)
    const inFolder = await Promise.all(
      entries.map(async (entry) => (await realPath(path.dirname(entry.path))) === realFolder),
    )
    return entries.filter((_entry, index) => inFolder[index])
  }

  /** The paths of a repository's linked worktrees. */
  private async registeredPaths(context: GitContext, repository: string): Promise<string[]> {
    const result = await git(context, ['-C', repository, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return []
    return parseWorktreeList(result.stdout)
      .slice(1)
      .map((entry) => entry.path)
  }

  /**
   * Clears the registrations, in the project repository and the inner
   * repositories, of linked worktrees that were inside a deleted root (such
   * as one an agent made there) and are prunable now: deleting the root
   * deleted their folders too.
   */
  private async clearRegistrationsWithin(
    context: GitContext,
    state: ProjectState,
    root: string,
  ): Promise<void> {
    const repositories = [state.root, ...(state.inner ?? []).map((inner) => inner.path)]
    // Made at different times, the root and a worktree inside it may be
    // registered by paths that differ by a symbolic link added since.
    const realRoot = await realPath(root)
    for (const repository of repositories) {
      const result = await git(context, ['-C', repository, 'worktree', 'list', '--porcelain', '-z'])
      if (result.code !== 0) continue
      for (const entry of parseWorktreeList(result.stdout).slice(1)) {
        if (!entry.prunable || !isWithin(await realPath(entry.path), realRoot)) continue
        const removed = await git(context, ['-C', repository, 'worktree', 'remove', entry.path])
        if (removed.code !== 0) {
          console.error('Could not clear the registration of', entry.path, gitErrorMessage(removed))
        }
      }
    }
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
    // An inner member whose folder is gone has nothing left to lose or to
    // delete: deleting the worktree only clears its registration.
    const present: Member[] = []
    for (const member of members.inner) if (await isDirectory(member.path)) present.push(member)
    const toCheck: MemberToCheck[] = [members.outer, ...present]
    const { changes, foreignRepositories } = await inspectMembers(context, entry.path, toCheck)
    return {
      root: entry.path,
      innerMembers: present.map((member) => member.path),
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

  /**
   * Reads the project's worktrees and reports them if they changed. Called
   * while a read is under way, it reads once more after it, so that what it
   * settles with is as new as the call.
   */
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
        if (!state.reported || !sameWorktrees(worktrees, state.worktrees)) {
          state.worktrees = worktrees
          state.reported = true
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

  /** Looks for the project's inner repositories, and reads the worktrees again with them. */
  private discover(state: ProjectState): Promise<void> {
    if (state.discovering) return state.discovering
    state.discovering = (async () => {
      await state.ready
      const context = await this.options.gitContext()
      const inner = await findInnerRepositories(context, state.root)
      if (state.removed) return
      state.inner = inner
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
}

/** Git's output for a member, introduced by its name. */
function describeOutput(label: string, result: GitResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  return `${label}: git exited with code ${result.code}.${output ? `\n${output}` : ''}`
}
